// Parcha el JSON exportado del flujo de n8n del carrusel:
//   - los nodos de firma usan n8n/firma.js y el token de la fila del cliente (sin secreto escrito)
//   - el flujo busca su token en la tabla whatsapp_numeros (Buscar token -> Adjuntar token)
//   - cada generación se reporta a /api/usage/USERx (Firmar consumo -> Reportar consumo)
//   - el tamaño del póster sale de formato + resolución del panel (n8n/formato.js), el logo escala con él
//   - el prompt se redacta con una llamada HTTP a OpenRouter (Armar prompt -> Redactar prompt) para tener sus tokens
//   - la imagen, el texto y el audio reportan su consumo
// Uso: node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>
// La salida se importa en el flujo desde el editor de n8n. Aplicarlo dos veces no cambia nada.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SIGN_NODES = ['Firmar settings', 'Firmar comando', 'Subir imagen compuesta', 'Firmar webhook'];
const HTTP_NODES = ['Traer settings', 'Llamar manage', 'Subir imagen compuesta - HTTP', 'Publicar en carrusel'];
const TABLE_ID = 'l7BmjGQTMBUFwDoB'; // whatsapp_numeros
const TOKEN_LINE = "const token = String($('Variables').first().json.token || '');";
const TIMESTAMP_HEADER = { name: 'X-Webhook-Timestamp', value: '={{ $json.timestamp }}' };

const OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
const WAN_MAX_LADO = 2048; // lado mayor que se le pide a Wan; "Optimizar imagen" lleva el póster al tamaño del panel
const ARMAR_PROMPT = [
  '// Cuerpo de la peticion a OpenRouter: reglas fijas (system) + datos del cliente (user).',
  'var item = $input.first().json;',
  "var ctx = $('Init contexto').first().json;",
  `return [{ json: { body: JSON.stringify({ model: '${OPENROUTER_MODEL}', messages: armarMensajes(item, ctx) }) } }];`,
].join('\n');
const CALCULAR_POSICION = [
  "// Evita la colision de 'data' del Merge: toma el poster de Optimizar imagen",
  '// y el logo de Redimensionar logo.',
  'var inBin = {};',
  'try { inBin = $input.first().binary || {}; } catch (e) {}',
  'var baseBin = null, logoBin = null;',
  "try { baseBin = $('Optimizar imagen').last().binary; } catch (e) {}",
  "try { logoBin = $('Redimensionar logo').last().binary; } catch (e) {}",
  'var outBin = {};',
  'outBin.data = (baseBin && baseBin.data) ? baseBin.data : inBin.data;',
  'outBin.logo = (logoBin && logoBin.logo) ? logoBin.logo : inBin.logo;',
  '// El logo va en la esquina inferior derecha del tamano REAL del poster (Info poster),',
  '// asi nunca queda fuera aunque el generador no respete el formato. Su tamano y su margen',
  '// salen de "Init contexto" y crecen con la resolucion (420x224 con 50 px en Full HD).',
  'var pw = 1920, ph = 1080, margin = 50, lw = 420, lh = 224;',
  "try { var fc = $('Init contexto').first().json; if (fc.ancho && fc.alto) { pw = Number(fc.ancho); ph = Number(fc.alto); } if (fc.logo_ancho && fc.logo_alto) { lw = Number(fc.logo_ancho); lh = Number(fc.logo_alto); margin = Number(fc.logo_margen) || margin; } } catch (e) {}",
  "try { var sz = $('Info poster').last().json.size; if (sz && sz.width && sz.height) { pw = Number(sz.width); ph = Number(sz.height); } } catch (e) {}",
  'var pos = posicionLogo(pw, ph, lw, lh, margin);',
  'return [{ json: { posX: pos.posX, posY: pos.posY, pw: pw, ph: ph, lw: lw, lh: lh, margin: margin }, binary: outBin }];',
].join('\n');
const INIT_TAMANO = [
  '// Tamano del poster: el que calcula el panel (formato + resolucion) o, si no llega, el Full HD de siempre.',
  'var F = tamanoPoster({ defaultOrientation: cfg.defaultOrientation || inp.defaultOrientation, posterWidth: cfg.posterWidth, posterHeight: cfg.posterHeight });',
  'var formato = F.formato;',
  'var Z = zonaLogo(F.ancho, F.alto);',
].join('\n');
const PARSEAR_TEXTO = [
  "var texto = '';",
  "try { texto = String(raw.output || raw.text || (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || ''); } catch (e6) {}",
].join('\n');
const PARSEAR_REGLAS = [
  '// Reglas finales fijas (no dependen de la IA): formato del panel, textos que quepan, escena completa y zona del logo.',
  "if (prompt_final && prompt_final.indexOf('FINAL LAYOUT RULES') === -1) {",
  "  prompt_final += reglasLayout(Number(ctx('ancho', 1920)) || 1920, Number(ctx('alto', 1080)) || 1080);",
  '}',
  '',
].join('\n');

// Pone `head` al inicio de un nodo Code. `marker` es el comienzo del codigo original del nodo:
// al volver a parchar solo se refresca lo que hay antes de el.
function withHead(code, marker, head, nodeName) {
  const at = code.indexOf(marker);
  if (at === -1) throw new Error(`Nodo "${nodeName}": no se encontró "${marker}"`);
  return head + '\n' + code.slice(at);
}

// Cambia el nombre de un destino en todas las conexiones.
function renameTarget(connections, from, to) {
  for (const outputs of Object.values(connections)) {
    for (const lists of Object.values(outputs)) {
      for (const list of lists) {
        for (const c of list || []) if (c.node === from) c.node = to;
      }
    }
  }
}

// Reemplaza exactamente una aparición; si no la hay, el flujo cambió y hay que revisarlo a mano.
function replaceOnce(code, pattern, replacement, nodeName, what) {
  const hits = code.match(new RegExp(pattern.source, 'g')) || [];
  if (hits.length !== 1) throw new Error(`Nodo "${nodeName}": se esperaba 1 ${what} y hay ${hits.length}`);
  return code.replace(pattern, replacement);
}

function patchSignCode(code, firma, nodeName) {
  const cut = code.indexOf('const secret =');
  if (cut === -1) {
    // Ya parchado: solo se refresca el bloque de firma.
    const at = code.indexOf(TOKEN_LINE);
    if (at === -1) throw new Error(`Nodo "${nodeName}": no tiene la línea "const secret =" ni está parchado`);
    return firma + '\n' + code.slice(at);
  }
  let tail = code.slice(cut);
  tail = replaceOnce(tail, /^const secret = .*\n/m, TOKEN_LINE + '\n', nodeName, 'línea del secreto');
  tail = tail.replace(/^if \(!secret\) \{.*\}\n/m, '');
  tail = replaceOnce(tail, /(?:const|var) signature = hmacSha256Hex\(secret, body\);/, 'const firma = firmar(token, body);', nodeName, 'cálculo de la firma');
  tail = replaceOnce(tail, /\{ body: body, signature: signature \}/, '{ body: firma.body, signature: firma.signature, timestamp: firma.timestamp }', nodeName, 'salida con la firma');
  return firma + '\n' + tail;
}

function patchInit(code, formato) {
  let tail = code.slice(code.indexOf('var trg = {};'));
  if (!tail.startsWith('var trg = {};')) throw new Error('Nodo "Init contexto": no se encontró el inicio del código');
  if (!tail.includes('tamanoPoster(')) {
    tail = replaceOnce(tail, /\/\/ Formatos de poster del panel[\s\S]*?var F = FORMATOS\[formato\];/, () => INIT_TAMANO, 'Init contexto', 'tabla de formatos');
    tail = replaceOnce(tail, /formato_texto: F\.texto \+ ', EXACTAMENTE ' \+ F\.ancho \+ 'x' \+ F\.alto \+ ' pixeles' \}/,
      () => "formato_texto: F.texto + ', EXACTAMENTE ' + F.ancho + 'x' + F.alto + ' pixeles', logo_ancho: Z.logoAncho, logo_alto: Z.logoAlto, logo_margen: Z.margen }", 'Init contexto', 'salida con el formato');
  }
  return formato + '\n' + tail;
}

function patchParsear(code, formato) {
  let tail = code.slice(code.indexOf('function lastVal(nodeName, field, fb) {'));
  if (!tail.startsWith('function lastVal(')) throw new Error('Nodo "Parsear salida": no se encontró el inicio del código');
  if (!tail.includes('reglasLayout(')) {
    tail = replaceOnce(tail, /var texto = String\(raw\.output \|\| raw\.text \|\| ''\);/, () => PARSEAR_TEXTO, 'Parsear salida', 'lectura del texto');
    tail = replaceOnce(tail, /\/\/ Reglas finales fijas[\s\S]*?(?=return \[\{ json: \{ valido: valido)/, () => PARSEAR_REGLAS, 'Parsear salida', 'reglas finales');
  }
  return formato + '\n' + tail;
}

function patchPrepararWan(code, formato) {
  let tail = code.slice(code.indexOf('// Arma la peticion a Wan'));
  if (!tail.startsWith('// Arma la peticion a Wan')) throw new Error('Nodo "Preparar Wan": no se encontró el inicio del código');
  if (!tail.includes('tamanoGeneracion(')) {
    tail = replaceOnce(tail, /var size = an \+ '\*' \+ al;/, () => `var g = tamanoGeneracion(an, al, ${WAN_MAX_LADO});\nvar size = g.ancho + '*' + g.alto;`, 'Preparar Wan', 'tamaño pedido');
  }
  return formato + '\n' + tail;
}

function addNode(nodes, node) {
  const i = nodes.findIndex((n) => n.name === node.name);
  if (i === -1) nodes.push(node);
  else nodes[i] = node;
}

const link = (...names) => [names.map((node) => ({ node, type: 'main', index: 0 }))];

export function patchWorkflow(workflow, snippets) {
  const wf = JSON.parse(JSON.stringify(workflow));
  const get = (name) => {
    const n = wf.nodes.find((x) => x.name === name);
    if (!n) throw new Error(`Falta el nodo "${name}" en el flujo`);
    return n;
  };
  const firma = snippets.firma.replace(/\s+$/, '');
  const formato = snippets.formato.replace(/\s+$/, '');
  const prompt = snippets.prompt.replace(/\s+$/, '');

  // 1. Nodos de firma
  for (const name of SIGN_NODES) {
    const n = get(name);
    n.parameters.jsCode = patchSignCode(n.parameters.jsCode, firma, name);
  }
  // El cuerpo de settings era siempre '{}': con token crt_ dos mensajes en el mismo segundo
  // darían la misma firma y el servidor rechaza firmas repetidas. El servidor no lee este cuerpo.
  const settings = get('Firmar settings');
  settings.parameters.jsCode = settings.parameters.jsCode.replace("const body = '{}';", 'const body = JSON.stringify({ n: String($execution.id) });');
  if (!settings.parameters.jsCode.includes('const body = JSON.stringify({ n: String($execution.id) });')) {
    throw new Error('Nodo "Firmar settings": no se encontró la línea del cuerpo');
  }

  // 2. Cabecera con el timestamp en las peticiones al carrusel
  for (const name of HTTP_NODES) {
    const headers = get(name).parameters.headerParameters.parameters;
    if (!headers.some((h) => h.name === TIMESTAMP_HEADER.name)) headers.push({ ...TIMESTAMP_HEADER });
  }

  // 3. El flujo busca el token de su carrusel en la tabla
  const trigger = get('WhatsApp Trigger');
  get('Variables');
  addNode(wf.nodes, {
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: TABLE_ID, cachedResultName: 'whatsapp_numeros' },
      matchType: 'allConditions',
      filters: {
        conditions: [
          // La misma fila que eligió RECEPCIONISTA_WHATSAPP: por número, no por carrusel
          // (dos números pueden compartir carrusel y tener tokens distintos).
          { keyName: 'numero', condition: 'eq', keyValue: "={{ String($json.messages?.[0]?.from ?? '').replace(/\\D/g, '').slice(-10) }}" },
          { keyName: 'activo', condition: 'isTrue' },
        ],
      },
      limit: 1,
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0001',
    name: 'Buscar token',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [trigger.position[0], trigger.position[1] - 224],
    alwaysOutputData: true,
    notes: 'Fila del cliente en whatsapp_numeros: de ahi sale el token con el que se firma.',
  });
  addNode(wf.nodes, {
    parameters: {
      jsCode: [
        '// Deja pasar el mensaje tal como llego y le agrega el token de la fila del cliente.',
        "return [{ json: Object.assign({}, $('WhatsApp Trigger').first().json, { token: String($input.first().json.token || '').trim() }) }];",
      ].join('\n'),
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0002',
    name: 'Adjuntar token',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [trigger.position[0] + 208, trigger.position[1] - 224],
  });
  wf.connections['WhatsApp Trigger'] = { main: link('Buscar token') };
  wf.connections['Buscar token'] = { main: link('Adjuntar token') };
  wf.connections['Adjuntar token'] = { main: link('Variables') };

  // 4. Reporte de consumo. Va ARRIBA de "Fijar foto": con executionOrder v1 la rama de
  // arriba corre primero; abajo, el reporte esperaría a que el cliente apruebe el póster.
  const fijar = get('Fijar foto');
  const manage = get('Llamar manage');
  const others = wf.nodes.filter((n) => n.name !== 'Firmar consumo' && n.name !== 'Reportar consumo');
  const y = Math.min(...others.map((n) => n.position[1])) - 224;
  addNode(wf.nodes, {
    parameters: {
      jsCode: [
        firma,
        snippets.consumo.replace(/\s+$/, ''),
        '',
        TOKEN_LINE,
        'const consumo = armarConsumo($input.first().json, String($execution.id), $runIndex);',
        'if (!consumo) { return []; }',
        'const body = JSON.stringify(consumo);',
        'const firma = firmar(token, body);',
        'return [{ json: { body: firma.body, signature: firma.signature, timestamp: firma.timestamp } }];',
      ].join('\n'),
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0003',
    name: 'Firmar consumo',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [fijar.position[0], y],
    notes: 'Avisa al carrusel cuantas imagenes y tokens se generaron. No detiene el flujo.',
  });
  const usageParams = JSON.parse(JSON.stringify(manage.parameters));
  usageParams.url = usageParams.url.replace('/api/manage/', '/api/usage/');
  usageParams.options = { response: { response: { neverError: true } }, timeout: 10000 };
  addNode(wf.nodes, {
    parameters: usageParams,
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0004',
    name: 'Reportar consumo',
    type: manage.type,
    typeVersion: manage.typeVersion,
    position: [fijar.position[0] + 224, y],
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  });
  for (const gen of ['Generar Wan', 'Generar Qwen']) {
    get(gen);
    const out = wf.connections[gen]?.main?.[0];
    if (!out || !out.some((c) => c.node === 'Fijar foto')) throw new Error(`"${gen}" ya no conecta con "Fijar foto"`);
    if (!out.some((c) => c.node === 'Firmar consumo')) out.unshift({ node: 'Firmar consumo', type: 'main', index: 0 });
  }
  wf.connections['Firmar consumo'] = { main: link('Reportar consumo') };
  delete wf.connections['Reportar consumo'];

  // 5. Tamaño del póster por resolución, logo que escala con él y reglas de lienzo completo.
  const init = get('Init contexto');
  init.parameters.jsCode = patchInit(init.parameters.jsCode, formato);
  const parsear = get('Parsear salida');
  parsear.parameters.jsCode = patchParsear(parsear.parameters.jsCode, formato);
  const wan = get('Preparar Wan');
  wan.parameters.jsCode = patchPrepararWan(wan.parameters.jsCode, formato);
  get('Calcular posicion').parameters.jsCode = formato + '\n\n' + CALCULAR_POSICION;
  const logo = get('Redimensionar logo');
  logo.parameters.width = "={{ $('Init contexto').first().json.logo_ancho || 420 }}";
  logo.parameters.height = "={{ $('Init contexto').first().json.logo_alto || 224 }}";

  // 6. El agente de IA sale: su nodo no entrega los tokens que gasta. El prompt se redacta con
  // una llamada HTTP a OpenRouter (mismo modelo y credencial), que sí devuelve `usage`.
  const agent = wf.nodes.find((n) => n.name === 'AI Agent');
  const armado = wf.nodes.find((n) => n.name === 'Armar prompt');
  if (!agent && !armado) throw new Error('Falta el nodo "AI Agent" (ni "Armar prompt" si ya estaba parchado)');
  const at = (agent || armado).position;
  const audio = get('Transcribir audio');
  addNode(wf.nodes, {
    parameters: { jsCode: formato + '\n' + prompt + '\n\n' + ARMAR_PROMPT },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0005',
    name: 'Armar prompt',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: at,
    notes: 'Arma los mensajes para el modelo de texto: reglas fijas del anuncio + datos del cliente.',
  });
  addNode(wf.nodes, {
    parameters: {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openRouterApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ $json.body }}',
      options: { timeout: 120000 },
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0006',
    name: 'Redactar prompt',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [at[0] + 224, at[1]],
    credentials: JSON.parse(JSON.stringify(audio.credentials)),
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 2000,
    notes: 'Redacta el prompt del poster. Devuelve usage (tokens) para el reporte de consumo.',
  });
  wf.nodes = wf.nodes.filter((n) => n.name !== 'AI Agent' && n.name !== 'OpenRouter Chat Model');
  renameTarget(wf.connections, 'AI Agent', 'Armar prompt');
  delete wf.connections['AI Agent'];
  delete wf.connections['OpenRouter Chat Model'];
  wf.connections['Armar prompt'] = { main: link('Redactar prompt') };
  wf.connections['Redactar prompt'] = { main: link('Parsear salida', 'Firmar consumo') };
  // El audio transcrito también consume tokens.
  const trans = wf.connections['Transcribir audio']?.main?.[0];
  if (!trans || !trans.some((c) => c.node === 'Firmar settings')) throw new Error('"Transcribir audio" ya no conecta con "Firmar settings"');
  if (!trans.some((c) => c.node === 'Firmar consumo')) trans.push({ node: 'Firmar consumo', type: 'main', index: 0 });

  if ('nodeCount' in wf) wf.nodeCount = wf.nodes.length;
  return wf;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Uso: node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>');
    process.exit(1);
  }
  const snippets = Object.fromEntries(['firma', 'consumo', 'formato', 'prompt'].map((k) => [k, readFileSync(join(ROOT, 'n8n/' + k + '.js'), 'utf8')]));
  const wf = patchWorkflow(JSON.parse(readFileSync(input, 'utf8')), snippets);
  // Solo lo que el editor de n8n necesita para importar.
  const { name, nodes, connections, settings } = wf;
  writeFileSync(output, JSON.stringify({ name, nodes, connections, settings }, null, 2));
  console.log(`${nodes.length} nodos -> ${output}`);
}

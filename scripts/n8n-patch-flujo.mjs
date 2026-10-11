// Parcha el JSON exportado del flujo de n8n del carrusel:
//   - los nodos de firma usan n8n/firma.js y el token de la fila del cliente (sin secreto escrito)
//   - el flujo busca su token en la tabla whatsapp_numeros (Buscar token -> Adjuntar token)
//   - cada generación se reporta a /api/usage/USERx (Firmar consumo -> Reportar consumo)
//   - el tamaño del póster sale de formato + resolución del panel (n8n/formato.js), el logo escala con él
//   - el prompt se redacta con una llamada HTTP a OpenRouter (Armar prompt -> Redactar prompt) para tener sus tokens
//   - la imagen, el texto y el audio reportan su consumo
//   - los comandos del chat (suspender, programar, difuminar...) salen de n8n/comandos.js y n8n/respuestas.js
//   - JEV (una llamada HTTP a jevmodel.org) clasifica el mensaje: spam, póster con o sin logo, o comando (n8n/clasificador.js)
//   - espera de 5 segundos: los mensajes de texto seguidos se juntan y se contesta una sola vez (n8n/espera.js)
//   - las instrucciones del que redacta el prompt se editan en el nodo "Instrucciones del director"
//   - los nodos se acomodan en 12 secciones con su nota (scripts/n8n-lienzo.mjs)
// Lo que el usuario edita en n8n no se pisa: las preguntas (cuerpo JSON) y la llave del nodo "JEV", y los
// tres textos de "Instrucciones del director".
// Uso: node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>
// La salida se importa en el flujo desde el editor de n8n. Aplicarlo dos veces no cambia nada.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ordenarLienzo } from './n8n-lienzo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SIGN_NODES = ['Firmar settings', 'Firmar comando', 'Subir imagen compuesta', 'Firmar webhook'];
const HTTP_NODES = ['Traer settings', 'Llamar manage', 'Subir imagen compuesta - HTTP', 'Publicar en carrusel'];
const TABLE_ID = 'l7BmjGQTMBUFwDoB'; // whatsapp_numeros
const ESPERA_TABLE_ID = '2FRqWT4ocHgeLGHM'; // whatsapp_espera (numero, mensaje_id, texto)
const ESPERA_SEGUNDOS = 5; // cuánto se espera después del último mensaje antes de contestar
const TOKEN_LINE = "const token = String($('Variables').first().json.token || '');";
const TIMESTAMP_HEADER = { name: 'X-Webhook-Timestamp', value: '={{ $json.timestamp }}' };

const OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
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

const ZONA = 'America/Monterrey'; // zona del negocio: decide el año de una fecha sin año
const DETECTAR_COMANDOS = [
  '// ---- Comandos y clasificacion de JEV: ver n8n/comandos.js y n8n/clasificador.js ----',
  'var hoy = null;',
  `try { var ahora = $now.setZone('${ZONA}'); hoy = { anio: ahora.year, mes: ahora.month, dia: ahora.day }; } catch (e) {}`,
  '// 1) Un comando escrito tal cual (LISTA, BORRAR 3...) se entiende sin IA.',
  'var cmd = interpretarComando(texto, hoy);',
  '// 2) Lo que dijo JEV. Si no corrio, fallo o contesto algo raro, `jev` queda en null y todo',
  '//    sigue como si JEV no existiera: poster con logo.',
  'var jev = null;',
  "try { jev = leerClasificacion($('JEV').first().json); } catch (e) {}",
  'out.con_logo = true;',
  "out.jev = jev ? jev.tipo : '';",
  "if (jev && !(cmd && cmd.ruta === 'comando')) {",
  "  if (jev.tipo === 'comando') {",
  '    // JEV escribe la orden en su forma normal y la lee el mismo interprete de siempre.',
  '    var deJev = interpretarComando(jev.comando, hoy);',
  '    if (deJev) { cmd = deJev; }',
  "    else if (!cmd) { cmd = interpretarComando('ayuda', hoy); }",
  '  } else if (!cmd) {',
  "    if (jev.tipo === 'spam') { out.ruta = 'spam'; }",
  '    else { out.con_logo = jev.logo; }',
  '  }',
  '}',
  'if (cmd) { out.ruta = cmd.ruta; out.accion = cmd.accion; out.index = cmd.index; out.duracion = cmd.duracion; out.bodyToSign = cmd.bodyToSign; }',
  'return [{ json: out }];',
].join('\n');

// Texto del mensaje (los mensajes juntados, el escrito o el audio transcrito): lo que lee JEV. Una foto no trae texto aqui.
const TEXTO_EXPR = "String(($('Juntar mensajes').isExecuted ? $('Juntar mensajes').first().json.texto : '') || $('WhatsApp Trigger').first().json.messages?.[0]?.text?.body || ($('Transcribir audio').isExecuted ? $('Transcribir audio').first().json.choices?.[0]?.message?.content : '') || '').trim()";
const TEXTO_MENSAJE = '={{ ' + TEXTO_EXPR + ' }}';
// Espera de 5 segundos (n8n/espera.js): datos del mensaje con los que se anota y se busca en whatsapp_espera.
const ESPERA_NUMERO = "={{ String($('WhatsApp Trigger').first().json.messages?.[0]?.from ?? '').replace(/\\D/g, '').slice(-10) }}";
const ESPERA_MENSAJE_ID = "String($('WhatsApp Trigger').first().json.messages?.[0]?.id || 'ejecucion-' + $execution.id)";
const ESPERA_TABLA = { __rl: true, mode: 'id', value: ESPERA_TABLE_ID, cachedResultName: 'whatsapp_espera' };
const ESPERA_FILTRO = { conditions: [{ keyName: 'numero', condition: 'eq', keyValue: ESPERA_NUMERO }] };
const JUNTAR_MENSAJES = [
  '// Filas de este numero en whatsapp_espera, 5 segundos despues de anotar este mensaje.',
  'var filas = [];',
  'try { filas = $input.all().map(function (i) { return i.json || {}; }); } catch (e) {}',
  'var m = {};',
  "try { m = $('WhatsApp Trigger').first().json.messages[0] || {}; } catch (e) {}",
  "var miId = String(m.id || 'ejecucion-' + $execution.id);",
  "return [{ json: juntarMensajes(filas, miId, (m.text && m.text.body) || '') }];",
].join('\n');
// En los nodos Code el texto juntado va primero; si no hubo espera (audio, foto), el de siempre.
const TEXTO_LINEA = "try { texto = (m.text && m.text.body) || ''; } catch (e) {}";
const TEXTO_JUNTADO = "try { texto = String($('Juntar mensajes').first().json.texto || ''); } catch (e) {}\nif (!texto) { " + TEXTO_LINEA + ' }';
function patchTexto(code, nodeName) {
  if (code.includes("$('Juntar mensajes')")) return code;
  return replaceOnce(code, /try \{ texto = \(m\.text && m\.text\.body\) \|\| ''; \} catch \(e\) \{\}/, () => TEXTO_JUNTADO, nodeName, 'lectura del texto del mensaje');
}
const JEV_URL = 'https://jevmodel.org/v1/systemone';
const JEV_SIN_LLAVE = 'Bearer PEGA_AQUI_LA_LLAVE_DE_JEV'; // la llave real solo vive en n8n, nunca en el repo
// Cuerpo de la peticion a JEV: una plantilla de n8n (JSON con una expresion para el mensaje).
// Va con sangria para que se pueda editar en n8n y para que nunca queden dos llaves juntas,
// que n8n tomaria por una expresion.
const ESTADO_JEV = `  "state": {{ JSON.stringify('Mensaje del cliente: ' + ${TEXTO_EXPR}) }},`;
const cuerpoJev = (preguntas) => [
  '={',
  '  "model": "jev-latest",',
  ESTADO_JEV,
  '  "questions": ' + JSON.stringify(preguntas, null, 2).split('\n').join('\n  '),
  '}',
].join('\n');
// El cuerpo que ya está en n8n se respeta (lo edita el usuario), con dos excepciones: la línea
// "state" es de este script (de dónde sale el mensaje), y si a las preguntas les falta la opción
// `spam` el filtro no puede funcionar, así que vuelven las de fábrica.
function cuerpoJevVigente(previo, preguntas) {
  if (typeof previo !== 'string' || !previo || !/"spam"\s*:/.test(previo)) return cuerpoJev(preguntas);
  return previo.replace(/^[ \t]*"state":[ \t]*\{\{.*\}\},[ \t]*$/m, () => ESTADO_JEV);
}
const INIT_LOGO = [
  '// Con logo o sin logo: lo decide JEV (sale de "Detectar ruta"). Si no dijo nada, con logo.',
  'var llevaLogo = true;',
  "try { llevaLogo = $('Detectar ruta').first().json.con_logo !== false; } catch (e) {}",
  '',
].join('\n');
const VISTA_IMAGEN = [
  '// La imagen sale del nodo que corrio: "Componer logo", o "Optimizar imagen sin logo" si el poster va sin logo.',
  "var nodoImagen = 'Componer logo';",
  "try { if ($('Init contexto').first().json.lleva_logo === false) { nodoImagen = 'Optimizar imagen sin logo'; } } catch (e5) {}",
  'try { bin = $(nodoImagen).last().binary; } catch (e3) {}',
].join('\n');
const condicion = (id, leftValue, operator, rightValue = '') => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id, leftValue, operator, rightValue }],
    combinator: 'and',
  },
  options: {},
});
const ARMAR_RESPUESTA = [
  'var cmd = {};',
  "try { cmd = $('Detectar ruta').first().json || {}; } catch (e) {}",
  'var r = {};',
  'try { r = $input.first().json || {}; } catch (e) {}',
  "if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = {}; } }",
  "if (r && typeof r.data === 'string' && r.success === undefined) { try { r = JSON.parse(r.data); } catch (e) {} }",
  'var anio;',
  `try { anio = $now.setZone('${ZONA}').year; } catch (e) {}`,
  "return [{ json: armarRespuesta(cmd, r, 'https://carrusel.etziel.com', anio) }];",
].join('\n');
const AYUDA = [
  '🤖 *Comandos del carrusel*',
  '',
  '📋 *LISTA* — ver las imagenes, su numero y su estado',
  '⏱️ *DURACION 3 20* — la imagen #3 dura 20 segundos',
  '⏱️ *DURACION TODAS 12* — duracion por defecto de todas',
  '⏸️ *SUSPENDER 3* — deja de mostrarla sin borrarla',
  '▶️ *ACTIVAR 3* — vuelve a mostrarla',
  '📅 *PROGRAMAR 3 VIERNES* — solo ese dia (o *LUNES A VIERNES*)',
  '📅 *PROGRAMAR 3 DEL 17 DE OCT AL 23 DE NOV* — solo entre esas fechas',
  '♾️ *PROGRAMAR 3 SIEMPRE* — quita la programacion',
  '🌫️ *DIFUMINAR 3 SI* / *DIFUMINAR 3 NO* — fondo difuminado o negro',
  '🗑️ *BORRAR 3* — borrar la imagen #3 (pide confirmacion)',
  '',
  '📸 *Guardar una foto en Drive:* enviamela; el pie de foto sera el nombre del archivo.',
  '🎨 *Crear un poster:* escribe lo que quieres anunciar.',
].join('\n');
// Opciones que el bot le ofrece al cliente, con su emoji y en negritas de WhatsApp (*asi*).
// Los botones no admiten negritas: solo llevan emoji.
const VISTA_PIE_VIEJO = "var caption = 'Te gusta? Responde PUBLICAR o dime que cambiar. (intento ' + (ronda + 1) + '/5)';";
const VISTA_PIE = "var caption = '¿Te gusta? Responde ✅ *PUBLICAR* o ✏️ *dime que cambiar*. (intento ' + (ronda + 1) + '/5)';";
const ESPERAR_RESPUESTA = {
  message: 'Espero tu respuesta:\n✅ *PUBLICAR* — lo subo al carrusel\n✏️ *O dime que cambiar* — y lo corrijo',
  options: { messageButtonLabel: '✍️ Responder', responseFormDescription: 'Escribe ✅ PUBLICAR o ✏️ dime que cambiar.' },
};
const BORRADO = { approveLabel: '🗑️ Borrar', disapproveLabel: '❌ Cancelar' };

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
  if (!tail.includes('lleva_logo')) {
    tail = replaceOnce(tail, /return \[\{ json: \{ chat: fid,/, () => INIT_LOGO + 'return [{ json: { chat: fid,', 'Init contexto', 'línea de salida');
    tail = replaceOnce(tail, /logo_margen: Z\.margen \}/, () => 'logo_margen: Z.margen, lleva_logo: llevaLogo }', 'Init contexto', 'salida con el logo');
  }
  tail = patchTexto(tail, 'Init contexto');
  return formato + '\n' + tail;
}

function patchArmarVista(code) {
  if (code.includes(VISTA_PIE_VIEJO)) code = code.replace(VISTA_PIE_VIEJO, () => VISTA_PIE);
  if (code.includes('Optimizar imagen sin logo')) return code;
  return replaceOnce(code, /try \{ bin = \$\('Componer logo'\)\.last\(\)\.binary; \} catch \(e3\) \{\}/, () => VISTA_IMAGEN, 'Armar vista', 'lectura de la imagen compuesta');
}

function patchParsear(code, formato) {
  let tail = code.slice(code.indexOf('function lastVal(nodeName, field, fb) {'));
  if (!tail.startsWith('function lastVal(')) throw new Error('Nodo "Parsear salida": no se encontró el inicio del código');
  if (!tail.includes('reglasLayout(')) {
    tail = replaceOnce(tail, /var texto = String\(raw\.output \|\| raw\.text \|\| ''\);/, () => PARSEAR_TEXTO, 'Parsear salida', 'lectura del texto');
    tail = replaceOnce(tail, /\/\/ Reglas finales fijas[\s\S]*?(?=return \[\{ json: \{ valido: valido)/, () => PARSEAR_REGLAS, 'Parsear salida', 'reglas finales');
  }
  if (!tail.includes("ctx('lleva_logo'")) {
    tail = replaceOnce(tail, /Number\(ctx\('alto', 1080\)\) \|\| 1080\);/, () => "Number(ctx('alto', 1080)) || 1080, ctx('lleva_logo', true) !== false);", 'Parsear salida', 'llamada a reglasLayout');
  }
  return formato + '\n' + tail;
}

function patchDetectar(code, clasificador, comandos) {
  let tail = code.slice(code.indexOf('var m = {};'));
  if (!tail.startsWith('var m = {};')) throw new Error('Nodo "Detectar ruta": no se encontró el inicio del código');
  // Todo lo que va después de la foto (comandos y JEV) es de este script: se reescribe siempre.
  tail = replaceOnce(tail, /\/\/ ---- Comandos (?:de texto fijo|y clasificacion de JEV)[^\n]*----[\s\S]*$/, () => DETECTAR_COMANDOS, 'Detectar ruta', 'bloque de comandos');
  tail = patchTexto(tail, 'Detectar ruta');
  return clasificador + '\n' + comandos + '\n' + tail;
}

// Carga las constantes de un fragmento de n8n/ (no tienen export: van pegados en un nodo Code).
function constantes(src, names) {
  return new Function(src + '\n; return {' + names.join(',') + '};')();
}

function patchPrepararWan(code, formato) {
  let tail = code.slice(code.indexOf('// Arma la peticion a Wan'));
  if (!tail.startsWith('// Arma la peticion a Wan')) throw new Error('Nodo "Preparar Wan": no se encontró el inicio del código');
  if (!tail.includes('tamanoGeneracion(')) {
    tail = replaceOnce(tail, /var size = an \+ '\*' \+ al;/, () => "var g = tamanoGeneracion(an, al);\nvar size = g.ancho + '*' + g.alto;", 'Preparar Wan', 'tamaño pedido');
  } else {
    // Una versión anterior le pasaba un lado máximo: la política vive ahora en formato.js (encabezado).
    tail = tail.replace(/tamanoGeneracion\(an, al, \d+\)/, 'tamanoGeneracion(an, al)');
  }
  return formato + '\n' + tail;
}

// El AI Agent solo se puede cambiar por una llamada HTTP si nada más depende de él: ninguna conexión
// que no sea "main" (memoria, herramientas, parser) salvo el modelo de chat, y ese modelo sin opciones
// propias (temperatura, etc.) que se perderían.
function assertAgentReemplazable(wf) {
  for (const [src, outputs] of Object.entries(wf.connections)) {
    for (const [type, lists] of Object.entries(outputs)) {
      const apuntaAlAgente = lists.some((l) => (l || []).some((c) => c.node === 'AI Agent'));
      if (apuntaAlAgente && type !== 'main' && !(src === 'OpenRouter Chat Model' && type === 'ai_languageModel')) {
        throw new Error(`"${src}" se conecta al AI Agent por ${type}: se perdería al cambiarlo por una llamada HTTP`);
      }
    }
  }
  const modelo = wf.nodes.find((n) => n.name === 'OpenRouter Chat Model');
  if (modelo && Object.keys(modelo.parameters?.options || {}).length) {
    throw new Error('"OpenRouter Chat Model" tiene opciones (' + Object.keys(modelo.parameters.options).join(', ') + '): Redactar prompt las perdería');
  }
}

function addNode(nodes, node) {
  const i = nodes.findIndex((n) => n.name === node.name);
  if (i === -1) nodes.push(node);
  else nodes[i] = node;
}

const link = (...names) => [names.map((node) => ({ node, type: 'main', index: 0 }))];

export function patchWorkflow(workflow, snippets, { lienzo = true } = {}) {
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
  if (agent) assertAgentReemplazable(wf);
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

  // 7. Comandos del chat: suspender, programar y difuminar (n8n/comandos.js y n8n/respuestas.js).
  const comandos = snippets.comandos.replace(/\s+$/, '');
  const respuestas = snippets.respuestas.replace(/\s+$/, '');
  const clasificador = snippets.clasificador.replace(/\s+$/, '');
  const detectar = get('Detectar ruta');
  detectar.parameters.jsCode = patchDetectar(detectar.parameters.jsCode, clasificador, comandos);
  get('Armar respuesta').parameters.jsCode = respuestas + '\n\n' + ARMAR_RESPUESTA;
  get('Enviar ayuda').parameters.textBody = AYUDA;

  // 8. JEV: una llamada HTTP a jevmodel.org clasifica el mensaje antes de "Detectar ruta": spam,
  // póster (con o sin logo) o comando. Las preguntas (el cuerpo JSON) y la llave son del usuario:
  // se crean con los valores de fábrica y después no se vuelven a tocar.
  const previo = (name) => wf.nodes.find((n) => n.name === name);
  const { PREGUNTAS_JEV } = constantes(snippets.clasificador, ['PREGUNTAS_JEV']);
  const jevPrevio = previo('JEV')?.type === 'n8n-nodes-base.httpRequest' ? previo('JEV').parameters : {};
  const llavePrevia = (jevPrevio.headerParameters?.parameters || []).find((h) => h.name === 'Authorization')?.value;
  addNode(wf.nodes, {
    parameters: condicion('hay-texto-1', TEXTO_MENSAJE, { type: 'string', operation: 'notEmpty', singleValue: true }),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0007',
    name: 'Hay texto',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [0, 0],
    notes: 'Si el mensaje trae texto (escrito o audio transcrito) lo lee JEV. Una foto sola pasa directo.',
  });
  addNode(wf.nodes, {
    parameters: {
      method: 'POST',
      url: JEV_URL,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: typeof llavePrevia === 'string' && llavePrevia ? llavePrevia : JEV_SIN_LLAVE }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: cuerpoJevVigente(jevPrevio.jsonBody, PREGUNTAS_JEV),
      options: { timeout: 15000 },
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0015',
    name: 'JEV',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [0, 0],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    notes: 'Clasifica el mensaje con el modelo JEV (jevmodel.org): spam, poster (con o sin logo) o comando. Las preguntas estan en el cuerpo JSON. Si falla, el flujo sigue como si no existiera.',
  });
  wf.nodes = wf.nodes.filter((n) => n.name !== 'Modelo de JEV');
  delete wf.connections['Modelo de JEV'];
  // Filtro de spam: lo que JEV marca como spam no se contesta.
  addNode(wf.nodes, {
    parameters: condicion('es-spam-1', '={{ $json.ruta }}', { type: 'string', operation: 'equals' }, 'spam'),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0010',
    name: 'Es spam',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [0, 0],
  });
  addNode(wf.nodes, {
    parameters: {},
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0011',
    name: 'Mensaje ignorado',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [0, 0],
    notes: 'Spam: no se contesta. Queda aqui para verlo en la ejecucion.',
  });
  const noEsSpam = wf.connections['Es spam']?.main?.[1] || wf.connections['Detectar ruta']?.main?.[0];
  if (!noEsSpam || !noEsSpam.some((c) => c.node === 'Es foto')) throw new Error('"Detectar ruta" ya no conecta con "Es foto"');
  wf.connections['Traer settings'] = { main: link('Hay texto') };
  wf.connections['Hay texto'] = { main: [link('JEV')[0], link('Detectar ruta')[0]] };
  // JEV también gasta tokens: se reportan igual que los del prompt y el audio.
  wf.connections.JEV = { main: link('Detectar ruta', 'Firmar consumo') };
  wf.connections['Detectar ruta'] = { main: link('Es spam') };
  wf.connections['Es spam'] = { main: [link('Mensaje ignorado')[0], noEsSpam] };
  delete wf.connections['Mensaje ignorado'];

  // 9. Póster sin logo: "Con logo" decide. Sí: el camino de siempre. No: solo se ajusta al tamaño.
  const optimizar = get('Optimizar imagen');
  addNode(wf.nodes, {
    parameters: condicion('con-logo-1', "={{ $('Init contexto').first().json.lleva_logo !== false }}", { type: 'boolean', operation: 'true', singleValue: true }),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0012',
    name: 'Con logo',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [fijar.position[0], fijar.position[1]],
    notes: 'El cliente pidio el poster sin logo? (lo decide JEV). Sin dato, lleva logo.',
  });
  addNode(wf.nodes, {
    parameters: JSON.parse(JSON.stringify(optimizar.parameters)),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0013',
    name: 'Optimizar imagen sin logo',
    type: optimizar.type,
    typeVersion: optimizar.typeVersion,
    position: [optimizar.position[0], optimizar.position[1] + 224],
    notes: 'Poster sin logo: solo se lleva al tamano del panel.',
  });
  const conLogo = wf.connections['Con logo']?.main?.[0] || wf.connections['Fijar foto']?.main?.[0];
  if (!conLogo || !['Optimizar imagen', 'Descargar logo'].every((n) => conLogo.some((c) => c.node === n))) throw new Error('"Fijar foto" ya no conecta con "Optimizar imagen" y "Descargar logo"');
  wf.connections['Fijar foto'] = { main: link('Con logo') };
  wf.connections['Con logo'] = { main: [conLogo, link('Optimizar imagen sin logo')[0]] };
  wf.connections['Optimizar imagen sin logo'] = { main: link('Subir imagen compuesta') };
  const vista = get('Armar vista');
  vista.parameters.jsCode = patchArmarVista(vista.parameters.jsCode);

  // 10. Instrucciones del director: tres textos que el usuario edita en n8n. Igual que con JEV,
  // se crean con los de fábrica (n8n/prompt.js) y lo que ya esté escrito no se pisa.
  const fabrica = constantes(snippets.formato + '\n' + snippets.prompt, ['REGLAS_DIRECTOR', 'LOGO_CON', 'LOGO_SIN']);
  const escritos = Object.fromEntries((previo('Instrucciones del director')?.parameters?.assignments?.assignments || []).map((a) => [a.name, a.value]));
  const campo = (name, deFabrica) => ({ id: 'director-' + name, name, value: typeof escritos[name] === 'string' ? escritos[name] : deFabrica, type: 'string' });
  addNode(wf.nodes, {
    parameters: {
      assignments: { assignments: [campo('reglas', fabrica.REGLAS_DIRECTOR), campo('con_logo', fabrica.LOGO_CON), campo('sin_logo', fabrica.LOGO_SIN)] },
      includeOtherFields: true,
      options: {},
    },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0014',
    name: 'Instrucciones del director',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [at[0], at[1] + 224],
    notes: 'AQUI se editan las instrucciones del que redacta el prompt. Marcadores: [FORMATO] [ANCHO] [ALTO] [ZONA_ANCHO] [ZONA_ALTO] [LOGO]. Un campo vacio usa el texto de fabrica.',
  });
  renameTarget(wf.connections, 'Armar prompt', 'Instrucciones del director');
  wf.connections['Instrucciones del director'] = { main: link('Armar prompt') };

  // 11. Espera de 5 segundos (n8n/espera.js). Un mensaje de texto se anota en whatsapp_espera,
  // espera y lee las filas de su número: si llegó otro después, se retira (contestará el último);
  // si sigue siendo el último, sigue con el texto de todos. Audios y fotos no esperan. Si la
  // tabla falla, el mensaje sigue solo con su texto: nunca se queda sin contestar.
  const esAudio = get('Es audio');
  const trasFiltro = wf.connections['Solo mi numero']?.main?.[0];
  if (!trasFiltro || !trasFiltro.some((c) => c.node === 'Es audio' || c.node === 'Es texto')) throw new Error('"Solo mi numero" ya no conecta con "Es audio"');
  const [ax, ay] = esAudio.position;
  const tabla = (name, id, operation, extra, notes) => addNode(wf.nodes, {
    parameters: { resource: 'row', operation, dataTableId: { ...ESPERA_TABLA }, ...extra },
    id,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [ax, ay],
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    notes,
  });
  addNode(wf.nodes, {
    parameters: condicion('es-texto-1', "={{ String($('WhatsApp Trigger').first().json.messages?.[0]?.text?.body || '').trim() }}", { type: 'string', operation: 'notEmpty', singleValue: true }),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0016',
    name: 'Es texto',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [ax, ay],
    notes: 'Solo los mensajes escritos esperan 5 segundos. Un audio o una foto siguen de inmediato.',
  });
  tabla('Anotar mensaje', '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0017', 'insert', {
    columns: {
      mappingMode: 'defineBelow',
      value: { numero: ESPERA_NUMERO, mensaje_id: '={{ ' + ESPERA_MENSAJE_ID + ' }}', texto: "={{ String($('WhatsApp Trigger').first().json.messages?.[0]?.text?.body || '') }}" },
      matchingColumns: [],
      schema: ['numero', 'mensaje_id', 'texto'].map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
    },
    options: {},
  }, 'Guarda el mensaje en whatsapp_espera para que los que lleguen despues lo vean.');
  addNode(wf.nodes, {
    parameters: { amount: ESPERA_SEGUNDOS, unit: 'seconds' },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0018',
    name: 'Esperar 5 segundos',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [ax, ay],
    webhookId: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0118',
    notes: 'AQUI se cambia cuanto se espera despues del ultimo mensaje antes de contestar.',
  });
  tabla('Leer mensajes', '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0019', 'get', { matchType: 'allConditions', filters: ESPERA_FILTRO, returnAll: true },
    'Todos los mensajes de este numero que siguen en espera.');
  addNode(wf.nodes, {
    parameters: { jsCode: snippets.espera.replace(/\s+$/, '') + '\n\n' + JUNTAR_MENSAJES },
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0020',
    name: 'Juntar mensajes',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [ax, ay],
    notes: 'Si llego otro mensaje despues de este, este se retira. Si es el ultimo, junta el texto de todos.',
  });
  addNode(wf.nodes, {
    parameters: condicion('soy-el-ultimo-1', '={{ $json.seguir !== false }}', { type: 'boolean', operation: 'true', singleValue: true }),
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0021',
    name: 'Soy el ultimo',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [ax, ay],
  });
  // Arriba de "Es audio": con executionOrder v1 la tabla se vacía antes de seguir con el mensaje.
  tabla('Limpiar espera', '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0022', 'deleteRows', { matchType: 'allConditions', filters: ESPERA_FILTRO, options: {} },
    'Vacia la espera de este numero: ya se van a contestar todos juntos.');
  get('Limpiar espera').position = [ax, ay - 224];
  addNode(wf.nodes, {
    parameters: {},
    id: '5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f0023',
    name: 'Mensaje juntado',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [ax, ay],
    notes: 'Llego otro mensaje despues: este no contesta, lo hace el ultimo con el texto de todos.',
  });
  wf.connections['Solo mi numero'] = { main: [link('Es texto')[0], ...(wf.connections['Solo mi numero'].main.slice(1))] };
  wf.connections['Es texto'] = { main: [link('Anotar mensaje')[0], link('Es audio')[0]] };
  wf.connections['Anotar mensaje'] = { main: link('Esperar 5 segundos') };
  wf.connections['Esperar 5 segundos'] = { main: link('Leer mensajes') };
  wf.connections['Leer mensajes'] = { main: link('Juntar mensajes') };
  wf.connections['Juntar mensajes'] = { main: link('Soy el ultimo') };
  wf.connections['Soy el ultimo'] = { main: [link('Limpiar espera', 'Es audio')[0], link('Mensaje juntado')[0]] };
  delete wf.connections['Limpiar espera'];
  delete wf.connections['Mensaje juntado'];

  // 12. Emojis en las opciones que se le ofrecen al cliente (publicar / cambiar, borrar / cancelar).
  const esperar = get('Esperar respuesta');
  esperar.parameters.message = ESPERAR_RESPUESTA.message;
  esperar.parameters.options = { ...(esperar.parameters.options || {}), ...ESPERAR_RESPUESTA.options };
  const borrado = get('Confirmar borrado').parameters;
  borrado.approvalOptions = { values: { ...(borrado.approvalOptions?.values || {}), ...BORRADO } };

  // 13. Lienzo: cada nodo en su sección, con su nota (scripts/n8n-lienzo.mjs).
  if (lienzo) ordenarLienzo(wf);

  if ('nodeCount' in wf) wf.nodeCount = wf.nodes.length;
  return wf;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Uso: node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>');
    process.exit(1);
  }
  const snippets = Object.fromEntries(['firma', 'consumo', 'formato', 'prompt', 'clasificador', 'comandos', 'respuestas', 'espera'].map((k) => [k, readFileSync(join(ROOT, 'n8n/' + k + '.js'), 'utf8')]));
  const wf = patchWorkflow(JSON.parse(readFileSync(input, 'utf8')), snippets);
  // Solo lo que el editor de n8n necesita para importar.
  const { name, nodes, connections, settings } = wf;
  writeFileSync(output, JSON.stringify({ name, nodes, connections, settings }, null, 2));
  console.log(`${nodes.length} nodos -> ${output}`);
}

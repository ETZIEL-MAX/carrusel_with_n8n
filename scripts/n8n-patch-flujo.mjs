// Parcha el JSON exportado del flujo de n8n del carrusel:
//   - los nodos de firma usan n8n/firma.js y el token de la fila del cliente (sin secreto escrito)
//   - el flujo busca su token en la tabla whatsapp_numeros (Buscar token -> Adjuntar token)
//   - cada generación se reporta a /api/usage/USERx (Firmar consumo -> Reportar consumo)
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
        'const body = JSON.stringify(armarConsumo($input.first().json, String($execution.id), $runIndex));',
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

  if ('nodeCount' in wf) wf.nodeCount = wf.nodes.length;
  return wf;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Uso: node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>');
    process.exit(1);
  }
  const snippets = {
    firma: readFileSync(join(ROOT, 'n8n/firma.js'), 'utf8'),
    consumo: readFileSync(join(ROOT, 'n8n/consumo.js'), 'utf8'),
  };
  const wf = patchWorkflow(JSON.parse(readFileSync(input, 'utf8')), snippets);
  // Solo lo que el editor de n8n necesita para importar.
  const { name, nodes, connections, settings } = wf;
  writeFileSync(output, JSON.stringify({ name, nodes, connections, settings }, null, 2));
  console.log(`${nodes.length} nodos -> ${output}`);
}

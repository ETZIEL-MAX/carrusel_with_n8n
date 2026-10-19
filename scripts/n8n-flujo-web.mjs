// Arma el flujo de n8n "Generar desde web" (Crear con IA del panel) a partir del flujo de
// WhatsApp ya parchado: reutiliza la ruta del póster (director, prompt, Qwen/Wan, logo) tal
// cual, y cambia la entrada y la salida:
//   entrada: Webhook "Pedido web" (header X-Carrusel-Key) con lo que manda api/drafts.js
//   salida:  la imagen va por POST a callbackUrl con X-Draft-Token (api/drafts.js, handleDraftCallback)
//   error:   { error } al mismo callbackUrl (pedido no entendido o el generador falló)
// No hay WhatsApp, ni comandos, ni vista previa, ni reporte de consumo: el servidor cuenta la
// imagen al recibirla.
//
// Uso: node scripts/n8n-flujo-web.mjs <flujo-whatsapp-parchado.json> <salida.json> [salida.sdk.js]
// El .sdk.js es el código para create_workflow_from_code (MCP de n8n).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_BASE } from './n8n-patch-flujo.mjs';

export const WEB_PATH = 'generar-web-carrusel';
export const CALLBACK_PREFIX = `${APP_BASE}/api/drafts/callback?`;
const HEADER_AUTH = { id: 'OuoTQ4goYAY6kBG5', name: 'Alta de Numero' }; // X-Carrusel-Key = N8N_NUMBERS_SECRET

// Ruta del póster que se copia del flujo de WhatsApp (los nombres no cambian: el código de
// los nodos se refiere a otros por nombre).
export const KEEP = [
  'Init contexto', 'Instrucciones del director', 'Armar prompt', 'Redactar prompt', 'Parsear salida',
  'Es valido', 'Buscar en Drive', 'Elegir producto', 'Forzar Wan revision', 'Tiene foto',
  'Descargar foto', 'Ref Wan', 'Preparar Wan', 'Pedir Wan', 'Descargar Wan', 'Generar Wan',
  'Generar Qwen', 'Fijar foto', 'Con logo', 'Optimizar imagen', 'Optimizar imagen sin logo',
  'Descargar logo', 'Redimensionar logo', 'Info logo', 'Info poster', 'Merge',
  'Calcular posicion', 'Componer logo',
];
// Llamadas que pueden fallar: su salida de error avisa al panel.
const CON_ERROR = ['Redactar prompt', 'Generar Qwen', 'Pedir Wan', 'Descargar Wan'];

// Lo que "Init contexto" lee de "Traer settings" (data) y de su entrada (texto). En WhatsApp ese
// nodo es la respuesta de /api/settings-read; aquí sale del pedido del panel.
const TRAER_SETTINGS = [
  '// Pedido del panel (api/drafts.js) -> lo que "Init contexto" espera de /api/settings-read.',
  `var CALLBACK_PREFIX = ${JSON.stringify(CALLBACK_PREFIX)};`,
  "var p = $('Pedido web').first().json.body || {};",
  "if (typeof p.callbackUrl !== 'string' || p.callbackUrl.indexOf(CALLBACK_PREFIX) !== 0) { throw new Error('callbackUrl no permitida'); }",
  "if (!p.callbackToken) { throw new Error('Falta callbackToken'); }",
  "var texto = String(p.prompt || '').trim();",
  'var cambios = Array.isArray(p.changes) ? p.changes.filter(function (c) { return String(c || \'\').trim(); }) : [];',
  'if (cambios.length) {',
  "  texto += '\\n\\nCAMBIOS QUE PIDIO EL CLIENTE (aplicalos todos, en este orden):\\n' + cambios.map(function (c, i) { return (i + 1) + ') ' + String(c).trim(); }).join('\\n');",
  '}',
  'return [{ json: {',
  '  texto: texto,',
  '  data: {',
  '    googleDriveFolder: p.googleDriveFolder || null,',
  '    colorPalette: Array.isArray(p.colorPalette) ? p.colorPalette : [],',
  "    defaultOrientation: p.format || 'horizontal',",
  '    posterWidth: Number(p.width) || undefined,',
  '    posterHeight: Number(p.height) || undefined',
  '  }',
  '} }];',
].join('\n');

const pedido = (field) => `={{ $('Pedido web').first().json.body.${field} }}`;

export function buildWebWorkflow(whatsapp) {
  const src = JSON.parse(JSON.stringify(whatsapp));
  const byName = new Map(src.nodes.map((n) => [n.name, n]));
  for (const name of KEEP) if (!byName.has(name)) throw new Error(`Falta el nodo "${name}" en el flujo de WhatsApp`);

  const nodes = KEEP.map((name) => {
    const n = byName.get(name);
    const copy = { ...n };
    delete copy.id;
    delete copy.webhookId;
    if (CON_ERROR.includes(name)) copy.onError = 'continueErrorOutput';
    if (name === 'Init contexto') {
      // Lee de nodos de WhatsApp (todos en try/catch). Aquí apuntan a "Traer settings": trae
      // `texto` (en lugar de Juntar mensajes) y no tiene messages, choices ni con_logo, así
      // que el chat queda vacío y el póster lleva logo.
      let code = copy.parameters.jsCode;
      for (const ref of ['WhatsApp Trigger', 'Juntar mensajes', 'Transcribir audio', 'Detectar ruta']) {
        code = code.split(`$('${ref}')`).join("$('Traer settings')");
      }
      copy.parameters = { ...copy.parameters, jsCode: code };
    }
    return copy;
  });
  const init = byName.get('Init contexto').position;
  const comp = byName.get('Componer logo').position;
  nodes.push(
    {
      name: 'Pedido web',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [init[0] - 448, init[1]],
      parameters: { httpMethod: 'POST', path: WEB_PATH, authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
      credentials: { httpHeaderAuth: HEADER_AUTH },
      notes: 'Lo llama el carrusel (api/drafts.js) con el pedido de "Crear con IA". Responde 200 al instante.',
    },
    {
      name: 'Traer settings',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [init[0] - 224, init[1]],
      parameters: { jsCode: TRAER_SETTINGS },
      notes: 'Arma texto (pedido + cambios) y los ajustes del carrusel. Solo acepta callbackUrl del carrusel.',
    },
    {
      name: 'Enviar al panel',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [comp[0] + 224, comp[1]],
      parameters: {
        method: 'POST',
        url: pedido('callbackUrl'),
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-Draft-Token', value: pedido('callbackToken') }] },
        sendBody: true,
        contentType: 'binaryData',
        inputDataFieldName: 'data',
        options: { timeout: 60000 },
      },
      retryOnFail: true,
      notes: 'La imagen terminada vuelve al panel como borrador.',
    },
    {
      name: 'Avisar error',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [comp[0] + 224, comp[1] + 224],
      parameters: {
        method: 'POST',
        url: pedido('callbackUrl'),
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-Draft-Token', value: pedido('callbackToken') }] },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ error: $json.valido === 'no' ? 'No entendí qué imagen quieres. Escríbelo con más detalle.' : 'No se pudo generar la imagen. Pide cambios para intentarlo otra vez.' }) }}",
        options: { timeout: 30000 },
      },
      executeOnce: true,
      notes: 'El panel muestra el borrador en error y el cliente puede pedir cambios para reintentar.',
    },
  );

  // Conexiones: las de la ruta del póster entre nodos copiados; lo que iba a WhatsApp, al consumo
  // o a la subida firmada se reemplaza.
  const REPLACE = {
    'Send a text message': 'Generar Qwen', // "estoy generando..." por WhatsApp
    'Subir imagen compuesta': 'Enviar al panel',
    'Aviso no entendido': 'Avisar error',
  };
  const keep = new Set(nodes.map((n) => n.name));
  const connections = {};
  for (const name of KEEP) {
    const main = (src.connections[name]?.main || []).map((out) => {
      const seen = new Set();
      return (out || [])
        .map((c) => ({ ...c, node: REPLACE[c.node] || c.node }))
        .filter((c) => keep.has(c.node) && !seen.has(c.node + '#' + c.index) && seen.add(c.node + '#' + c.index));
    });
    if (CON_ERROR.includes(name)) {
      while (main.length < 1) main.push([]);
      main[1] = [{ node: 'Avisar error', type: 'main', index: 0 }];
    }
    if (main.some((o) => o.length)) connections[name] = { main };
  }
  // "Ref Wan" avisaba por WhatsApp y seguía a Preparar Wan: queda solo lo segundo (ya filtrado).
  connections['Pedido web'] = { main: [[{ node: 'Traer settings', type: 'main', index: 0 }]] };
  connections['Traer settings'] = { main: [[{ node: 'Init contexto', type: 'main', index: 0 }]] };

  // Ningún nodo copiado puede depender de uno que no está.
  const missing = [];
  for (const n of nodes) {
    const s = JSON.stringify(n.parameters);
    for (const m of s.matchAll(/\$\(\\?["']([^"'\\]+)\\?["']\)/g)) if (!keep.has(m[1])) missing.push(`${n.name} -> ${m[1]}`);
  }
  return { name: 'GENERAR_DESDE_WEB', nodes, connections, settings: { executionOrder: 'v1', binaryMode: src.settings?.binaryMode || 'separate' }, missing: [...new Set(missing)] };
}

// Código del SDK de n8n para create_workflow_from_code.
export function toSdk(wf) {
  const v = new Map(wf.nodes.map((n, i) => [n.name, `n${i}`]));
  const lines = ["import { workflow, node, trigger } from '@n8n/workflow-sdk';", ''];
  for (const n of wf.nodes) {
    const config = { name: n.name, parameters: n.parameters, position: n.position };
    for (const k of ['credentials', 'onError', 'retryOnFail', 'alwaysOutputData', 'executeOnce', 'notes', 'disabled']) {
      if (n[k] !== undefined) config[k] = n[k];
    }
    const fn = n.type === 'n8n-nodes-base.webhook' ? 'trigger' : 'node';
    lines.push(`const ${v.get(n.name)} = ${fn}(${JSON.stringify({ type: n.type, version: n.typeVersion, config })});`);
  }
  lines.push('', `export default workflow('generar-desde-web', ${JSON.stringify(wf.name)})`);
  const linked = new Set();
  for (const [from, { main }] of Object.entries(wf.connections)) {
    main.forEach((out, k) => (out || []).forEach((c) => {
      const target = c.index ? `${v.get(c.node)}.input(${c.index})` : v.get(c.node);
      lines.push(`  .add(${v.get(from)}.output(${k}).to(${target}))`);
      linked.add(from); linked.add(c.node);
    }));
  }
  for (const n of wf.nodes) if (!linked.has(n.name)) lines.push(`  .add(${v.get(n.name)})`);
  return lines.join('\n') + ';\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output, sdkOut] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Uso: node scripts/n8n-flujo-web.mjs <flujo-whatsapp-parchado.json> <salida.json> [salida.sdk.js]');
    process.exit(1);
  }
  const wf = buildWebWorkflow(JSON.parse(readFileSync(input, 'utf8')));
  if (wf.missing.length) {
    console.error('Nodos que dependen de otros que no están en el flujo web:\n  ' + wf.missing.join('\n  '));
    process.exit(1);
  }
  const { missing, ...out } = wf;
  writeFileSync(output, JSON.stringify(out, null, 2));
  if (sdkOut) writeFileSync(sdkOut, toSdk(out));
  console.log(`${out.nodes.length} nodos -> ${output}${sdkOut ? ' y ' + sdkOut : ''}`);
}

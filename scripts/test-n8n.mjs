// Pruebas del código que se pega en los nodos Code de n8n (carpeta n8n/) y del
// script que parcha el flujo. No necesita servidor. Uso: npm run test:n8n
import { readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let pass = 0;
let total = 0;
function check(name, ok, extra = '') {
  total++;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
}

// Los archivos de n8n/ no tienen import/export (van pegados en un nodo Code):
// se evalúan y se devuelven las funciones pedidas.
function loadSnippet(path, names) {
  const src = readFileSync(join(ROOT, path), 'utf8');
  return new Function(src + '\n; return {' + names.join(',') + '};')();
}

const ref = (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex');
const NOW = 1791478522745; // -> timestamp "1791478522"

console.log('== n8n/firma.js ==');
const { hmacSha256Hex, firmar } = loadSnippet('n8n/firma.js', ['hmacSha256Hex', 'firmar']);

for (const msg of ['{}', 'ñandú 20% más 🎉', 'x'.repeat(3 * 1024 * 1024)]) {
  const t0 = Date.now();
  const ok = hmacSha256Hex('k'.repeat(64), msg) === ref('k'.repeat(64), msg);
  check(`hmac puro = node:crypto (${msg.length} caracteres)`, ok && Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
}

let f = firmar('a'.repeat(64), '{"a":1}', NOW);
check('token antiguo: firma solo el cuerpo', f.signature === ref('a'.repeat(64), '{"a":1}') && f.timestamp === '1791478522' && f.body === '{"a":1}');

f = firmar('crt_abc', '{"a":1}', NOW);
check('token crt_: firma "<timestamp>.<cuerpo>"', f.signature === ref('crt_abc', '1791478522.{"a":1}') && f.timestamp === '1791478522');

check('token con espacios alrededor', firmar('  crt_abc \n', '{}', NOW).signature === ref('crt_abc', '1791478522.{}'));
check('sin nowMs usa la hora actual', Math.abs(Number(firmar('crt_abc', '{}').timestamp) - Date.now() / 1000) < 5);

for (const t of ['', '   ', null, undefined]) {
  let msg = '';
  try { firmar(t, '{}', NOW); } catch (e) { msg = e.message; }
  check('sin token ' + JSON.stringify(t) + ' -> error claro', msg === 'Este cliente no tiene token en la tabla whatsapp_numeros', msg);
}

console.log('\n== n8n/consumo.js ==');
const { armarConsumo } = loadSnippet('n8n/consumo.js', ['armarConsumo']);
const wan = { model: 'wan2.7-image-pro', imageUrl: 'https://x/y.png', usage: { input_tokens: 200, output_tokens: 1000, total_tokens: 1200, image_count: 1 } };

let c = armarConsumo(wan, '4521', 0);
check('Wan: imagen con sus tokens', c.eventId === '4521-gen-0' && c.kind === 'image' && c.count === 1 && c.model === 'wan2.7-image-pro' && c.tokens?.total_tokens === 1200, JSON.stringify(c));
check('otra ronda = otro evento', armarConsumo(wan, '4521', 1).eventId === '4521-gen-1');

c = armarConsumo({ imageUrl: 'https://x/q.png' }, '4521', 0);
check('Qwen: sin tokens y con su modelo', c.model === 'qwen-image-3.0-pro' && !('tokens' in c), JSON.stringify(c));
for (const usage of [{}, null, { total_tokens: 0, input_tokens: 0 }, { image_count: 1 }]) {
  check('usage sin tokens ' + JSON.stringify(usage) + ' -> no manda tokens', !('tokens' in armarConsumo({ model: 'm', usage }, '1', 0)));
}
check('solo output_tokens también cuenta', armarConsumo({ usage: { output_tokens: 5 } }, '1', 0).tokens?.output_tokens === 5);
check('entrada vacía no rompe', armarConsumo(undefined, '1', 0).kind === 'image');

const J = JSON.stringify;
check('texto (chat de OpenRouter): sus tokens', (() => {
  const chat = { id: 'gen-1', model: 'deepseek/deepseek-v4.1-flash', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1319, completion_tokens: 3800, total_tokens: 5119, cost: 0.001 } };
  return J(armarConsumo(chat, '77', 3)) === J({ eventId: '77-txt-3', kind: 'text', model: 'deepseek/deepseek-v4.1-flash', tokens: chat.usage });
})());
check('audio (transcripción): también kind text', (() => {
  const t = armarConsumo({ model: 'google/gemini-3.5-flash-lite', choices: [{ message: { content: 'hola' } }], usage: { prompt_tokens: 249, completion_tokens: 14, total_tokens: 263 } }, '77', 0);
  return t.kind === 'text' && t.model === 'google/gemini-3.5-flash-lite' && t.tokens.total_tokens === 263;
})());
check('texto sin usage -> no se reporta', armarConsumo({ choices: [{ message: { content: 'FALSE' } }] }, '77', 0) === null);
check('texto con tokens en cero -> no se reporta', armarConsumo({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }, '77', 0) === null);
check('la imagen sigue igual', armarConsumo({ model: 'wan2.7-image-pro', usage: {} }, '77', 1).eventId === '77-gen-1');
check('una llamada que falló (continueRegularOutput deja {error}) -> no se reporta', armarConsumo({ error: { message: 'fallo' } }, '77', 0) === null && armarConsumo({ error: 'x', choices: [] }, '77', 0) === null);

console.log('\n== n8n/formato.js ==');
const loadAll = (paths, names) => new Function(paths.map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n') + '\n; return {' + names.join(',') + '};')();
const { tamanoPoster, zonaLogo, posicionLogo, tamanoGeneracion, reglasLayout } = loadSnippet('n8n/formato.js', ['tamanoPoster', 'zonaLogo', 'posicionLogo', 'tamanoGeneracion', 'reglasLayout']);
check('tamanoPoster usa el tamaño que manda el servidor', J(tamanoPoster({ posterWidth: 3840, posterHeight: 2160, defaultOrientation: 'horizontal' })) === J({ formato: 'horizontal', ancho: 3840, alto: 2160, texto: 'horizontal 16:9' }), J(tamanoPoster({ posterWidth: 3840, posterHeight: 2160, defaultOrientation: 'horizontal' })));
check('tamanoPoster: vertical 3:4 con tamaño del servidor', J(tamanoPoster({ posterWidth: 1080, posterHeight: 1440, defaultOrientation: 'vertical34' })) === J({ formato: 'vertical34', ancho: 1080, alto: 1440, texto: 'vertical 3:4' }));
const fullhd = { horizontal: [1920, 1080], vertical: [1080, 1920], cuadrado: [1080, 1080], horizontal43: [1440, 1080], vertical34: [1080, 1440] };
for (const [fmt, [an, al]] of Object.entries(fullhd)) {
  const r = tamanoPoster({ defaultOrientation: fmt });
  check('tamanoPoster sin tamaño del servidor (' + fmt + ') -> Full HD de siempre', r.ancho === an && r.alto === al && r.formato === fmt, J(r));
}
check('tamanoPoster sin nada -> horizontal Full HD', J(tamanoPoster({})) === J({ formato: 'horizontal', ancho: 1920, alto: 1080, texto: 'horizontal 16:9' }) && tamanoPoster(undefined).ancho === 1920);
check('tamanoPoster con tamaño absurdo -> Full HD', tamanoPoster({ posterWidth: 99999, posterHeight: 5, defaultOrientation: 'vertical' }).ancho === 1080);
check('tamanoPoster con tamaño no entero -> Full HD', tamanoPoster({ posterWidth: '3840', posterHeight: 2160.5 }).ancho === 1920);
check('zonaLogo en 1920x1080 = la de hoy', J(zonaLogo(1920, 1080)) === J({ logoAncho: 420, logoAlto: 224, margen: 50, zonaAnchoPct: 27, zonaAltoPct: 30 }), J(zonaLogo(1920, 1080)));
check('zonaLogo en 4K duplica el logo', zonaLogo(3840, 2160).logoAncho === 840 && zonaLogo(3840, 2160).logoAlto === 448 && zonaLogo(3840, 2160).margen === 100, J(zonaLogo(3840, 2160)));
check('zonaLogo en vertical Full HD conserva el tamaño', zonaLogo(1080, 1920).logoAncho === 420 && zonaLogo(1080, 1920).margen === 50);
check('zonaLogo en HD achica el logo', zonaLogo(1280, 720).logoAncho < 420 && zonaLogo(1280, 720).logoAncho > 200, J(zonaLogo(1280, 720)));
check('posicionLogo esquina inferior derecha', J(posicionLogo(1920, 1080, 420, 224, 50)) === J({ posX: 1450, posY: 806 }));
check('posicionLogo nunca negativa si el póster salió chico', J(posicionLogo(300, 200, 420, 224, 50)) === J({ posX: 0, posY: 0 }));
check('tamanoGeneracion recorta 4K a 2048', J(tamanoGeneracion(3840, 2160, 2048)) === J({ ancho: 2048, alto: 1152 }), J(tamanoGeneracion(3840, 2160, 2048)));
check('tamanoGeneracion no toca lo que cabe', J(tamanoGeneracion(1080, 1920, 2048)) === J({ ancho: 1080, alto: 1920 }));
check('tamanoGeneracion vertical 4K: proporción y medidas pares', (() => { const g = tamanoGeneracion(2160, 3840, 2048); return g.alto === 2048 && g.ancho === 1152 && g.ancho % 2 === 0; })());
const rules = reglasLayout(1920, 1080);
check('reglas: pide lienzo completo', /FULL BLEED/.test(rules) && /entire right side/.test(rules));
check('reglas: ya no manda todo a la izquierda', !/on the left or the top/.test(rules) && !/must stay EMPTY/.test(rules));
check('reglas: zona del logo con sus porcentajes', /27 percent of the width and 30 percent of the height/.test(rules), rules.slice(-300));
check('reglas: conservan formato y ajuste de textos', /EXACTLY 1920x1080 pixels/.test(rules) && /TEXT FIT/.test(rules) && /HORIZONTAL \(landscape\)/.test(rules));
check('reglas: vertical y cuadrado', /VERTICAL \(portrait\)/.test(reglasLayout(1080, 1920)) && /SQUARE/.test(reglasLayout(1080, 1080)));

console.log('\n== n8n/prompt.js ==');
const { armarMensajes } = loadAll(['n8n/formato.js', 'n8n/prompt.js'], ['armarMensajes']);
const msgs = armarMensajes({ texto: 'TACOS 3X50', producto: '', ronda: 2, prompt_base: 'OLD PROMPT', colorPalette: ['#ff0000'] }, { ancho: 1080, alto: 1920, formato_texto: 'vertical 9:16, EXACTAMENTE 1080x1920 pixeles' });
check('mensajes: system + user', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');
check('system: prohíbe el lado vacío y describe la esquina', /PROHIBIDO dejar una mitad/.test(msgs[0].content) && /esquina INFERIOR DERECHA/.test(msgs[0].content));
check('system: el logo no lo genera el modelo y su esquina continúa la escena', /NO generes, dibujes ni insinues ningun logo/.test(msgs[0].content) && /MISMO fondo de la escena continua/.test(msgs[0].content));
check('system: ya no pide la esquina "completamente vacia"', !/COMPLETAMENTE LIMPIA, CLARA, VACIA/.test(msgs[0].content) && !/agrega que siempre cree/.test(msgs[0].content));
check('system: lleva el formato y el lienzo exactos', /vertical 9:16, EXACTAMENTE 1080x1920 pixeles/.test(msgs[0].content) && /lienzo 1080x1920/.test(msgs[0].content));
check('system: conserva validez, FALSE y formato JSON', /responde FALSE UNICAMENTE/i.test(msgs[0].content) && /producto \(nombre corto/.test(msgs[0].content) && /prompt_final/.test(msgs[0].content));
check('system: porcentajes de la zona del logo según el formato', /aproximadamente 48 por ciento del ancho y 17 por ciento del alto/.test(msgs[0].content), (msgs[0].content.match(/aproximadamente \d+ por ciento del ancho y \d+ por ciento del alto/) || [''])[0]);
check('user: lleva mensaje, ronda, prompt anterior y paleta', ['TACOS 3X50', 'RONDA: 2', 'OLD PROMPT', '#ff0000'].every((t) => msgs[1].content.includes(t)));
check('user: sin paleta pide una acorde al producto', /PALETA: elige una paleta/.test(armarMensajes({ texto: 'x' }, { ancho: 1920, alto: 1080, formato_texto: 'h' })[1].content));
check('entrada vacía no rompe', armarMensajes(undefined, undefined).length === 2);

console.log('\n== el export del flujo no sale del equipo ==');
// n8n/.work/ guarda exports que pueden traer secretos: ni a git ni a la imagen de Docker.
const ignora = (f) => existsSync(join(ROOT, f)) && readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).some((l) => /^n8n(\/\.work\/?)?$/.test(l.trim()));
check('.gitignore excluye n8n/.work', ignora('.gitignore'));
check('.dockerignore excluye n8n/.work (la imagen no lleva el export)', ignora('.dockerignore'));

console.log('\n== scripts/n8n-patch-flujo.mjs ==');
// El export del flujo trae secretos y no está en git: sin él, este bloque se salta.
const exportPath = join(ROOT, process.argv[2] || 'n8n/.work/copia.json');
const yaParchado = process.argv.includes('--parchado'); // verificar lo que quedó guardado en n8n
if (!existsSync(exportPath)) {
  console.log('SKIP  no existe ' + exportPath);
} else {
  const { patchWorkflow } = await import('./n8n-patch-flujo.mjs');
  const snippets = Object.fromEntries(['firma', 'consumo', 'formato', 'prompt'].map((k) => [k, readFileSync(join(ROOT, 'n8n/' + k + '.js'), 'utf8')]));
  const copia = JSON.parse(readFileSync(exportPath, 'utf8'));
  const antes = JSON.stringify(copia);
  const out = patchWorkflow(copia, snippets);
  const node = (n) => out.nodes.find((x) => x.name === n);
  const next = (n) => (out.connections[n]?.main?.[0] || []).map((x) => x.node);

  check('82 nodos', out.nodes.length === 82, out.nodes.length);
  check('nombres de nodo sin repetir', new Set(out.nodes.map((n) => n.name)).size === out.nodes.length);
  check('idempotente', JSON.stringify(patchWorkflow(out, snippets)) === JSON.stringify(out));
  check('no muta la entrada', JSON.stringify(copia) === antes);
  // n8n reordena claves y conexiones al guardar: se compara sin importar el orden.
  const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  // Lo guardado se compara por comportamiento: la posición en el lienzo no cuenta (un nodo se puede mover) y
  // n8n omite los valores por defecto al guardar (resource 'row' y condition 'eq' de la tabla).
  const sinLayout = (n) => {
    const { position, ...rest } = n;
    const p = JSON.parse(JSON.stringify(rest.parameters || {}));
    if (p.resource === 'row') delete p.resource;
    for (const c of p.filters?.conditions || []) if (c.condition === 'eq') delete c.condition;
    return { ...rest, parameters: p };
  };
  const byName = (nodes) => canon(nodes.map(sinLayout).sort((a, b) => a.name.localeCompare(b.name)));
  const links = (conns) => Object.entries(conns).flatMap(([s, v]) => Object.entries(v).flatMap(([t, outs]) => outs.flatMap((arr, i) => (arr || []).map((x) => [s, t, i, x.node, x.index].join('|'))))).sort().join('\n');
  if (yaParchado) check('lo guardado en n8n ya es el flujo parchado', byName(out.nodes) === byName(copia.nodes) && links(out.connections) === links(copia.connections));
  else check('la entrada tenía 78 nodos', copia.nodes.length === 78, copia.nodes.length);

  for (const n of ['Firmar settings', 'Firmar comando', 'Subir imagen compuesta', 'Firmar webhook', 'Firmar consumo']) {
    const code = node(n)?.parameters?.jsCode || '';
    check(n + ': sin secreto escrito', code !== '' && !/WEBHOOK_SECRET|\bsecret\b/.test(code) && !/['"][A-Za-z0-9_\-]{28,}['"]/.test(code));
    check(n + ': empieza con n8n/firma.js', code.startsWith(snippets.firma));
  }
  check('ningún nodo conserva el secreto', !/WEBHOOK_SECRET/.test(JSON.stringify(out.nodes)));
  for (const n of ['Traer settings', 'Llamar manage', 'Subir imagen compuesta - HTTP', 'Publicar en carrusel', 'Reportar consumo']) {
    const hs = node(n)?.parameters?.headerParameters?.parameters || [];
    check(n + ': manda X-Webhook-Timestamp una vez', hs.filter((h) => h.name === 'X-Webhook-Timestamp' && h.value === '={{ $json.timestamp }}').length === 1 && hs.some((h) => h.name === 'X-Webhook-Secret'));
  }

  check('el token se busca antes de Variables', next('WhatsApp Trigger').join() === 'Buscar token' && next('Buscar token').join() === 'Adjuntar token' && next('Adjuntar token').join() === 'Variables');
  const bt = node('Buscar token');
  // Misma fila que eligió el recepcionista: por número (no por carrusel, que puede repetirse o venir en otra caja).
  const conds = bt?.parameters.filters.conditions || [];
  check('Buscar token: fila del número que escribe, activa, siempre da salida', bt?.alwaysOutputData === true && bt.parameters.dataTableId.value === 'l7BmjGQTMBUFwDoB' && bt.parameters.matchType === 'allConditions' && bt.parameters.limit === 1
    && conds.length === 2 && conds.some((x) => x.keyName === 'numero' && x.keyValue === "={{ String($json.messages?.[0]?.from ?? '').replace(/\\D/g, '').slice(-10) }}") && conds.some((x) => x.keyName === 'activo' && x.condition === 'isTrue'), JSON.stringify(conds));
  for (const g of ['Generar Wan', 'Generar Qwen']) {
    check(g + ' -> Fijar foto y Firmar consumo', next(g).includes('Fijar foto') && next(g).filter((x) => x === 'Firmar consumo').length === 1, next(g).join());
  }
  check('Firmar consumo -> Reportar consumo', next('Firmar consumo').join() === 'Reportar consumo');
  const rc = node('Reportar consumo');
  check('el reporte no puede romper el flujo', rc?.onError === 'continueRegularOutput' && rc.parameters.options.response.response.neverError === true && rc.parameters.options.timeout === 10000 && !out.connections['Reportar consumo']);
  check('el reporte va a /api/usage/USERx', rc?.parameters.url.includes("/api/usage/' + encodeURIComponent") && !rc.parameters.url.includes('/api/manage/'));
  check('Llamar manage sigue yendo a /api/manage/', node('Llamar manage').parameters.url.includes('/api/manage/'));
  // executionOrder v1: la rama de arriba corre primero; abajo, el reporte esperaría la aprobación del cliente.
  check('el consumo corre antes que el póster', node('Firmar consumo').position[1] < node('Fijar foto').position[1] && node('Firmar consumo').position[1] < node('Generar Wan').position[1] && out.settings?.executionOrder === 'v1');

  // Ejecutar de verdad el código parchado, con las variables de n8n simuladas.
  const AsyncFunction = (async () => {}).constructor;
  // `nodes` = lo que devuelven $('Nodo').first()/last() de otros nodos; `self` = el `this` del nodo.
  const run = (name, { token, input = {}, executionId = '1', runIndex = 0, nodes = {}, binary, self } = {}) =>
    new AsyncFunction('$', '$input', '$execution', '$runIndex', '$vars', node(name).parameters.jsCode).call(
      self || {},
      (n) => {
        const item = { json: n === 'Variables' ? { token } : (nodes[n] || {}), binary: nodes[n + '#binary'] };
        return { first: () => item, last: () => item, all: () => [item] };
      },
      { first: () => ({ json: input, binary }) }, { id: executionId }, runIndex, { WEBHOOK_SECRET: 'no-se-debe-usar' });

  for (const [token, firmado] of [['a'.repeat(64), (ts, b) => b], ['crt_abc', (ts, b) => ts + '.' + b]]) {
    const j = (await run('Firmar comando', { token, input: { bodyToSign: '{"action":"list"}' } }))[0].json;
    check('Firmar comando con token ' + token.slice(0, 4) + '…', j.body === '{"action":"list"}' && /^\d{10}$/.test(j.timestamp) && j.signature === ref(token, firmado(j.timestamp, j.body)));
  }
  let j = (await run('Firmar settings', { token: 'crt_abc' }))[0].json;
  // El cuerpo lleva el id de la ejecución: dos mensajes en el mismo segundo no repiten firma (el servidor rechaza firmas repetidas).
  check('Firmar settings: cuerpo único por ejecución', j.body === '{"n":"1"}' && j.signature === ref('crt_abc', j.timestamp + '.' + j.body), j.body);
  const j2 = (await run('Firmar settings', { token: 'crt_abc', executionId: '2' }))[0].json;
  check('Firmar settings: otra ejecución, otra firma', j2.body === '{"n":"2"}' && (j2.signature !== j.signature || j2.timestamp !== j.timestamp));
  j = (await run('Firmar consumo', { token: 'crt_abc', input: wan, executionId: '77', runIndex: 3 }))[0].json;
  check('Firmar consumo arma y firma el reporte', j.body === JSON.stringify(armarConsumo(wan, '77', 3)) && JSON.parse(j.body).eventId === '77-gen-3' && j.signature === ref('crt_abc', j.timestamp + '.' + j.body));
  for (const n of ['Firmar settings', 'Firmar comando', 'Firmar consumo']) {
    let msg = '';
    try { await run(n, { token: '' }); } catch (e) { msg = e.message; }
    check(n + ' sin token -> se detiene con error claro', msg === 'Este cliente no tiene token en la tabla whatsapp_numeros', msg);
  }

  // ===== Formato por resolución, prompt por HTTP y consumo de texto =====
  const names = out.nodes.map((n) => n.name);
  const code = (n) => node(n)?.parameters?.jsCode || '';
  check('ya no hay nodo de agente ni su modelo', !names.includes('AI Agent') && !names.includes('OpenRouter Chat Model'));
  check('hay Armar prompt y Redactar prompt', names.includes('Armar prompt') && names.includes('Redactar prompt'));
  check('lo que entraba al agente entra a Armar prompt', ['Init contexto', 'Ronda tope'].every((n) => next(n).includes('Armar prompt')) && !['Init contexto', 'Ronda tope'].some((n) => next(n).includes('AI Agent')), ['Init contexto', 'Ronda tope'].map((n) => next(n).join('+')).join(' | '));
  check('Armar prompt -> Redactar prompt', next('Armar prompt').join() === 'Redactar prompt');
  check('Redactar prompt -> Parsear salida y Firmar consumo', ['Parsear salida', 'Firmar consumo'].every((n) => next('Redactar prompt').includes(n)) && next('Redactar prompt').length === 2, next('Redactar prompt').join());
  check('el audio también reporta consumo', next('Transcribir audio').includes('Firmar consumo') && next('Transcribir audio').includes('Firmar settings') && next('Transcribir audio').length === 2, next('Transcribir audio').join());
  const rp = node('Redactar prompt');
  check('Redactar prompt: OpenRouter con la misma credencial que el audio', rp?.parameters.url === 'https://openrouter.ai/api/v1/chat/completions' && J(rp.credentials) === J(node('Transcribir audio').credentials) && rp.parameters.nodeCredentialType === 'openRouterApi', J(rp?.credentials));
  check('Redactar prompt: manda el cuerpo que arma Armar prompt y reintenta', rp?.parameters.jsonBody === '={{ $json.body }}' && rp.parameters.options.timeout === 120000 && rp.retryOnFail === true && rp.maxTries === 2);
  const existen = new Set(names);
  const rotas = Object.entries(out.connections).flatMap(([s, v]) => (existen.has(s) ? [] : [s + ' (origen)']).concat(Object.values(v).flatMap((outs) => outs.flatMap((arr) => (arr || []).filter((x) => !existen.has(x.node)).map((x) => s + ' -> ' + x.node)))));
  check('ninguna conexión apunta a un nodo que no existe', rotas.length === 0, rotas.join(', '));
  check('Init contexto: usa tamanoPoster y ya no tiene la tabla propia', code('Init contexto').startsWith(snippets.formato) && /tamanoPoster\(/.test(code('Init contexto')) && !/var FORMATOS = \{/.test(code('Init contexto')));
  check('Parsear salida: reglas de lienzo completo y respuesta HTTP', code('Parsear salida').startsWith(snippets.formato) && /reglasLayout\(/.test(code('Parsear salida')) && /choices/.test(code('Parsear salida')) && !/on the left or the top/.test(code('Parsear salida')));
  check('el logo se escala con el formato', /logo_ancho/.test(J(node('Redimensionar logo').parameters)) && /logo_alto/.test(J(node('Redimensionar logo').parameters)) && /posicionLogo\(/.test(code('Calcular posicion')));
  check('Preparar Wan pide un tamaño que el modelo acepta', code('Preparar Wan').startsWith(snippets.formato) && /tamanoGeneracion\(/.test(code('Preparar Wan')));
  check('Firmar consumo no reporta si no hay tokens', /if \(!consumo\) \{ return \[\]; \}/.test(code('Firmar consumo')));
  check('Armar prompt: lleva formato.js y prompt.js', code('Armar prompt').startsWith(snippets.formato) && code('Armar prompt').includes(snippets.prompt));

  // Ejecutar de verdad los nodos nuevos o cambiados, con lo que mandaría n8n.
  const ic4k = { formato: 'vertical', ancho: 2160, alto: 3840, formato_texto: 'vertical 9:16, EXACTAMENTE 2160x3840 pixeles', logo_ancho: 840, logo_alto: 448, logo_margen: 100 };
  const body = JSON.parse((await run('Armar prompt', { input: { texto: 'PIZZA 2X1 $99', producto: '', ronda: 0, prompt_base: '', colorPalette: ['#112233'] }, nodes: { 'Init contexto': ic4k } }))[0].json.body);
  check('Armar prompt: cuerpo válido para OpenRouter', body.model === 'deepseek/deepseek-v4.1-flash' && body.messages.length === 2 && /PIZZA 2X1 \$99/.test(body.messages[1].content) && /lienzo 2160x3840/.test(body.messages[0].content), body.model);
  const parsed = (await run('Parsear salida', { input: { id: 'gen-1', choices: [{ message: { content: '{"producto":"PIZZA","prompt_final":"A poster of pizza"}' } }], usage: {} }, nodes: { 'Init contexto': ic4k } }))[0].json;
  check('Parsear salida: entiende la respuesta HTTP y agrega las reglas del formato', parsed.valido === 'si' && parsed.producto === 'PIZZA' && /EXACTLY 2160x3840 pixels/.test(parsed.prompt_final) && /FULL BLEED/.test(parsed.prompt_final) && /VERTICAL \(portrait\)/.test(parsed.prompt_final), parsed.valido);
  check('Parsear salida: no repite las reglas dos veces', (parsed.prompt_final.match(/FINAL LAYOUT RULES/g) || []).length === 1);
  const falso = (await run('Parsear salida', { input: { choices: [{ message: { content: 'FALSE' } }] }, nodes: { 'Init contexto': ic4k } }))[0].json;
  check('Parsear salida: FALSE sigue siendo no válido', falso.valido === 'no' && falso.prompt_final === '');
  const viejo = (await run('Parsear salida', { input: { output: '{"producto":"X","prompt_final":"Y"}' }, nodes: { 'Init contexto': ic4k } }))[0].json;
  check('Parsear salida: la salida del agente vieja también se entiende', viejo.valido === 'si');
  const ctxSettings = (o) => ({ 'WhatsApp Trigger': { messages: [{ from: '5218131395313', text: { body: 'hola' } }] }, 'Traer settings': { data: o } });
  const ini = (await run('Init contexto', { input: {}, nodes: ctxSettings({ defaultOrientation: 'vertical', posterWidth: 2160, posterHeight: 3840, googleDriveFolder: 'https://drive.google.com/drive/folders/ABC123' }) }))[0].json;
  check('Init contexto: toma el tamaño del servidor y escala el logo', ini.formato === 'vertical' && ini.ancho === 2160 && ini.alto === 3840 && ini.logo_ancho === 840 && ini.logo_alto === 448 && ini.logo_margen === 100 && /2160x3840/.test(ini.formato_texto) && ini.googleDriveFolder === 'ABC123', J(ini).slice(0, 220));
  const ini0 = (await run('Init contexto', { input: {}, nodes: ctxSettings({ defaultOrientation: 'cuadrado' }) }))[0].json;
  check('Init contexto: sin tamaño del servidor -> Full HD de siempre', ini0.formato === 'cuadrado' && ini0.ancho === 1080 && ini0.alto === 1080 && ini0.logo_ancho === 420 && ini0.logo_margen === 50, J(ini0).slice(0, 160));
  const pos = (await run('Calcular posicion', { nodes: { 'Init contexto': ic4k, 'Info poster': { size: { width: 2160, height: 3840 } } } }))[0].json;
  check('Calcular posicion: el logo grande va en la esquina del póster 4K', pos.posX === 2160 - 840 - 100 && pos.posY === 3840 - 448 - 100 && pos.lw === 840, J(pos));
  const chico = (await run('Calcular posicion', { nodes: { 'Init contexto': ic4k, 'Info poster': { size: { width: 300, height: 200 } } } }))[0].json;
  check('Calcular posicion: si el generador devolvió algo chico, el logo no queda fuera', chico.posX >= 0 && chico.posY >= 0, J(chico));
  const wanBody = JSON.parse((await run('Preparar Wan', {
    nodes: { 'Init contexto': { ancho: 3840, alto: 2160 }, 'Parsear salida': { prompt_final: 'P' } },
    input: {}, binary: { data: { mimeType: 'image/png' } },
    self: { helpers: { getBinaryDataBuffer: async () => Buffer.from('img') } },
  }))[0].json.body);
  check('Preparar Wan: 4K se pide a 2048x1152 (el póster se lleva a 4K después)', wanBody.parameters.size === '2048*1152', wanBody.parameters.size);
  const wanFull = JSON.parse((await run('Preparar Wan', {
    nodes: { 'Init contexto': { ancho: 1920, alto: 1080 }, 'Parsear salida': { prompt_final: 'P' } },
    input: {}, binary: { data: { mimeType: 'image/png' } },
    self: { helpers: { getBinaryDataBuffer: async () => Buffer.from('img') } },
  }))[0].json.body);
  check('Preparar Wan: Full HD se pide como siempre (1920*1080)', wanFull.parameters.size === '1920*1080', wanFull.parameters.size);
  const chat = { model: 'deepseek/deepseek-v4.1-flash', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1319, completion_tokens: 3800, total_tokens: 5119 } };
  j = (await run('Firmar consumo', { token: 'crt_abc', input: chat, executionId: '77', runIndex: 4 }))[0].json;
  check('Firmar consumo: reporta el texto', JSON.parse(j.body).kind === 'text' && JSON.parse(j.body).eventId === '77-txt-4' && j.signature === ref('crt_abc', j.timestamp + '.' + j.body));
  check('Firmar consumo: un texto sin tokens no reporta nada', (await run('Firmar consumo', { token: 'crt_abc', input: { choices: [{ message: { content: 'FALSE' } }] } })).length === 0);
}

console.log(`\n${pass}/${total} pruebas OK`);
process.exit(pass === total ? 0 : 1);

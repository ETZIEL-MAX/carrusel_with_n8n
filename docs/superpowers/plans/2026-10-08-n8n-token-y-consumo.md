# n8n: token por fila y reporte de consumo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el flujo de n8n que no está en producción (`COPIA_SEGURIDAD_DIRECTOR_ARTE`) firme con el token de la fila del cliente en `whatsapp_numeros` y avise al carrusel cuántas imágenes y tokens generó.

**Architecture:** El código de los nodos Code vive en el repo (`n8n/firma.js`, `n8n/consumo.js`) y se prueba con Node contra `node:crypto` y contra el servidor local. Un script determinista (`scripts/n8n-patch-flujo.mjs`) toma el JSON exportado del flujo y devuelve el JSON parchado; ese archivo se importa en el flujo apagado. Nada de producción se edita: el flujo lee su propio token de la tabla.

**Tech Stack:** Node ≥18 (ESM, sin dependencias nuevas), n8n (instancia `n8n-produ`, herramientas MCP `mcp__n8n-produ__*`), servidor local `scripts/server.mjs`.

**Spec:** No hay documento de spec. Fuentes: `docs/N8N.md` secciones 12–14, `api/_webhook-shared.js` (`handleUsageReport`), `api/_utils.js` (`clientSignatureHasher`, `recordUsage`, `normalizeTokens`) y el pedido del usuario del 2026-10-08: «la columna de token (por ahora déjala con el token que ya está) y modificar el flujo que no está en producción haciendo que regrese los datos para saber cuántos tokens e imágenes generó».

## Global Constraints

- Flujo a modificar: **solo** `COPIA_SEGURIDAD_DIRECTOR_ARTE` (id `qLD8vfgXBAzLA7F1`, apagado, 78 nodos). No tocar `DIRECTOR_DE_ARTE_WHATSAPP` (`DinTtZKquv4f6b9p`), `RECEPCIONISTA_WHATSAPP` (`I3wl5U8QODEii75d`), `SAGA_BOT` ni `DIRECTOR_DE_ARTE_TELEGRAM`: están activos.
- Tabla: `whatsapp_numeros` (id `l7BmjGQTMBUFwDoB`, proyecto `5s81Ls35ZnA91dGG`). Único cambio permitido: **agregar** la columna `token` (string). No borrar ni renombrar nada.
- El valor de `token` por ahora es el secreto que ya usan los nodos (el `WEBHOOK_SECRET` global). Lo escribe el usuario a mano en n8n: las herramientas MCP no editan filas.
- Regla de firma (la decide el prefijo del token):
  - empieza con `crt_` → `X-Webhook-Secret = HMAC-SHA256 hex(token, "<timestamp>.<cuerpo>")`
  - cualquier otro → `X-Webhook-Secret = HMAC-SHA256 hex(token, "<cuerpo>")` (firma antigua)
  - `X-Webhook-Timestamp` (segundos Unix) se manda siempre; el servidor lo ignora en la firma antigua.
- El secreto no puede quedar escrito en ningún nodo, ni en el repo, ni en la salida de un comando. El JSON exportado del flujo lo contiene: vive solo en `n8n/.work/` (ignorado por git).
- Los nodos Code de este n8n no pueden usar `require('crypto')`: el HMAC es JS puro (función `hmacSha256Hex` que ya existe en los nodos).
- Sin `git push`, sin deploy al EC2. Los commits de este plan incluyen solo los archivos nuevos que crea cada tarea.
- Textos y comentarios en español; identificadores en inglés o como ya estén en el flujo.
- `https://carrusel.etziel.com` todavía **no** tiene `/api/usage/USERx` (la ronda está sin desplegar): hasta el deploy el reporte responde 404 y el flujo debe seguir igual.

## Review Focus

1. Fila sin `token` (columna vacía o cliente no encontrado) → el flujo se detiene con «Este cliente no tiene token en la tabla whatsapp_numeros», nunca firma con cadena vacía. (Task 1, Task 3)
2. El reporte de consumo falla (404 antes del deploy, 401, timeout) → el póster se genera y se envía igual. (Task 3)
3. Varias rondas de revisión en una misma ejecución → cada generación lleva un `eventId` distinto; el mismo `eventId` enviado dos veces no suma dos veces. (Task 2)
4. Generación sin `usage` (Qwen) o con `usage` en ceros → se manda sin `tokens` y cuenta en `imagesNoTokens`; nunca `tokens: {}`. (Task 2)
5. Cuerpo con ñ, acentos o emoji, y cuerpo de varios MB (base64 de la imagen) → la firma JS pura coincide con `node:crypto`. (Task 1)

---

### Task 1: `n8n/firma.js` — firma según el token

**Files:**
- Create: `n8n/firma.js`
- Create: `scripts/test-n8n.mjs`
- Modify: `package.json` (script `"test:n8n": "node scripts/test-n8n.mjs"`)
- Modify: `.gitignore` (línea `n8n/.work/`)

**Interfaces:**
- Produces: `n8n/firma.js`, texto que se pega tal cual al inicio de un nodo Code. Sin `import`/`export`/`require`. Define:
  - `utf8Bytes`, `SHA_K`, `sha256Bytes`… y `hmacSha256Hex(key: string, message: string): string` — copiadas **sin cambios** del nodo `Firmar settings` del flujo (todo lo que hay antes de la línea `const secret =`).
  - `firmar(token: string, body: string, nowMs?: number): { body: string, signature: string, timestamp: string }`
- Produces: en `scripts/test-n8n.mjs`, `loadSnippet(path: string, names: string[]): object` — lee el archivo y devuelve las funciones con `new Function(src + '; return {' + names.join(',') + '};')()`. La usan las tareas 2 y 3.

- [ ] **Step 1: Exportar el flujo a `n8n/.work/copia.json`**

Llamar `mcp__n8n-produ__get_workflow_details` con `workflowId: "qLD8vfgXBAzLA7F1"`; el resultado se guarda en un archivo de tool-results. Copiar el objeto `.workflow` de ese JSON a `n8n/.work/copia.json`. Antes, agregar `n8n/.work/` a `.gitignore`.

Verificar: `git status --short n8n/` no lista `n8n/.work/`.

- [ ] **Step 2: Escribir las pruebas que fallan** en `scripts/test-n8n.mjs`

Mismo estilo que `scripts/test-e2e.mjs` (función `check(name, ok, extra)`, código de salida 1 si algo falla). Casos:

```js
import { createHmac } from 'node:crypto';
const { hmacSha256Hex, firmar } = loadSnippet('n8n/firma.js', ['hmacSha256Hex', 'firmar']);
const ref = (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex');
const NOW = 1791478522745;            // -> timestamp "1791478522"

// HMAC puro == node:crypto
for (const msg of ['{}', 'ñandú 20% más 🎉', 'x'.repeat(3 * 1024 * 1024)])
  check('hmac ' + msg.length, hmacSha256Hex('k'.repeat(64), msg) === ref('k'.repeat(64), msg));

// token antiguo: firma solo el cuerpo
let f = firmar('a'.repeat(64), '{"a":1}', NOW);
check('antiguo', f.signature === ref('a'.repeat(64), '{"a":1}') && f.timestamp === '1791478522' && f.body === '{"a":1}');

// token crt_: firma "<timestamp>.<cuerpo>"
f = firmar('crt_abc', '{"a":1}', NOW);
check('crt_', f.signature === ref('crt_abc', '1791478522.{"a":1}'));

// espacios alrededor del token (copiado a mano en la tabla)
check('trim', firmar('  crt_abc \n', '{}', NOW).signature === ref('crt_abc', '1791478522.{}'));

// sin token: error claro
for (const t of ['', '   ', null, undefined]) {
  let msg = ''; try { firmar(t, '{}', NOW); } catch (e) { msg = e.message; }
  check('sin token ' + JSON.stringify(t), msg === 'Este cliente no tiene token en la tabla whatsapp_numeros');
}
```

- [ ] **Step 3: Correr y ver que falla**

Run: `node scripts/test-n8n.mjs`
Expected: FAIL — no existe `n8n/firma.js`.

- [ ] **Step 4: Crear `n8n/firma.js`**

Pegar el HMAC del nodo `Firmar settings` (de `n8n/.work/copia.json`, sin la línea del secreto) y agregar `firmar` con la regla de Global Constraints. `nowMs` por defecto `Date.now()`. Primera línea del archivo: `// Firma de peticiones al carrusel. Fuente única: se pega igual en todos los nodos "Firmar…".`

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:n8n`
Expected: todas las líneas `✓`, código de salida 0. La de 3 MB debe tardar menos de 5 s.

- [ ] **Step 6: Commit**

```bash
git add n8n/firma.js scripts/test-n8n.mjs
git commit -m "n8n: firma por token de la fila (crt_ con timestamp, antiguo sin)"
```
(`package.json` y `.gitignore` quedan modificados sin commit junto con el resto de la ronda si ya tenían cambios; si estaban limpios, agregarlos al commit.)

---

### Task 2: `n8n/consumo.js` — cuerpo del reporte de consumo

**Files:**
- Create: `n8n/consumo.js`
- Modify: `scripts/test-n8n.mjs`
- Modify: `scripts/test-e2e.mjs` (bloque nuevo junto a las pruebas de `/api/usage` existentes, ~línea 633)

**Interfaces:**
- Consumes: `loadSnippet` (Task 1); `firmar` de `n8n/firma.js`.
- Produces: `armarConsumo(gen: object, executionId: string, runIndex: number): { eventId, kind, model, count, tokens? }` en `n8n/consumo.js` (mismo formato pegable, sin `import`/`export`).
  - `gen` es el `json` que sale de `Generar Wan` (`{ model, imageUrl, usage }`) o de `Generar Qwen` (sin `model` ni `usage`).
  - `eventId = executionId + '-gen-' + runIndex`
  - `kind = 'image'`, `count = 1`
  - `model = gen.model || 'qwen-image-3.0-pro'`
  - `tokens = gen.usage` **solo** si alguno de `total_tokens`, `input_tokens`, `output_tokens`, `total`, `input`, `output` es un número > 0; si no, la clave `tokens` no existe.

- [ ] **Step 1: Pruebas que fallan** en `scripts/test-n8n.mjs`

```js
const { armarConsumo } = loadSnippet('n8n/consumo.js', ['armarConsumo']);
const wan = { model: 'wan2.7-image-pro', imageUrl: 'https://x/y.png', usage: { input_tokens: 200, output_tokens: 1000, total_tokens: 1200, image_count: 1 } };

let c = armarConsumo(wan, '4521', 0);
check('wan', c.eventId === '4521-gen-0' && c.kind === 'image' && c.count === 1 && c.model === 'wan2.7-image-pro' && c.tokens.total_tokens === 1200);
check('ronda 2 = otro evento', armarConsumo(wan, '4521', 1).eventId === '4521-gen-1');

c = armarConsumo({ imageUrl: 'https://x/q.png' }, '4521', 0);
check('qwen sin tokens', c.model === 'qwen-image-3.0-pro' && !('tokens' in c));
for (const usage of [{}, null, { total_tokens: 0, input_tokens: 0 }, { image_count: 1 }])
  check('usage vacío ' + JSON.stringify(usage), !('tokens' in armarConsumo({ model: 'm', usage }, '1', 0)));
check('entrada vacía', armarConsumo(undefined, '1', 0).kind === 'image');
```

- [ ] **Step 2: Correr y ver que falla** — `npm run test:n8n` → FAIL, no existe `n8n/consumo.js`.

- [ ] **Step 3: Crear `n8n/consumo.js`** con `armarConsumo`.

- [ ] **Step 4: Correr y ver que pasa** — `npm run test:n8n` → todo `✓`.

- [ ] **Step 5: Prueba e2e contra el servidor local** en `scripts/test-e2e.mjs`

Cargar `firmar` y `armarConsumo` con el mismo truco de `new Function`. Usar `USER3` **antes** de que se le genere token (firma antigua, secreto `process.env.WEBHOOK_SECRET` del servidor de pruebas) y después (firma `crt_`, con el token que la prueba ya obtiene en «generar token»). Asserts, con `u = respuesta.data.usage`:

| Caso | Petición | Esperado |
|---|---|---|
| Wan, firma antigua | `armarConsumo(wan, 'e2e', 0)` | 200, `data.duplicate === false`, `u.images === 1`, `u.tokensTotal === 1200`, `u.imagesNoTokens === 0` |
| mismo evento otra vez | igual | 200, `data.duplicate === true`, `u.images === 1` |
| Qwen, firma antigua | `armarConsumo({}, 'e2e', 1)` | 200, `u.images === 2`, `u.imagesNoTokens === 1`, `u.estimatedCostUsd === 0.06` |
| Wan, firma `crt_` | `armarConsumo(wan, 'e2e', 2)` con el token de USER3 | 200, `u.images === 3`, `u.tokensTotal === 2400` |
| token `crt_` firmado como antiguo | firma de solo el cuerpo | 401 |

Cabeceras: `content-type: application/json`, `x-webhook-secret: f.signature`, `x-webhook-timestamp: f.timestamp`, `x-forwarded-for: ip()`.

- [ ] **Step 6: Correr** — `npm test` → todas las pruebas anteriores siguen en `✓` y las 5 nuevas también.

- [ ] **Step 7: Commit**

```bash
git add n8n/consumo.js scripts/test-n8n.mjs
git commit -m "n8n: cuerpo del reporte de consumo (imagenes y tokens por generacion)"
```

---

### Task 3: `scripts/n8n-patch-flujo.mjs` — parchar el JSON del flujo

**Files:**
- Create: `scripts/n8n-patch-flujo.mjs`
- Modify: `scripts/test-n8n.mjs`

**Interfaces:**
- Consumes: `n8n/firma.js`, `n8n/consumo.js`, `n8n/.work/copia.json` (Task 1, Step 1).
- Produces: `patchWorkflow(workflow: object, snippets: { firma: string, consumo: string }): object` (export, no muta la entrada) y CLI `node scripts/n8n-patch-flujo.mjs <entrada.json> <salida.json>`. La salida conserva `name`, `nodes`, `connections`, `settings` y es importable desde el editor de n8n.

Qué hace `patchWorkflow` (idempotente: aplicarlo dos veces da lo mismo que una):

1. **Nodos de firma** — `Firmar settings`, `Firmar comando`, `Subir imagen compuesta`, `Firmar webhook`. En cada `parameters.jsCode`: todo lo anterior a la línea `const secret =` se reemplaza por `snippets.firma`; se quitan la línea `const secret = …` y, si existe, `if (!secret) { throw … }`; el token sale de `String($('Variables').first().json.token || '')`; la firma se calcula con `firmar(token, body)` y el `json` devuelto lleva `body`, `signature` y `timestamp` (se conserva `binary: item.binary` en `Subir imagen compuesta`). El resto de cada nodo (cómo arma `body`) no cambia.
2. **Nodos HTTP** — `Traer settings`, `Llamar manage`, `Subir imagen compuesta - HTTP`, `Publicar en carrusel`: agregar a `headerParameters.parameters` `{ name: 'X-Webhook-Timestamp', value: '={{ $json.timestamp }}' }`.
3. **Token de la fila** — dos nodos nuevos entre `WhatsApp Trigger` y `Variables`:
   - `Buscar token` (`n8n-nodes-base.dataTable`, typeVersion 1.1, `alwaysOutputData: true`), mismos parámetros que `Buscar cliente` de `RECEPCIONISTA_WHATSAPP` pero filtrando `carrusel` = `={{ String($json.carrusel || '').trim().toUpperCase() }}` y `activo` isTrue, `limit: 1`.
   - `Adjuntar token` (Code v2): `return [{ json: Object.assign({}, $('WhatsApp Trigger').first().json, { token: String($input.first().json.token || '').trim() }) }];`
   - Conexiones: `WhatsApp Trigger → Buscar token → Adjuntar token → Variables`. `Variables` no se toca (tiene `includeOtherFields: true`, así que `token` pasa solo).
4. **Consumo** — dos nodos nuevos:
   - `Firmar consumo` (Code v2): `snippets.firma` + `snippets.consumo` + 
     ```js
     const token = String($('Variables').first().json.token || '');
     const body = JSON.stringify(armarConsumo($input.first().json, String($execution.id), $runIndex));
     const f = firmar(token, body);
     return [{ json: { body: f.body, signature: f.signature, timestamp: f.timestamp } }];
     ```
   - `Reportar consumo` (`n8n-nodes-base.httpRequest` 4.2): copia de `Llamar manage` (ya parchado) con URL `/api/usage/` en lugar de `/api/manage/`, `onError: 'continueRegularOutput'`, `options.response.response.neverError: true`, `options.timeout: 10000`. Sin salida conectada.
   - Conexiones: `Generar Wan → [Fijar foto, Firmar consumo]`, `Generar Qwen → [Fijar foto, Firmar consumo]`, `Firmar consumo → Reportar consumo`.
   - Posición: `Firmar consumo` y `Reportar consumo` con `y` **menor** que la de `Fijar foto` (arriba en el lienzo). Con `executionOrder: v1` la rama de arriba corre primero; si quedara abajo, el reporte esperaría a que el cliente apruebe el póster (`Esperar respuesta`) y podría no mandarse nunca.

- [ ] **Step 1: Pruebas que fallan** en `scripts/test-n8n.mjs`

Si `n8n/.work/copia.json` no existe, este bloque se salta con un aviso (el archivo no está en git). Con `out = patchWorkflow(copia, snippets)` y `node = (n) => out.nodes.find((x) => x.name === n)`:

```js
check('82 nodos', out.nodes.length === 82);
check('idempotente', JSON.stringify(patchWorkflow(out, snippets)) === JSON.stringify(out));
check('entrada intacta', copia.nodes.length === 78);

const FIRMA = ['Firmar settings', 'Firmar comando', 'Subir imagen compuesta', 'Firmar webhook', 'Firmar consumo'];
for (const n of FIRMA) {
  const code = node(n).parameters.jsCode;
  check(n + ' sin secreto', !/WEBHOOK_SECRET|\bsecret\b/.test(code) && !/['"][A-Za-z0-9_\-]{28,}['"]/.test(code));
  check(n + ' usa firma.js', code.startsWith(snippets.firma));
}
for (const n of ['Traer settings', 'Llamar manage', 'Subir imagen compuesta - HTTP', 'Publicar en carrusel', 'Reportar consumo'])
  check(n + ' manda timestamp', node(n).parameters.headerParameters.parameters.filter((h) => h.name === 'X-Webhook-Timestamp' && h.value === '={{ $json.timestamp }}').length === 1);

const next = (n) => out.connections[n].main[0].map((c) => c.node);
check('token antes de Variables', next('WhatsApp Trigger')[0] === 'Buscar token' && next('Buscar token')[0] === 'Adjuntar token' && next('Adjuntar token')[0] === 'Variables');
check('Buscar token siempre da salida', node('Buscar token').alwaysOutputData === true);
for (const g of ['Generar Wan', 'Generar Qwen'])
  check(g + ' -> consumo', next(g).includes('Fijar foto') && next(g).includes('Firmar consumo'));
const rc = node('Reportar consumo');
check('reporte no rompe el flujo', rc.onError === 'continueRegularOutput' && rc.parameters.options.response.response.neverError === true && rc.parameters.options.timeout === 10000 && !out.connections['Reportar consumo']);
check('reporte va a /api/usage/', rc.parameters.url.includes("/api/usage/' + encodeURIComponent"));
check('consumo corre antes que el póster', node('Firmar consumo').position[1] < node('Fijar foto').position[1]);
```

Y ejecutar de verdad el código parchado de dos nodos, con `$`, `$input`, `$execution`, `$runIndex` simulados (`new Function('$', '$input', '$execution', '$runIndex', code)`), `Date.now` fijo y `ref` de Task 1:

```js
// Firmar comando, token antiguo y crt_
for (const [token, firmado] of [['a'.repeat(64), '{"action":"list"}'], ['crt_abc', '<ts>.{"action":"list"}']]) { /* json.signature === ref(token, firmado con <ts> = json.timestamp) y json.body === '{"action":"list"}' */ }
// Firmar consumo: body parseado === armarConsumo(wan, '77', 3), eventId '77-gen-3'
// Firmar settings con token '' -> lanza 'Este cliente no tiene token en la tabla whatsapp_numeros'
```

- [ ] **Step 2: Correr y ver que falla** — `npm run test:n8n` → FAIL, no existe `scripts/n8n-patch-flujo.mjs`.

- [ ] **Step 3: Implementar `patchWorkflow` y el CLI.** Si falta alguno de los nodos esperados o un nodo de firma no tiene la línea `const secret =`, lanzar un error que nombre el nodo (el flujo cambió desde que se escribió el plan).

- [ ] **Step 4: Correr y ver que pasa** — `npm run test:n8n` → todo `✓`.

- [ ] **Step 5: Generar el archivo a importar**

Run: `node scripts/n8n-patch-flujo.mjs n8n/.work/copia.json n8n/.work/copia.patched.json`
Expected: imprime `82 nodos` y la ruta de salida; no imprime código de nodos.

- [ ] **Step 6: Commit**

```bash
git add scripts/n8n-patch-flujo.mjs scripts/test-n8n.mjs
git commit -m "n8n: script que parcha el flujo (token de la fila + reporte de consumo)"
```

---

### Task 4: Aplicar en n8n y documentar

**Files:**
- Modify: `docs/N8N.md` (secciones 12 y 13)

**Interfaces:**
- Consumes: `n8n/.work/copia.patched.json` (Task 3).

Cada paso de n8n de esta tarea cambia algo fuera del repo: se hace solo con el visto bueno del usuario para ese paso.

- [ ] **Step 1: Agregar la columna `token`**

`mcp__n8n-produ__add_data_table_column` sobre `l7BmjGQTMBUFwDoB`: nombre `token`, tipo `string`.
Verificar: `mcp__n8n-produ__search_data_tables` con `query: "whatsapp_numeros"` lista 5 columnas, `token` entre ellas. Las filas existentes quedan con `token` vacío y los flujos activos no leen esa columna.

- [ ] **Step 2 (usuario): llenar `token`**

En n8n → Data tables → `whatsapp_numeros`, pegar en `token` de cada fila el secreto actual. No se pega en el chat.

- [ ] **Step 3: Importar el flujo parchado**

Abrir `COPIA_SEGURIDAD_DIRECTOR_ARTE` en el editor y usar «Import from file» con `n8n/.work/copia.patched.json` (mismo método que se usó para copiar el flujo: input de archivo oculto). Guardar; **no** activar.
Verificar con `mcp__n8n-produ__get_workflow_details` (`qLD8vfgXBAzLA7F1`): `nodeCount === 82`, `active === false`, y `node scripts/test-n8n.mjs` apuntado a ese export nuevo pasa el bloque de Task 3 (mismas aserciones sobre lo que quedó guardado). Revisar que los nodos nuevos no perdieron credenciales: `Buscar token` no usa; los demás conservan las suyas.

- [ ] **Step 4 (usuario decide): prueba real**

El flujo apagado solo corre si una fila de `whatsapp_numeros` apunta a él (`workflow_id = qLD8vfgXBAzLA7F1`) y está publicado como sub-flujo. Opciones: una fila nueva con un número de prueba, o cambiar temporalmente el `workflow_id` de una fila propia y regresarlo después. Con eso, mandar por WhatsApp `lista` y luego pedir un póster. Esperado en la ejecución (`mcp__n8n-produ__search_workflow_executions` + `get_workflow_execution`):

| Nodo | Antes del deploy | Después del deploy |
|---|---|---|
| `Traer settings`, `Llamar manage`, `Subir imagen compuesta - HTTP`, `Publicar en carrusel` | 200 | 200 |
| `Reportar consumo` | 404 y el póster llega igual | 200, `data.duplicate: false`, `data.usage.images` sube en 1 |
| `Pedir Wan` → `usage` | anotar las claves reales que devuelve DashScope | si no trae `total_tokens`/`input_tokens`/`output_tokens`, ajustar `armarConsumo` y su prueba |

- [ ] **Step 5: Actualizar `docs/N8N.md`**

Sección 12: reemplazar el bloque «Nodo Code de firma» por la regla del prefijo (`crt_` → con timestamp; otro → firma antigua) y decir que la fuente es `n8n/firma.js`; en «Cambios pendientes en n8n» quitar el punto de `RECEPCIONISTA_WHATSAPP` y el de `Variables` y poner los nodos `Buscar token` → `Adjuntar token`. Sección 13: nodos `Firmar consumo` → `Reportar consumo`, `eventId = <execution id>-gen-<n>`, y que el reporte no detiene el flujo. Agregar cómo regenerar: exportar → `node scripts/n8n-patch-flujo.mjs` → importar.

- [ ] **Step 6: Commit** — `docs/N8N.md` ya tenía cambios sin commit de la ronda anterior: se deja modificado, sin commit, hasta que el usuario decida cómo agrupar esa ronda.

---

## Fuera de este plan

- Pasar los cambios a `DIRECTOR_DE_ARTE_WHATSAPP` (el que atiende clientes) y a `DIRECTOR_DE_ARTE_TELEGRAM`.
- Deploy del servidor (sin él `/api/usage` no existe en `carrusel.etziel.com`).
- Generar tokens `crt_` por cliente: cuando se haga, solo se cambia el valor de la fila; el flujo ya firma según el prefijo.
- Tokens del modelo de chat (`AI Agent` / OpenRouter): el nodo no expone el `usage` en su salida; solo se reportan las generaciones de imagen.
- `ALLOW_GLOBAL_WEBHOOK_SECRET=0` y rotación de `WEBHOOK_SECRET`.

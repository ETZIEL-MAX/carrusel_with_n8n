# Formatos HD–4K, fondo difuminado, mejor prompt y consumo de texto/audio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el panel permita elegir resolución (HD, Full HD, 2K, 4K) además del formato, que el carrusel muestre un fondo difuminado en vez de negro, que el póster ya no salga con el lado derecho en blanco, y que se reporten los tokens del modelo de texto y del audio.

**Architecture:** La app guarda un ajuste nuevo `posterResolution` y entrega a n8n el tamaño ya calculado. El flujo de n8n (solo la copia `qLD8vfgXBAzLA7F1`) se sigue editando desde el repo: fragmentos en `n8n/*.js` probados con Node, aplicados con `scripts/n8n-patch-flujo.mjs`. El agente de IA se cambia por una llamada HTTP a OpenRouter, porque el nodo de agente no expone los tokens que gasta.

**Tech Stack:** Node ESM sin build, sharp, Playwright, n8n (nodos Code/HTTP), OpenRouter, DashScope (Wan/Qwen).

**Spec:** No hay documento. Es el pedido del usuario del 2026-10-09:
1. «mejorar el prompt … me deja en blanco el lado derecho a veces; hay que decirle que deje listo para que podamos poner el logo».
2. «no me reporta la cantidad de tokens utilizados por deepseek en audio o escritura».
3. «en la web poder mandar más formatos: HD, Full HD, 2K, 4K; vertical, horizontal, cuadrado, etc.».
4. «cuando la imagen no llene la pantalla, en vez de verse negro quiero que se vea difuminado».
5. «trabaja sobre main; acabando de funcionar todo lo pones en producción; lo de n8n directamente en la copia» (está despublicada para poder trabajarla).

## Global Constraints

- Se trabaja en `main`, con un commit por tarea. Nada de `git push` ni deploy hasta la Tarea 7.
- En n8n solo se toca `COPIA_SEGURIDAD_DIRECTOR_ARTE` (`qLD8vfgXBAzLA7F1`). No se tocan `RECEPCIONISTA_WHATSAPP`, `DIRECTOR_DE_ARTE_WHATSAPP`, `SAGA_BOT` ni `DIRECTOR_DE_ARTE_TELEGRAM`.
- Nunca imprimir ni commitear tokens o secretos (`n8n/.work/` está ignorado; las filas de `whatsapp_numeros` traen tokens `crt_`).
- Interfaz y docs en español; identificadores de código y `AGENTS.md` en inglés. Sin frameworks ni bundler.
- Los fragmentos de `n8n/*.js` no usan `import`/`export` ni `require` (corren dentro de nodos Code).
- Un cliente sin `posterResolution` guardado debe seguir generando exactamente los tamaños de hoy (Full HD).
- Tamaños: lado corto 720 (`hd`), 1080 (`fullhd`), 1440 (`2k`), 2160 (`4k`). Proporciones: `horizontal` 16:9, `vertical` 9:16, `cuadrado` 1:1, `horizontal43` 4:3, `vertical34` 3:4.
- En el servidor de producción no se compila nada y `plasticosvirgo.com` debe responder 200 tras cada paso.
- `npm test`, `npm run test:n8n` y `npx playwright test` en verde antes de cada commit.

## Review Focus

1. **Cliente con ajustes viejos** (sin `posterResolution`): debe recibir 1920×1080 en horizontal, como hoy. → prueba en Tarea 1.
2. **El modelo de texto responde `FALSE` o sin `usage`**: no se reporta consumo y el flujo sigue. → prueba en Tarea 5.
3. **El generador devuelve otro tamaño que el pedido**: el logo debe quedar dentro del póster, nunca con posición negativa. → prueba en Tarea 5.
4. **Imagen más grande que el tope** (p. ej. 5000 px): se guarda reducida a 3840 px, no se rechaza. → prueba en Tarea 3.
5. **Diapositiva que sale de la ventana de carga o lista que cambia**: el fondo difuminado se quita junto con la imagen, sin dejar la anterior. → prueba en Tarea 4.

---

### Task 1: Ajuste `posterResolution` y tamaño calculado en el servidor

**Files:**
- Modify: `api/_utils.js` (junto a `FORMATS`, `getGenerationSettings`, `updateUserSettings`, `validateGenerationSettings`)
- Modify: `api/settings.js` (PATCH acepta el campo)
- Modify: `api/_webhook-shared.js` (respuesta de `settings-read`)
- Modify: `docs/API.md`, `docs/N8N.md` (campo nuevo)
- Test: `scripts/test-e2e.mjs` (sección de settings, cerca de la línea 334, y `settings-read`, cerca de la 620)

**Interfaces:**
- Produces:
  - `export const RESOLUTIONS = ['hd', 'fullhd', '2k', '4k']`
  - `export const normalizeResolution = (r) => string` (inválido → `'fullhd'`)
  - `export function posterSize(format, resolution): { width: number, height: number }`
  - `GET/PATCH /api/settings` devuelven y aceptan `posterResolution`.
  - `POST /api/settings-read/USERx` devuelve además `posterResolution`, `posterWidth`, `posterHeight`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `scripts/test-e2e.mjs`

```js
// tras 'PATCH settings slideDuration 1 -> 400'
r = await adminJson('/api/settings?userId=USER1', 'GET');
check('sin posterResolution guardado -> fullhd', (await r.json()).data?.posterResolution === 'fullhd');
r = await adminJson('/api/settings?userId=USER1', 'PATCH', { posterResolution: '4k', defaultOrientation: 'vertical' });
check('PATCH posterResolution 4k', r.status === 200 && (await r.json()).data?.posterResolution === '4k', r.status);
r = await adminJson('/api/settings?userId=USER1', 'PATCH', { posterResolution: '8k' });
check('posterResolution inválida -> 400', r.status === 400, r.status);
// settings-read (firma como los demás casos de USER1)
check('settings-read entrega el tamaño', d.posterResolution === '4k' && d.posterWidth === 2160 && d.posterHeight === 3840, J(d));
// tabla completa, importando posterSize de api/_utils.js
const sizes = { 'horizontal/hd': [1280, 720], 'horizontal/fullhd': [1920, 1080], 'horizontal/2k': [2560, 1440], 'horizontal/4k': [3840, 2160],
  'vertical/2k': [1440, 2560], 'cuadrado/4k': [2160, 2160], 'horizontal43/hd': [960, 720], 'horizontal43/2k': [1920, 1440], 'vertical34/4k': [2160, 2880] };
for (const [k, [w, h]] of Object.entries(sizes)) { const [f, res] = k.split('/'); const s = posterSize(f, res); check('posterSize ' + k, s.width === w && s.height === h, J(s)); }
check('posterSize con valores inválidos -> 1920x1080', J(posterSize('x', 'y')) === J({ width: 1920, height: 1080 }));
```
Dejar USER1 otra vez en `{ posterResolution: 'fullhd', defaultOrientation: 'horizontal' }` al terminar el bloque.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test`
Expected: FAIL en los casos nuevos (`posterResolution` es `undefined`, `posterSize` no existe).

- [ ] **Step 3: Implementar** `RESOLUTIONS`, `normalizeResolution`, `posterSize` y el campo en `getGenerationSettings` / `updateUserSettings` / `validateGenerationSettings` (mismo patrón que `defaultOrientation`), en `PATCH /api/settings` y en `settings-read`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test`
Expected: `RESULT: N/N` sin FAIL.

- [ ] **Step 5: Documentar** el campo en `docs/API.md` (settings) y `docs/N8N.md` (settings-read), y **commit**

```bash
git add api/_utils.js api/settings.js api/_webhook-shared.js scripts/test-e2e.mjs docs/API.md docs/N8N.md
git commit -m "Ajuste posterResolution (HD, Full HD, 2K, 4K) y tamaño calculado para n8n"
```

---

### Task 2: Selector de resolución en el panel

**Files:**
- Modify: `admin.html` (campo «Formato por defecto», líneas ~279-289)
- Modify: `admin.js` (`FORMATS`/`normFormat` ~244, `orientSeg` ~698, carga ~818, guardado ~934)
- Test: `tests/admin.spec.js` (la prueba que hoy guarda `cuadrado`)

**Interfaces:**
- Consumes: `posterResolution` de `GET/PATCH /api/settings` (Task 1).
- Produces: en el DOM, `#resSeg` con botones `data-value="hd|fullhd|2k|4k"` y `#formatSizeHint`.

- [ ] **Step 1: Escribir la prueba que falla** en `tests/admin.spec.js`

```js
await page.locator('#orientSeg [data-value="vertical"]').click();
await page.locator('#resSeg [data-value="4k"]').click();
await expect(page.locator('#formatSizeHint')).toHaveText('Tamaño del póster: 2160 × 3840 px');
// guardar con el botón existente del formulario y leer /api/settings
expect(data.defaultOrientation).toBe('vertical');
expect(data.posterResolution).toBe('4k');
// al recargar, los dos botones siguen marcados
await page.reload();
await expect(page.locator('#resSeg [data-value="4k"]')).toHaveClass(/is-active/);
```
(Usar la misma clase de «activo» que ya pone `markSeg`; si no es `is-active`, la que use.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npx playwright test tests/admin.spec.js --reporter=line`
Expected: FAIL, `#resSeg` no existe.

- [ ] **Step 3: Implementar**
  - `admin.html`: los 5 botones de `#orientSeg` pierden los píxeles fijos del texto (quedan «▭ Horizontal 16:9», etc.). Debajo, un segundo `div.seg#resSeg` con «HD», «Full HD», «2K», «4K», y `<p class="hint" id="formatSizeHint">`. La etiqueta del campo pasa a «Formato y resolución por defecto».
  - `admin.js`: estado `genResolution` (por defecto `'fullhd'`), `markSeg(resSeg, …)`, envío de `posterResolution` al guardar y una función `posterSize(format, resolution)` con la misma tabla de Global Constraints para pintar `#formatSizeHint` en cada clic y al cargar.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx playwright test tests/admin.spec.js tests/mobile.spec.js --reporter=line`
Expected: todo PASS (el panel debe seguir cabiendo en pantalla de celular).

- [ ] **Step 5: Commit**

```bash
git add admin.html admin.js tests/admin.spec.js
git commit -m "Panel: elegir resolución del póster (HD, Full HD, 2K, 4K)"
```

---

### Task 3: Guardar imágenes de hasta 4K

**Files:**
- Modify: `api/_store.js` (las dos llamadas `.resize({ width: 1920, height: 1920, … })`, líneas ~320 y ~352)
- Modify: `AGENTS.md` (una línea en **Storage quota** o en la descripción de `_store.js`)
- Test: `scripts/test-e2e.mjs` (sección de subida por n8n, `/api/upload/USERx`)

**Interfaces:**
- Produces: `const MAX_IMAGE_SIDE = 3840` en `api/_store.js`, usado por las dos rutas de conversión a WebP.

- [ ] **Step 1: Escribir las pruebas que fallan**

Generar los PNG con sharp dentro de la prueba (`sharp({ create: { width, height, channels: 3, background } }).png()`), subirlos por la ruta binaria de `/api/upload/USER3` y medir el archivo servido con `sharp(buffer).metadata()`.

```js
check('una imagen 2560x1440 se guarda a su tamaño', meta.width === 2560 && meta.height === 1440, J(meta));
check('una imagen 5000x2000 se reduce a 3840 de lado mayor', big.width === 3840 && big.height === 1536, J(big));
```
Si `UPLOAD_MAX_BYTES` del entorno de prueba (900 KB) no alcanza, usar un fondo de color liso, que comprime a pocos KB.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test`
Expected: FAIL: hoy la primera se guarda a 1920×1080.

- [ ] **Step 3: Implementar** `MAX_IMAGE_SIDE` y usarlo en las dos llamadas. No cambiar `limitInputPixels` (40 MP cubre 5000×2000 y 3840×2160).

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test`
Expected: `RESULT: N/N` sin FAIL.

- [ ] **Step 5: Commit**

```bash
git add api/_store.js scripts/test-e2e.mjs AGENTS.md
git commit -m "Las imágenes subidas se guardan hasta 3840 px de lado (4K)"
```

---

### Task 4: Fondo difuminado cuando la imagen no llena la pantalla

**Files:**
- Modify: `carousel.js` (`build`, `applyFit`, `unloadImage`)
- Modify: `styles.css` (bloque `.slide`)
- Modify: `index.html` solo si hace falta cambiar la versión de assets
- Test: `tests/carousel.spec.js`

**Interfaces:**
- Produces: cada `.slide` tiene un `<div class="slide__bg" aria-hidden="true">` antes del `<img>`. Los selectores `.slide img` existentes no cambian.

**Decisiones:**
- El fondo es un `div` con `background-image` puesto por JavaScript (`el.style.backgroundImage`), no un segundo `<img>`: así no se rompen las pruebas ni el conteo de imágenes cargadas.
- Solo se pone cuando la imagen queda en `fit-contain`. Con `fit-cover` o `is-rotated` el fondo se quita.
- CSS: `position:absolute; inset:-6%; background-size:cover; background-position:center; filter:blur(36px) brightness(.55); z-index:0`. El `inset` negativo evita el borde claro que deja el desenfoque.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/carousel.spec.js`

Dentro del bucle de «cada imagen se ajusta según su orientación…», después de comprobar la clase:

```js
const bg = page.locator(`.slide[data-index="${i}"] .slide__bg`);
const bgImage = await bg.evaluate((el) => getComputedStyle(el).backgroundImage);
const src = await img.evaluate((el) => el.dataset.src);
if (expected[i] === 'fit-contain') {
  expect(bgImage).toContain(src);
  expect(await bg.evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
} else {
  expect(bgImage).toBe('none');
}
```

Y una prueba nueva:

```js
test('el fondo difuminado se quita cuando la imagen sale de la ventana de carga', async ({ page }) => {
  // 4 diapositivas: estando en la 0 están cargadas 0, 1 y 3. Se va a la 1 (se suelta la 3).
  // Se busca una diapositiva que estuviera en fit-contain y ya no tenga `src`:
  // su .slide__bg debe tener background-image 'none'.
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx playwright test tests/carousel.spec.js --reporter=line`
Expected: FAIL, `.slide__bg` no existe.

- [ ] **Step 3: Implementar** el `div` en `build`, una función `setBlur(img, on)` llamada desde `applyFit` y desde `unloadImage`, y el CSS. Quitar del comentario de `.slide img` la frase «sin barras ni fondo difuminado».

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx playwright test tests/carousel.spec.js tests/cache.spec.js tests/security.spec.js --reporter=line`
Expected: todo PASS en los tres proyectos (TV horizontal, TV vertical, móvil), sin violaciones de CSP.

- [ ] **Step 5: Mirar el resultado** abriendo una de las capturas `slide-3-*.png` (cuadrado en TV horizontal): los lados deben verse difuminados, no negros. Luego **commit**

```bash
git add carousel.js styles.css tests/carousel.spec.js
git commit -m "Carrusel: fondo difuminado cuando la imagen no llena la pantalla"
```

---

### Task 5: Fragmentos de n8n — formato, prompt y consumo de texto

**Files:**
- Create: `n8n/formato.js`
- Create: `n8n/prompt.js`
- Modify: `n8n/consumo.js`
- Test: `scripts/test-n8n.mjs` (cargar con el mismo `new Function` que usa hoy para `consumo.js`)

**Interfaces:**
- Produces, en `n8n/formato.js`:
  - `tamanoPoster(cfg): { formato, ancho, alto, texto }`: usa `cfg.posterWidth`/`cfg.posterHeight` si son enteros entre 256 y 4096; si no, la tabla Full HD de hoy según `cfg.defaultOrientation`. `texto` como hoy: `'horizontal 16:9'`, etc.
  - `zonaLogo(ancho, alto): { logoAncho, logoAlto, margen, zonaAnchoPct, zonaAltoPct }`: `escala = Math.sqrt(ancho * alto / 2073600)`; `logoAncho = round(420 × escala)`, `logoAlto = round(224 × escala)`, `margen = round(50 × escala)`, `zona…Pct = ceil((logo + margen + round(40 × escala)) / lado × 100)`.
  - `posicionLogo(posterAncho, posterAlto, logoAncho, logoAlto, margen): { posX, posY }`, nunca negativos.
  - `tamanoGeneracion(ancho, alto, maxLado): { ancho, alto }`: misma proporción, lado mayor ≤ `maxLado`, ambos pares.
  - `reglasLayout(ancho, alto): string`: el bloque `FINAL LAYOUT RULES` (texto abajo).
- Produces, en `n8n/prompt.js`:
  - `armarMensajes(item, ctx): [{ role: 'system', content }, { role: 'user', content }]`, con `item = { texto, producto, ronda, prompt_base, colorPalette }` y `ctx = { ancho, alto, formato_texto }`.
- Produces, en `n8n/consumo.js`:
  - `armarConsumo(gen, executionId, runIndex)` devuelve además, para una respuesta de chat de OpenRouter (`gen.choices` es arreglo): `{ eventId: '<exec>-txt-<run>', kind: 'text', model: gen.model, tokens: gen.usage }`, o `null` si no trae tokens. Para imágenes no cambia nada (`'<exec>-gen-<run>'`).

**Texto fijo del prompt** (lo que arregla el lado derecho en blanco):

- En `armarMensajes`, el mensaje `system` conserva las reglas actuales del nodo `AI Agent` (producto / precio / información adicional, validez y `FALSE`, texto en español y mayúsculas, lienzo, paleta, rondas, formato JSON de respuesta) y **reemplaza todo el párrafo `LOGO:`** por:

  > COMPOSICION COMPLETA: la escena, el fondo y la iluminacion deben cubrir el 100 por ciento del lienzo, de borde a borde, incluido todo el lado derecho. PROHIBIDO dejar una mitad, franja o columna vacia, blanca o sin escena. Reparte producto, precio y textos en todo el ancho. LOGO: NO generes, dibujes ni insinues ningun logo, marca, emblema ni watermark; lo agrega otro proceso despues. Solo la esquina INFERIOR DERECHA, un rectangulo de aproximadamente ZW por ciento del ancho y ZH por ciento del alto, queda libre de producto, precio, textos, badges, personas e iconos. Esa esquina NO es un hueco: el MISMO fondo de la escena continua ahi, liso, claro y sin detalles, para que un logo negro se lea bien encima. Nunca un recuadro, parche ni zona blanca recortada.

  (`ZW`/`ZH` salen de `zonaLogo`.) Se quita la frase suelta del final del prompt actual («agrega que siempre cree la imagen en la resolucion»).
- El mensaje `user` lleva los datos: paleta, `PRODUCTO ACTUAL`, `MENSAJE DEL CLIENTE`, `RONDA`, `PROMPT ANTERIOR`.
- `reglasLayout` conserva las reglas 1 (FORMAT) y 2 (TEXT FIT) actuales de `Parsear salida` y cambia la 3 por:

  > 3) FULL BLEED: the scene and its background must cover the whole canvas edge to edge, including the entire right side. Never leave a blank, white or empty half, band or column. 4) LOGO CORNER: only the bottom-right corner, a rectangle about ZW percent of the width and ZH percent of the height, must be free of product, text, price, badges and icons. Do not leave it white or cut out: the same scene background continues there, smooth, light and low in detail, so a black logo placed later stays readable. Do not draw any logo, frame or box. Texts and price may go anywhere else, including the right side above that corner.

- [ ] **Step 1: Escribir las pruebas que fallan** en `scripts/test-n8n.mjs`

```js
check('tamanoPoster usa el tamaño que manda el servidor', J(tamanoPoster({ posterWidth: 3840, posterHeight: 2160, defaultOrientation: 'horizontal' })) === J({ formato: 'horizontal', ancho: 3840, alto: 2160, texto: 'horizontal 16:9' }));
check('tamanoPoster sin tamaño -> tabla Full HD', tamanoPoster({ defaultOrientation: 'vertical34' }).ancho === 1080 && tamanoPoster({ defaultOrientation: 'vertical34' }).alto === 1440);
check('tamanoPoster con tamaño absurdo -> Full HD', tamanoPoster({ posterWidth: 99999, posterHeight: 5 }).ancho === 1920);
check('zonaLogo en 1920x1080 = la de hoy', J(zonaLogo(1920, 1080)) === J({ logoAncho: 420, logoAlto: 224, margen: 50, zonaAnchoPct: 27, zonaAltoPct: 30 }));
check('zonaLogo en 4K duplica el logo', zonaLogo(3840, 2160).logoAncho === 840 && zonaLogo(3840, 2160).margen === 100);
check('zonaLogo en vertical conserva el tamaño', zonaLogo(1080, 1920).logoAncho === 420);
check('posicionLogo esquina inferior derecha', J(posicionLogo(1920, 1080, 420, 224, 50)) === J({ posX: 1450, posY: 806 }));
check('posicionLogo nunca negativa si el póster salió chico', J(posicionLogo(300, 200, 420, 224, 50)) === J({ posX: 0, posY: 0 }));
check('tamanoGeneracion recorta 4K a 2048', J(tamanoGeneracion(3840, 2160, 2048)) === J({ ancho: 2048, alto: 1152 }));
check('tamanoGeneracion no toca lo que cabe', J(tamanoGeneracion(1080, 1920, 2048)) === J({ ancho: 1080, alto: 1920 }));
const rules = reglasLayout(1920, 1080);
check('reglas: pide lienzo completo', /FULL BLEED/.test(rules) && /entire right side/.test(rules));
check('reglas: ya no manda todo a la izquierda', !/on the left or the top/.test(rules));
check('reglas: zona del logo con sus porcentajes', /27 percent of the width and 30 percent of the height/.test(rules));
const msgs = armarMensajes({ texto: 'TACOS 3X50', producto: '', ronda: 2, prompt_base: 'OLD PROMPT', colorPalette: ['#ff0000'] }, { ancho: 1080, alto: 1920, formato_texto: 'vertical 9:16, EXACTAMENTE 1080x1920 pixeles' });
check('mensajes: system + user', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');
check('system: prohíbe el lado vacío y describe la esquina', /PROHIBIDO dejar una mitad/.test(msgs[0].content) && /esquina INFERIOR DERECHA/.test(msgs[0].content));
check('system: sin la nota suelta', !/agrega que siempre cree/.test(msgs[0].content));
check('user: lleva mensaje, ronda, prompt anterior y paleta', ['TACOS 3X50', 'RONDA: 2', 'OLD PROMPT', '#ff0000'].every((t) => msgs[1].content.includes(t)));
const chat = { id: 'gen-1', model: 'deepseek/deepseek-v4.1-flash', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1319, completion_tokens: 3800, total_tokens: 5119, cost: 0.001 } };
check('consumo de texto', J(armarConsumo(chat, '77', 3)) === J({ eventId: '77-txt-3', kind: 'text', model: 'deepseek/deepseek-v4.1-flash', tokens: chat.usage }));
check('texto sin usage -> no se reporta', armarConsumo({ choices: [{ message: { content: 'FALSE' } }] }, '77', 0) === null);
check('la imagen sigue igual', armarConsumo({ model: 'wan2.7-image-pro', usage: {} }, '77', 1).eventId === '77-gen-1');
```

Y en `scripts/test-e2e.mjs`, junto a los casos «n8n:», una prueba de que el servidor entiende esa forma de `usage`:

```js
cp = await clientPost('/api/usage/USER1', WEBHOOK_SECRET_LEGACY, { eventId: 'n8n-txt-1', kind: 'text', model: 'deepseek/deepseek-v4.1-flash', tokens: { prompt_tokens: 1319, completion_tokens: 3800, total_tokens: 5119, cost: 0.001, prompt_tokens_details: { audio_tokens: 213 } } });
check('n8n: tokens de texto con la forma de OpenRouter', cp.status === 200 && cp.json.data?.usage?.tokensTotal >= 5119, cp.status + ' ' + J(cp.json.data?.usage));
```
(Usar el mismo helper y la misma firma que los otros casos «n8n:» de USER1. Si esta pasa a la primera es correcto: fija un comportamiento que ya existe; anotarlo en el ledger.)

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run test:n8n`
Expected: FAIL, `tamanoPoster is not defined`.

- [ ] **Step 3: Implementar** `n8n/formato.js`, `n8n/prompt.js` y el caso de texto en `n8n/consumo.js`, con un comentario de cabecera en cada archivo que diga en qué nodo se pega.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm run test:n8n && npm test`
Expected: todas OK.

- [ ] **Step 5: Commit**

```bash
git add n8n/formato.js n8n/prompt.js n8n/consumo.js scripts/test-n8n.mjs scripts/test-e2e.mjs
git commit -m "n8n: formato por resolución, prompt sin lado vacío y consumo de texto"
```

---

### Task 6: Aplicar los cambios al flujo copia

**Files:**
- Modify: `scripts/n8n-patch-flujo.mjs`
- Modify: `scripts/test-n8n.mjs` (bloque del parche)
- Modify: `docs/N8N.md` (§12–13), `AGENTS.md` (mapa de archivos)
- Trabajo: `n8n/.work/copia.json` (export sin parche, ya existe), `n8n/.work/copia.live.json` (se vuelve a bajar)

**Interfaces:**
- Consumes: todo lo de Task 5 y `posterWidth`/`posterHeight` de Task 1.
- Produces: `patchWorkflow(workflow, snippets)` recibe ahora `snippets = { firma, consumo, formato, prompt }` y deja el flujo así:

| Nodo | Cambio |
|---|---|
| `Init contexto` | Antepone `formato.js`; reemplaza la tabla `FORMATOS` por `tamanoPoster(cfg)` y agrega a la salida `logo_ancho`, `logo_alto`, `logo_margen` (de `zonaLogo`). `formato_texto` igual que hoy. |
| `Armar prompt` (nuevo, Code) | `formato.js` + `prompt.js`; salida `{ body: JSON.stringify({ model: 'deepseek/deepseek-v4.1-flash', messages }) }`. Recibe lo que antes entraba a `AI Agent` (`Init contexto` y `Ronda tope`). |
| `Redactar prompt` (nuevo, HTTP) | `POST https://openrouter.ai/api/v1/chat/completions`, cuerpo `={{ $json.body }}`, credencial y autenticación copiadas del nodo `Transcribir audio`, `timeout` 120000, `retryOnFail` con 2 intentos. Sale a `Parsear salida` y a `Firmar consumo`. |
| `AI Agent`, `OpenRouter Chat Model` | Se eliminan (nodos y conexiones). |
| `Parsear salida` | Lee primero `raw.choices[0].message.content`; el bloque `FINAL LAYOUT RULES` sale de `reglasLayout(an, al)`. |
| `Redimensionar logo` | `width`/`height` = `={{ $('Init contexto').first().json.logo_ancho }}` / `logo_alto`. |
| `Calcular posicion` | Usa `posicionLogo` con el tamaño real (`Info poster`) y los `logo_*` de `Init contexto`. |
| `Preparar Wan` | `size` = `tamanoGeneracion(an, al, WAN_MAX_LADO)` con `WAN_MAX_LADO = 2048`; `Optimizar imagen` ya lleva el resultado al tamaño exacto del panel. |
| `Firmar consumo` | Si `armarConsumo` devuelve `null`, `return []`. |
| `Transcribir audio` | Conexión extra a `Firmar consumo`. |

Aplicar el script dos veces sigue sin cambiar nada (idempotente).

- [ ] **Step 1: Escribir las pruebas que fallan** en el bloque del parche de `scripts/test-n8n.mjs`

```js
const names = patched.nodes.map((n) => n.name);
check('ya no hay nodo de agente', !names.includes('AI Agent') && !names.includes('OpenRouter Chat Model'));
check('hay Armar prompt y Redactar prompt', names.includes('Armar prompt') && names.includes('Redactar prompt'));
check('lo que entraba al agente entra a Armar prompt', ['Init contexto', 'Ronda tope'].every((n) => targets(n).includes('Armar prompt')));
check('Redactar prompt -> Parsear salida y Firmar consumo', ['Parsear salida', 'Firmar consumo'].every((n) => targets('Redactar prompt').includes(n)));
check('el audio también reporta consumo', targets('Transcribir audio').includes('Firmar consumo') && targets('Transcribir audio').includes('Firmar settings'));
check('Redactar prompt usa la credencial de OpenRouter', J(node('Redactar prompt').credentials) === J(node('Transcribir audio').credentials));
check('ninguna conexión apunta a un nodo que no existe', todasLasConexionesExisten(patched));
check('Init contexto usa tamanoPoster', /tamanoPoster\(cfg\)/.test(code('Init contexto')) && !/var FORMATOS = \{/.test(code('Init contexto')));
check('el logo se escala con el formato', /logo_ancho/.test(J(node('Redimensionar logo').parameters)) && /posicionLogo\(/.test(code('Calcular posicion')));
check('Wan pide un tamaño que el modelo acepta', /tamanoGeneracion\(/.test(code('Preparar Wan')));
check('Firmar consumo no reporta si no hay tokens', /return \[\];/.test(code('Firmar consumo')));
check('sigue siendo idempotente', byName(patchWorkflow(patched, snippets).nodes) === byName(patched.nodes));
```
Además, ejecutar de verdad el código de los nodos nuevos con `new Function` y dobles de `$input` / `$()`:

```js
check('Armar prompt produce un cuerpo válido', JSON.parse(run('Armar prompt', fakeCtx).body).messages.length === 2);
check('Parsear salida entiende la respuesta HTTP', run('Parsear salida', { choices: [{ message: { content: '{"producto":"TACOS","prompt_final":"A poster"}' } }] }).valido === 'si');
check('Parsear salida con FALSE', run('Parsear salida', { choices: [{ message: { content: 'FALSE' } }] }).valido === 'no');
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run test:n8n`
Expected: FAIL, «ya no hay nodo de agente».

- [ ] **Step 3: Implementar** los pasos nuevos en `patchWorkflow`. Posición de `Armar prompt` = la de `AI Agent`; `Redactar prompt` 224 px a su derecha. Si falta algún nodo esperado, lanzar el mismo tipo de error que ya lanza `get(name)`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm run test:n8n`
Expected: todas OK, incluida la idempotencia.

- [ ] **Step 5: Comprobar el nodo de Qwen.** Con `get_node_types` ver si el nodo `alibabaCloud` (operación de imagen) acepta un tamaño en `imageOptions`.
  - Si lo acepta: agregar al parche `size` con el resultado de `tamanoGeneracion` y una prueba que lo fije.
  - Si no: dejarlo como está (`Optimizar imagen` ajusta al tamaño del panel) y anotarlo en el ledger como `Ruling:`.

- [ ] **Step 6: Aplicar a la copia** con `update_workflow` (operaciones `addNode`, `removeNode`, `setNodeParameter`, `addConnection`/`removeConnection`), bajar la versión guardada a `n8n/.work/copia.live.json` y comparar.

Run: `node scripts/test-n8n.mjs n8n/.work/copia.live.json --parchado`
Expected: `PASS lo guardado en n8n ya es el flujo parchado`. La copia sigue **sin publicar**.

- [ ] **Step 7: Documentar** en `docs/N8N.md` (nodos nuevos, de dónde sale el tamaño, qué se reporta) y en `AGENTS.md` (`n8n/formato.js`, `n8n/prompt.js`), y **commit**

```bash
git add scripts/n8n-patch-flujo.mjs scripts/test-n8n.mjs docs/N8N.md AGENTS.md
git commit -m "n8n: el flujo usa el tamaño del panel, redacta el prompt por HTTP y reporta texto y audio"
```

---

### Task 7: Producción y prueba real

**Files:**
- Modify: memoria `ronda-cuotas-tokens-pendientes.md` y `prod-deploy-ec2.md`

- [ ] **Step 1: Suites completas en local**

Run: `npm test && npm run test:n8n && npx playwright test --reporter=line`
Expected: todo en verde.

- [ ] **Step 2: Desplegar la app** con el procedimiento del 2026-10-09 (memoria `prod-deploy-ec2`): respaldo de `data/`, `redis/` y `.env.prod` en `~/carrusel/backups/<fecha>/`; `docker build --platform linux/amd64 -t carrusel:prod .`; `docker save | gzip` → `scp`; en el servidor `docker tag carrusel:prod carrusel:prev`, `docker load`, `up -d --no-deps carrusel`. No se toca nginx ni `.env.prod`.

Run (servidor): `bash check.sh`
Expected: `plasticosvirgo.com : 200`, `carrusel docker :8080 : 200`.

Run (local): `npm run test:prod`
Expected: `5 passed`.

- [ ] **Step 3: Publicar la copia** con `publish_workflow` (`qLD8vfgXBAzLA7F1`) y confirmar `active: true`.

- [ ] **Step 4: Prueba real (la manda el usuario)**: un mensaje de **texto** y uno de **audio** desde `8131395313`, con el panel de USER1 en un formato distinto de Full HD horizontal (por ejemplo, vertical 2K). Revisar la ejecución **sin volcar los datos de los nodos**:
  - `Redactar prompt`, `Transcribir audio` y la generación terminan en `success`;
  - `Reportar consumo` responde 200 una vez por texto, una por audio y una por imagen;
  - `Info poster` da el tamaño elegido en el panel;
  - descargar el póster publicado y **mirarlo**: el lado derecho tiene escena, el logo queda dentro y legible;
  - el panel de USER1 muestra tokens mayores que antes.

- [ ] **Step 5: Si el generador rechaza el tamaño o el póster sale mal**, corregir el fragmento en el repo con una prueba que falle primero, volver a aplicar (Task 6, pasos 4 y 6) y repetir el paso 4. Si no se puede arreglar en esta ronda: `restore_workflow_version` a la versión anterior de la copia y avisar.

- [ ] **Step 6: Subir a GitHub y actualizar memorias**

```bash
git push origin main
```

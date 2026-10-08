# Integración con n8n

Este documento explica cómo sincronizar el carrusel desde **n8n** usando el
webhook firmado `/api/webhook/USERx`.

Cada carrusel tiene su **propio** webhook (`/api/webhook/USER1`,
`/api/webhook/USER2`, …). El endpoint global antiguo `/api/webhook` está
retirado y responde `410 Gone`.

Por defecto el webhook **agrega** imágenes sin borrar las existentes
(`mode: "append"`); las URLs repetidas se omiten. Si quieres reemplazar todo el
carrusel, envía `mode: "replace"`.

---

## 1. Requisitos

- La URL pública de tu app, p. ej. `https://carrusel.etziel.com`.
- La variable `WEBHOOK_SECRET` configurada en el servidor.
- En n8n, una **Variable** `WEBHOOK_SECRET` con el **mismo** valor
  (*Variables → Add Variable*, scope Global). Se lee en el nodo Code con
  `$vars.WEBHOOK_SECRET`. En n8n Cloud las Variables están en los planes
  Pro/Enterprise; si tu plan no las incluye, escribe el secreto directamente
  en el nodo Code (no lo compartas ni lo subas a git).

---

## 2. Formato de la petición

```
POST https://carrusel.etziel.com/api/webhook/USER1
Content-Type: application/json
X-Webhook-Secret: <HMAC-SHA256 hex del cuerpo crudo>

{
  "images": [
    { "url": "https://cdn.ejemplo.com/1.jpg", "alt": "Primera" },
    { "url": "https://cdn.ejemplo.com/2.jpg", "alt": "Segunda" }
  ],
  "mode": "append"
}
```

- `mode`: `"append"` (por defecto) agrega sin borrar; `"replace"` reemplaza todo.
- En modo append, las URLs que ya están en el carrusel se **omiten**.
- `images`: entre 1 y 100 elementos.
- `url`: obligatoria, `http` o `https`.
- `alt`: opcional, se muestra como título sobre la imagen.
- `order` / `id`: opcionales.
- `duration`: opcional, segundos que dura esa imagen (2–3600). Sin ella usa la del carrusel.

El `userId` va en la URL (no en el cuerpo). Si lo incluyes en el cuerpo, debe
coincidir con el de la URL o dará `400`.

---

## 3. Calcular la firma (paso crítico)

La firma es un **HMAC-SHA256 en hexadecimal del cuerpo EXACTO** que se envía.
Usa el string serializado una sola vez y reutilízalo tanto para firmar como
para el body.

### Nodo Code (JavaScript)

```js
const crypto = require('crypto');

// Construye el body UNA vez y reutilízalo.
const payload = {
  images: items.map((item) => ({
    url: item.json.url,
    alt: item.json.alt ?? '',
  })),
  mode: 'append', // agrega sin borrar; usa 'replace' para reemplazar todo
};

const body = JSON.stringify(payload); // sin espacios extra
const signature = crypto
  .createHmac('sha256', $vars.WEBHOOK_SECRET)
  .update(body, 'utf8')
  .digest('hex');

return [{ json: { body, signature } }];
```

> No uses `JSON.stringify(payload, null, 2)` para el body y algo distinto para
> firmar: el servidor firma el **texto crudo** recibido, así que deben coincidir
> byte a byte.

### Nodo Code (Python)

```python
import hmac, hashlib, json
secret = _env['WEBHOOK_SECRET']

payload = {"images": [{"url": i["json"]["url"], "alt": i["json"].get("alt", "")} for i in _items], "mode": "append"}
body = json.dumps(payload, separators=(',', ':'))

signature = hmac.new(secret.encode(), body.encode('utf-8'), hashlib.sha256).hexdigest()

return [{"json": {"body": body, "signature": signature}}]
```

---

## 4. Nodo HTTP Request

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://carrusel.etziel.com/api/webhook/USER1` |
| Body Content Type | `Raw` / `JSON` |
| Body | `={{ $json.body }}` |
| Header | `Content-Type: application/json` |
| Header | `X-Webhook-Secret: {{ $json.signature }}` |

Respuesta esperada:

```json
{ "success": true, "message": "Añadidas 2 imágenes a USER1", "data": { "count": 2, "skipped": 0, "userId": "USER1", "mode": "append" } }
```

---

## 5. Workflow importable

En [`n8n-workflow.json`](n8n-workflow.json) tienes un workflow mínimo:

```
Manual Trigger → Code (firma) → HTTP Request (webhook)
```

Pasos para usarlo:

1. En n8n: **Workflows → Import from File** y selecciona `n8n-workflow.json`.
2. Edita el nodo **HTTP Request** y sustituye `TU-APP.vercel.app` por tu dominio y `USER1` por tu carrusel.
3. Define la variable `WEBHOOK_SECRET` en n8n.
4. En el nodo **Set imágenes** (o en el Code) cambia el array de ejemplo.
5. Ejecuta y comprueba que las imágenes se **agregan** al carrusel.

---

## 6. Casos de uso

### Sincronizar desde un CMS / base de datos

1. **Nodo** que devuelve filas (Postgres, Airtable, Google Sheets…).
2. **Code** que mapea cada fila a `{ url, alt }`.
3. **HTTP Request** al webhook.

### Añadir imágenes (comportamiento por defecto)

El webhook ya **agrega** por defecto y omite las URLs repetidas. Basta con
enviar solo las imágenes nuevas:

```
POST /api/webhook/USER1   { "images": [ { "url": "<nueva>" } ], "mode": "append" }
```

### Reemplazar todo el carrusel

Envía `"mode": "replace"` con el array completo; lo anterior se descarta:

```
POST /api/webhook/USER1   { "images": [ ...todas... ], "mode": "replace" }
```

### Automatizar desde Cloudinary

Un webhook de Cloudinary (al subir un asset) puede disparar un workflow que:
1. Liste los recursos de la carpeta.
2. Mapee `secure_url` → `url`.
3. Envíe el array al webhook.

---

## 7. Errores frecuentes

| Código | Causa | Solución |
|---|---|---|
| `401` | Firma ausente o distinta | Asegúrate de firmar el **mismo string** que envías y de usar el mismo `WEBHOOK_SECRET`. |
| `400` | `images` vacío, URL inválida o `userId` del cuerpo ≠ URL | Revisa el mapeo, que cada `url` sea `http(s)` y quita `userId` del cuerpo. |
| `404` | El carrusel `USERx` no existe | Crea el usuario en el panel o usa el `userId` correcto. |
| `410` | Usaste el endpoint global `/api/webhook` | Cambia a `/api/webhook/USERx`. |
| `429` | Demasiadas peticiones | Sube `RATE_LIMIT_WEBHOOK` o agrupa envíos. |
| `500` | Redis no configurado | Revisa `KV_REST_API_URL` / `KV_REST_API_TOKEN` en Vercel. |

---

## 8. Probar la firma en local

```bash
BODY='{"images":[{"url":"https://picsum.photos/seed/a/1600/900","alt":"Test"}],"mode":"append"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -i -X POST http://localhost:3000/api/webhook/USER1 \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

---

## 9. Re-hospedaje permanente

Los generadores de imágenes suelen devolver URLs **temporales** (Alibaba/Qwen
caduca en ~24 h). Para que el carrusel no las pierda, usa `/api/upload/USERx`:
recibe la imagen y la guarda de forma **permanente** (Vercel Blob en la nube,
disco en Docker/local), devolviendo la URL estable.

Hay dos formas de enviarla:

- **Binario (recomendado):** el nodo de imagen de n8n ya descarga la imagen como
  binario (`downloadImage`, por defecto activo). Se manda en base64 dentro del
  JSON. Evita descargas y URLs temporales.
- **URL:** se manda la URL temporal y el servidor la descarga.

### Flujo recomendado

```
Generar imagen → POST /api/upload/USER1  (imagen en base64, firmado)
                     └─► devuelve { url: <permanente o /uploads/...> }
                          └─► POST /api/webhook/USER1  (con esa url, mode "append")
```

### Nodo Code: firmar el body de upload (binario)

```js
const crypto = require('crypto');
const item = $input.first();
const bin = item.binary || {};
const key = Object.keys(bin)[0];
const payload = key && bin[key] && bin[key].data
  ? { data: bin[key].data, contentType: bin[key].mimeType || 'image/png', alt: '' }
  : { url: item.json.imageUrl, alt: '' };
const body = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', $vars.WEBHOOK_SECRET)
  .update(body, 'utf8').digest('hex');
return [{ json: { body, signature } }];
```

> Si el nodo de imagen no trae binario, cae a la URL (`item.json.imageUrl`) y el
> servidor la descarga (el host debe estar en `UPLOAD_ALLOWED_HOSTS`).

### Nodo HTTP Request (upload)

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://carrusel.etziel.com/api/upload/USER1` |
| Body Content Type | `Raw` / `JSON` |
| Body | `={{ $json.body }}` |
| Header | `Content-Type: application/json` |
| Header | `X-Webhook-Secret: {{ $json.signature }}` |

La respuesta trae `data.url`. Úsala luego en `/api/webhook/USER1` con `mode: "append"`.

> `alt: ""` deja la imagen sin texto sobreimpreso en el carrusel.

### Imágenes grandes: el archivo como cuerpo (sin base64)

En base64 el servidor tiene que cargar todo el cuerpo en memoria, así que ese modo acepta
hasta **8 MB** (`UPLOAD_BASE64_MAX_BYTES`); si la imagen pesa más responde `413` y pide
este otro modo. Aquí el cuerpo de la petición **es la imagen** y el servidor la escribe a
disco mientras llega (hasta `UPLOAD_MAX_BYTES`, 15 MB):

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://carrusel.etziel.com/api/upload/USER1?alt=` |
| Body Content Type | `n8n Binary File` (campo binario de la imagen) |
| Header | `Content-Type: image/png` (el tipo real: `image/jpeg`, `image/webp`...) |
| Header | `X-Webhook-Timestamp: {{ $json.timestamp }}` (solo con token de cliente) |
| Header | `X-Webhook-Secret: {{ $json.signature }}` |

La firma es la misma de siempre, pero sobre los **bytes** de la imagen en vez de sobre un JSON:

```js
const crypto = require('crypto');
const bytes = await this.helpers.getBinaryDataBuffer(0, 'data'); // nombre del campo binario
const timestamp = Math.floor(Date.now() / 1000).toString();
// Con token de cliente: HMAC(token, "<timestamp>." + bytes)
const signature = crypto.createHmac('sha256', TOKEN_DEL_CLIENTE)
  .update(`${timestamp}.`).update(bytes).digest('hex');
// Sin token (firma global antigua): HMAC(WEBHOOK_SECRET, bytes), sin timestamp
return [{ json: { timestamp, signature }, binary: $input.first().binary }];
```

El `alt` va en la URL (`?alt=texto`). La respuesta es la misma: `data.url`.

---

## 10. V2 — Agente conversacional con aprobación (actual)

Workflow principal: **Carrusel V2 — Agente** (Telegram Trigger → AI Agent con
memoria por chat → envía foto o texto). Hijos como herramientas del agente:

| Workflow | Qué hace |
|---|---|
| `V2 · Buscar producto` | Busca la foto en la carpeta Drive del catálogo por nombre (match exacto, parcial o sugerencias). |
| `V2 · Generar póster` | Wan `wan2.6-image` con la foto como referencia (o qwen t2i si se inventa) → Edit Image 2048px JPEG 90 → re-hospeda → guarda pendiente (tope 5 rondas). |
| `V2 · Publicar póster` | Agrega el pendiente a `/api/webhook/USER1` (`mode:"append"`, `alt:""`). |

Estado por chat en la Data Table `carrusel_v2_pendientes`. Reglas (system prompt):
foto del catálogo siempre que exista (si no, se avisa y se inventa); texto en
español con ortografía correcta; **nunca inventar precio**; calidad máxima sin
importar el tiempo (`2K`, `prompt_extend`, JPEG 90). Detalle en
[`POSTER-SPECS.md`](POSTER-SPECS.md).

> El V1 (`Telegram Bot - Poster Generator…`) queda despublicado al activar V2
> (mismo bot = un solo webhook de Telegram).


## 11. Administrar el carrusel desde el chat

`POST /api/manage/USERx` (misma firma HMAC que el webhook) permite listar, borrar o
cambiar la duración de una imagen. Detalle en [`API.md`](API.md#manage-administrar-desde-el-chat).

El workflow `DIRECTOR_DE_ARTE_TELEGRAM` lo usa con comandos de texto fijo (sin IA):

| Mensaje | Acción |
|---|---|
| `lista` | Muestra cada imagen con su número y duración. |
| `duracion 3 20` | La imagen #3 dura 20 s. |
| `duracion todas 12` | Duración por defecto del carrusel. |
| `borrar 3` | Pide confirmación y borra la imagen #3. |

Además, una **foto** enviada al bot se guarda tal cual en la carpeta de Drive del panel
(el pie de foto es el nombre del archivo), sin pasar por el agente de IA. Si la cuenta de
Google no tiene permiso de edición en la carpeta, el bot lo avisa en el chat.

---

## 12. Token propio por cliente (firma nueva)

Cada carrusel puede tener su **propio token**. Se genera en el panel de
super-admin (Ajustes del usuario → **Generar token**), se muestra **una sola
vez** y en el servidor queda cifrado. Para volver a verlo hay que
**regenerarlo**; el anterior deja de funcionar en ese momento.

Con token, la firma cambia en dos cosas:

```
X-Webhook-Timestamp: <hora actual en segundos (Unix)>
X-Webhook-Secret:    HMAC-SHA256 hex de  "<timestamp>.<cuerpo crudo>"  con el token del cliente
```

- El servidor rechaza una marca de tiempo con más de **5 minutos** de diferencia.
- Una misma firma **no se puede usar dos veces** (no se puede repetir una petición capturada).
- El token de un carrusel no sirve para otro.
- Aplica a `/api/webhook`, `/api/upload`, `/api/manage`, `/api/settings-read` y `/api/usage`.

Mientras un carrusel **no tenga token** se sigue aceptando la firma antigua
(solo el cuerpo, con `WEBHOOK_SECRET`). En cuanto se le genera uno, ese carrusel
solo acepta la firma nueva. Para apagar la firma antigua en todo el servidor:
`ALLOW_GLOBAL_WEBHOOK_SECRET=0`.

### Nodo Code de firma

El código de firma vive en el repo, en [`n8n/firma.js`](../n8n/firma.js), y se
pega igual al inicio de los nodos `Firmar settings`, `Firmar comando`,
`Subir imagen compuesta`, `Firmar webhook` y `Firmar consumo`. Ningún nodo lleva
un secreto escrito: el token sale de la fila del cliente.

```js
const token = String($('Variables').first().json.token || '');
// `body` es el mismo string que se envía (el que ya arma cada nodo)
const firma = firmar(token, body);
return [{ json: { body: firma.body, signature: firma.signature, timestamp: firma.timestamp } }];
```

`firmar` decide por el **prefijo** del valor de la columna `token`:

| Valor en `token` | Firma |
|---|---|
| empieza con `crt_` (token generado en el panel) | `HMAC(token, "<timestamp>.<cuerpo>")` |
| cualquier otro (el `WEBHOOK_SECRET` global) | `HMAC(token, "<cuerpo>")` — la firma antigua |
| vacío | el flujo se detiene: «Este cliente no tiene token en la tabla whatsapp_numeros» |

Así una fila puede seguir con el secreto global y, el día que se le genere su
token, solo se cambia el valor de la fila: el flujo no se toca.

Los nodos HTTP Request que van después mandan siempre la cabecera (con la firma
antigua el servidor la ignora):

| Header | Valor |
|---|---|
| `X-Webhook-Timestamp` | `{{ $json.timestamp }}` |

### Un flujo, una fila por cliente

Todos los clientes usan el mismo flujo (`DIRECTOR_DE_ARTE_WHATSAPP`). Lo que
cambia por cliente vive en la tabla `whatsapp_numeros`:

| Columna | Qué es |
|---|---|
| `numero` | 10 dígitos del WhatsApp del cliente |
| `carrusel` | `USERx` (su link es `https://carrusel.etziel.com/carrusel/USERx`) |
| `token` | el token generado en el panel |
| `workflow_id` | id del flujo que lo atiende |
| `activo` | ✔ |

El flujo busca su propio token: al entrar, `Buscar token` lee la fila activa de
`whatsapp_numeros` del número que escribe (la misma que eligió el recepcionista) y
`Adjuntar token` lo agrega al mensaje (`Variables` lo deja pasar).
`RECEPCIONISTA_WHATSAPP` no cambia.

Estado (2026-10-08): la columna `token` ya existe y el flujo apagado
`COPIA_SEGURIDAD_DIRECTOR_ARTE` ya tiene estos cambios. Falta llenar `token` en
cada fila y pasar los cambios a `DIRECTOR_DE_ARTE_WHATSAPP`.

**Volver a aplicar el parche** (a otro flujo, o si cambia `n8n/firma.js`):

1. Exportar el flujo a `n8n/.work/<nombre>.json` (carpeta ignorada por git: el
   export puede traer secretos).
2. `node scripts/n8n-patch-flujo.mjs n8n/.work/<nombre>.json n8n/.work/<nombre>.patched.json`
3. Importar el resultado en el flujo y comprobar lo guardado:
   `node scripts/test-n8n.mjs n8n/.work/<export nuevo>.json --parchado`

**Dar de alta un cliente** después de eso:

1. Super-admin → **Nuevo usuario**. Anota su `USERx`.
2. Ajustes del usuario → límite de MB (opcional) → **Generar token** → copiarlo.
3. n8n → Data tables → `whatsapp_numeros` → **Add row** con los 5 datos.

No se duplica ni se edita ningún flujo.

## 13. Reportar consumo

Después de cada generación, n8n avisa al carrusel (misma firma):

```
POST /api/usage/USERx
{ "eventId": "<id único>", "kind": "image", "model": "wan2.7-image-pro",
  "tokens": { "input_tokens": 200, "output_tokens": 1000, "total_tokens": 1200 } }
```

- `kind`: `image`, `video` (con `"seconds": 5`) o `text` (solo tokens, p. ej. el modelo de chat).
- `tokens`: lo que devuelva el proveedor en `usage`. Si no hay, se omite: la
  imagen se cuenta "sin tokens" y entra en el costo aproximado
  (imágenes sin tokens × precio por imagen, 0.06 USD por defecto, editable en el
  panel de super-admin).
- `eventId`: úsalo siempre. Si n8n reintenta, el mismo evento no se suma dos veces.

En el flujo lo hacen dos nodos que salen de `Generar Wan` y de `Generar Qwen`:
`Firmar consumo` → `Reportar consumo`. El cuerpo lo arma
[`n8n/consumo.js`](../n8n/consumo.js):

- `eventId` = `<id de la ejecución>-gen-<n>`, uno por cada generación (cada ronda
  de revisión es una imagen más).
- `Generar Wan` devuelve `usage` y se manda en `tokens`; Qwen no lo da y se manda
  sin `tokens`.
- El reporte **nunca detiene el flujo**: si el carrusel responde con error o no
  responde en 10 s, el póster se envía igual. Va arriba de `Fijar foto` en el
  lienzo para que corra antes de esperar la aprobación del cliente.
- Los tokens del modelo de chat (`AI Agent`) no se reportan: el nodo no los expone.

## 14. Espacio lleno

Cada carrusel tiene un límite de almacenamiento. Si una subida no cabe,
`/api/upload/USERx` responde **413** con `details.code = "QUOTA_EXCEEDED"`.
Conviene que el nodo HTTP de subida no corte el flujo con ese error y que el bot
conteste algo como «Tu espacio está lleno: borra imágenes o pide más espacio».

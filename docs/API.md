# Referencia de la API

Base URL: `https://TU-APP.vercel.app` (en local: `http://localhost:3000`).

Todas las respuestas son JSON. Las respuestas de éxito tienen la forma:

```json
{ "success": true, "message": "OK", "data": { } }
```

Las de error:

```json
{ "error": "Mensaje", "details": null }
```

---

## Imágenes

### `GET /api/images`

Pública. Devuelve todas las imágenes ordenadas por `order`.

- **Auth**: no.
- **Rate limit**: `RATE_LIMIT_IMAGES` (60/min por defecto).

**Respuesta 200**

```json
{
  "images": [
    {
      "id": "3f1c...",
      "url": "https://cdn.ejemplo.com/1.jpg",
      "alt": "Primera",
      "order": 0,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

**Ejemplo**

```bash
curl https://TU-APP.vercel.app/api/images
```

---

### `POST /api/images`

Admin. Añade una imagen al final.

- **Auth**: cookie de sesión (`auth_token`) con `role: admin`.
- **Body**:

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `url` | string | Sí | URL `http(s)` de la imagen. |
| `alt` | string | No | Texto mostrado sobre la imagen. |
| `order` | integer | No | Posición. Por defecto, al final. |

**Respuesta 200**

```json
{ "success": true, "message": "Image added successfully", "data": { "id": "...", "...": "..." } }
```

**Errores**

| Código | Motivo |
|---|---|
| `400` | Validación fallida (URL ausente o inválida). |
| `401` | Sin cookie de sesión. |
| `403` | Token inválido o rol distinto de `admin`. |
| `429` | Rate limit excedido. |

**Ejemplo**

```bash
curl -X POST https://TU-APP.vercel.app/api/images \
  -H "Content-Type: application/json" \
  -b "auth_token=<JWT>" \
  -d '{"url":"https://cdn.ejemplo.com/nueva.jpg","alt":"Nueva"}'
```

---

### `PATCH /api/images`

Admin. Actualiza una imagen **o** reordena varias.

- **Auth**: cookie de sesión admin.

#### Modo 1 — actualizar una imagen

**Body**: `{ "id": "...", "url"?, "alt"?, "order"?, "view"?, "duration"? }` (solo los campos a cambiar).

`duration` es cuánto dura esa imagen en pantalla, en segundos (entero entre 2 y 3600).
Con `null` la imagen vuelve a usar la duración por defecto del carrusel (`slideDuration`,
8 s si no se configuró; se cambia con `PATCH /api/settings`). El carrusel público
(`GET /api/carrusel?userId=USER1`) devuelve `{ images, slideDuration }`.

```bash
curl -X PATCH https://TU-APP.vercel.app/api/images \
  -H "Content-Type: application/json" \
  -b "auth_token=<JWT>" \
  -d '{"id":"3f1c...","alt":"Nuevo título"}'
```

#### Modo 2 — reordenar (array)

**Body**: `[{ "id": "...", "order": 0 }, { "id": "...", "order": 1 }]`

```bash
curl -X PATCH https://TU-APP.vercel.app/api/images \
  -H "Content-Type: application/json" \
  -b "auth_token=<JWT>" \
  -d '[{"id":"a","order":0},{"id":"b","order":1}]'
```

**Errores**: `400` validación, `401`/`403` auth, `404` imagen no encontrada.

---

### `DELETE /api/images?id=<id>`

Admin. Elimina una imagen.

```bash
curl -X DELETE "https://TU-APP.vercel.app/api/images?id=3f1c..." \
  -b "auth_token=<JWT>"
```

**Errores**: `400` falta `id`, `401`/`403` auth, `404` no encontrada.

---

## Webhook (n8n)

Cada carrusel tiene su **propio** webhook: `POST /api/webhook/USERx`. El
endpoint global antiguo (`/api/webhook`) sigue existiendo pero responde
`410 Gone`.

### `POST /api/webhook/USER1`

Autenticado por firma HMAC. Por defecto **agrega** imágenes al carrusel
(`mode: "append"`); con `mode: "replace"` reemplaza todo el contenido.

- **Auth**: header `X-Webhook-Secret` = HMAC-SHA256 (hex) del **cuerpo crudo**
  usando `WEBHOOK_SECRET`.
- **Rate limit**: `RATE_LIMIT_WEBHOOK` (10/min por defecto), por carrusel.
- **Límites**: 1 a 100 imágenes por petición.
- El `userId` sale de la URL. Debe existir ese carrusel (`404` si no). Si el
  cuerpo incluye `userId`, debe coincidir con el de la URL (`400` si no).

**Body**

```json
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
- Cada elemento admite también `id` y `order` opcionales.

**Respuesta 200 (append)**

```json
{
  "success": true,
  "message": "Añadidas 2 imágenes a USER1",
  "data": { "count": 2, "skipped": 0, "images": [ ], "userId": "USER1", "mode": "append" }
}
```

`count` = imágenes agregadas; `skipped` = URLs que ya existían.

**Errores**

| Código | Motivo |
|---|---|
| `400` | `userId` de la URL inválido, JSON inválido, `images` ausente/vacío, > 100 imágenes, `mode` inválido, `userId` del cuerpo ≠ URL, o validación fallida. |
| `401` | Falta la firma o no coincide. |
| `404` | El carrusel `USERx` no existe. |
| `410` | Se usó el endpoint global retirado `/api/webhook`. |
| `429` | Rate limit excedido. |

**Ejemplo con firma**

```bash
BODY='{"images":[{"url":"https://cdn.ejemplo.com/1.jpg","alt":"Una"}],"mode":"append"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://carrusel.etziel.com/api/webhook/USER1 \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

> Importante: firma el **string exacto** que envías como cuerpo. Cualquier
> diferencia de espacios o saltos de línea invalida la firma.

---

## Upload (re-hospedaje de imágenes)

### `POST /api/upload/USER1`

Descarga una imagen desde una URL **temporal** y la re-hospeda de forma
**permanente** (Vercel Blob en la nube, disco en Docker/local), devolviendo la
nueva URL. Pensado para que n8n convierta la URL efímera de un generador de
imágenes (p. ej. Alibaba/Qwen, que caduca en ~24 h) en una URL estable.

También acepta la imagen directamente, de tres formas: `{ "url": … }`, `{ "data": "<base64>" }`
(hasta 8 MB, `UPLOAD_BASE64_MAX_BYTES`) o **el archivo como cuerpo** con `Content-Type: image/*`
y `?alt=` (hasta `UPLOAD_MAX_BYTES`; se escribe a disco mientras llega y la firma se calcula
sobre los bytes: `HMAC(token, "<timestamp>." + cuerpo)`). Ver `docs/N8N.md`.

El `userId` sale de la URL y debe existir. El endpoint global antiguo
(`/api/upload`) responde `410 Gone`.

- **Auth**: header `X-Webhook-Secret` = HMAC-SHA256 (hex) del **cuerpo crudo**, con `WEBHOOK_SECRET`.
- **Rate limit**: `RATE_LIMIT_WEBHOOK` (10/min por defecto), por carrusel.
- **Límites**: 15 MB por defecto (`UPLOAD_MAX_BYTES`); timeout de descarga 20 s (`UPLOAD_FETCH_TIMEOUT`).

**Body**

Dos formas (firmadas igual con HMAC):

1. **URL** (descarga y re-hospeda):
```json
{ "url": "https://dashscope-....aliyuncs.com/....png?Expires=...", "alt": "Título opcional" }
```
`url` debe ser `http(s)` y su host debe estar en `UPLOAD_ALLOWED_HOSTS`
(por defecto `aliyuncs.com,cloudinary.com,pollinations.ai`) para evitar SSRF.

2. **Binario** (recomendado para n8n; evita SSRF y URLs temporales):
```json
{ "data": "<imagen en base64>", "contentType": "image/png", "alt": "" }
```
El servidor detecta el tipo real por los *magic bytes* y lo guarda.

`alt` vacío = sin texto en el carrusel.

**Respuesta 200**

La `url` puede ser absoluta (Vercel Blob) o relativa a este dominio
(`/uploads/...`) cuando el almacenamiento es local/disco. En ambos casos el
navegador la carga correctamente.

```json
{
  "success": true,
  "message": "Image stored permanently",
  "data": {
    "url": "/uploads/1712345678-1a2b3c4d.png",
    "pathname": "uploads/1712345678-1a2b3c4d.png",
    "contentType": "image/png",
    "alt": "",
    "userId": "USER1"
  }
}
```

**Errores**

| Código | Motivo |
|---|---|
| `400` | URL ausente/inválida, JSON inválido, host no permitido, no es una imagen, o `userId` del cuerpo ≠ URL. |
| `401` | Falta la firma o no coincide. |
| `404` | El carrusel `USERx` no existe. |
| `410` | Se usó el endpoint global retirado `/api/upload`. |
| `413` | Imagen demasiado grande. |
| `429` | Rate limit excedido. |
| `500` | `BLOB_READ_WRITE_TOKEN` no configurado o fallo al subir. |
| `502`/`504` | No se pudo descargar la imagen o expiró el tiempo. |

**Ejemplo**

```bash
BODY='{"url":"https://dashscope-....aliyuncs.com/x.png","alt":"Poster"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://carrusel.etziel.com/api/upload/USER1 \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

---

## Manage (administrar desde el chat)

### `POST /api/manage/USER1`

Lista, borra o cambia la duración de imágenes sin iniciar sesión, para que n8n lo haga
desde el chat. Misma firma que el webhook: `X-Webhook-Secret` = HMAC-SHA256 (hex) del
cuerpo crudo con `WEBHOOK_SECRET`.

| Body | Qué hace |
|---|---|
| `{ "action": "list" }` | Devuelve `{ count, slideDuration, images: [{ index, id, url, alt, duration, effectiveDuration }] }`. |
| `{ "action": "duration", "index": 3, "duration": 20 }` | La imagen #3 dura 20 s. |
| `{ "action": "duration", "index": "all", "duration": 12 }` | Cambia la duración por defecto del carrusel. |
| `{ "action": "delete", "index": 3 }` | Borra la imagen #3 (y su archivo). No se puede deshacer. |

`index` es la posición en el carrusel (1 = primera, según `order`); también se acepta `id`.

**Errores**: `400` acción o duración inválida, `401` firma ausente/incorrecta, `404` carrusel
o imagen inexistente (`"No existe la imagen #7; hay 5 en el carrusel"`), `429` rate limit.

---

## Health (diagnóstico)

### `POST /api/health`

Diagnóstico protegido por HMAC. Devuelve booleanos y los **nombres** de las
variables relevantes (nunca sus valores).

- **Auth**: header `X-Webhook-Secret` = HMAC-SHA256 (hex) del cuerpo crudo.

```bash
BODY='{}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST https://TU-APP.vercel.app/api/health \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: $SIG" -d "$BODY"
```

**Respuesta**

```json
{
  "ok": true,
  "node": "v20.x",
  "redisConfigured": true,
  "blobToken": true,
  "blobAccess": "public",
  "jwtSecret": true,
  "webhookSecret": true,
  "adminHash": true,
  "uploadAllowedHosts": "aliyuncs.com,cloudinary.com,pollinations.ai",
  "relevantEnvNames": ["ADMIN_PASSWORD_HASH", "BLOB_READ_WRITE_TOKEN", "KV_REST_API_URL"]
}
```

---

## Autenticación

### `POST /api/auth`

Login. Dos modos:

- **Super-admin**: `{ "password": "..." }`. Valida contra `ADMIN_PASSWORD_HASH` (Argon2id).
- **Usuario**: `{ "email": "usuario@ejemplo.com", "password": "..." }`. El correo es insensible a mayúsculas.

- **Éxito 200**: establece la cookie `auth_token` (HttpOnly, Secure, SameSite=Strict).

```bash
curl -X POST https://TU-APP.vercel.app/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"tu-contraseña"}' \
  -c cookies.txt

curl -X POST https://TU-APP.vercel.app/api/auth \
  -H "Content-Type: application/json" \
  -d '{"email":"usuario@ejemplo.com","password":"..."}' \
  -c cookies.txt
```

**Errores**: `400` sin contraseña, `401` credenciales inválidas, `429` demasiados intentos.

---

### `GET /api/auth`

Comprueba la sesión actual.

```json
{ "authenticated": true, "role": "admin" }
```

Si el rol es `user`, incluye además `userId`, `name` y `email`. Si no hay sesión válida: `{ "authenticated": false }`.

---

## Subida manual de imágenes (panel)

### `POST /api/images-upload[?userId=USER2]`

Sube una imagen desde el PC o el móvil y la añade al final del carrusel.

- **Auth**: cookie de sesión. Un usuario sube a su propio carrusel (si pasa otro `userId` → `403`). El super-admin debe indicar `?userId=`.
- **Body**: el archivo tal cual (`Content-Type: image/*`, sin multipart). JPEG, PNG, WebP o GIF; el tipo se comprueba por el contenido real del archivo. `alt` opcional por query (`?alt=texto`).
- **Límite**: 25 MB por archivo (`MANUAL_UPLOAD_MAX_BYTES`). El panel reduce las fotos a 1920 px antes de enviarlas, así que las fotos de móvil quedan muy por debajo.
- **Memoria**: el cuerpo se escribe a un temporal en disco mientras llega y la foto se convierte a WebP con sharp desde disco; no se carga entera en RAM. Las optimizaciones van de una en una (cada una cuesta ~80 MB de RAM nativa).
- **Almacenamiento**: Vercel Blob (debe ser **público**) o `.data/uploads` en local/Docker.

**Errores**: `400` sin archivo / no es imagen / falta `userId` (super-admin), `401` sin sesión, `403` carrusel ajeno, `404` usuario inexistente, `413` demasiado grande, `429` límite de peticiones.

---

## Usuarios (solo super-admin)

### `GET /api/users`

Lista usuarios con `userId`, `name`, `email`, fechas, `imageCount` y hasta 3 URLs de vista previa (`preview`). Nunca incluye hashes de contraseña.

### `POST /api/users`

Crea un usuario. Body: `{ "name", "email", "password" }` (contraseña mín. 6 caracteres). El correo debe ser único (409 si ya existe). Devuelve la contraseña **una sola vez**; no se puede volver a consultar.

### `PATCH /api/users?userId=USER2`

Actualiza `name` y/o `email` del usuario.

### `PATCH /api/users/password?userId=USER2`

Cambia la contraseña. Body: `{ "password" }`. Devuelve la contraseña una sola vez.

### `DELETE /api/users?userId=USER2`

Elimina el usuario y todo su carrusel. Requiere confirmación en el panel.

---

### `DELETE /api/auth`

Cierra la sesión (borra la cookie).

```bash
curl -X DELETE https://TU-APP.vercel.app/api/auth -b cookies.txt
```

---

## De quién es el carrusel

En todas las rutas con sesión, el carrusel de un usuario sale de su cookie. Si además
manda `?userId` de otro carrusel, la respuesta es `403`. El super-admin debe indicar `?userId`.

---

## Firma de las peticiones de n8n

Los endpoints `/api/webhook/USERx`, `/api/upload/USERx`, `/api/manage/USERx`,
`/api/settings-read/USERx` y `/api/usage/USERx` se firman así:

| Caso | Cabeceras |
|---|---|
| El carrusel **tiene token** | `X-Webhook-Timestamp: <segundos Unix>` y `X-Webhook-Secret: HMAC-SHA256 hex de "<timestamp>.<cuerpo crudo>"` con el token del carrusel |
| El carrusel **no tiene token** (transición) | `X-Webhook-Secret: HMAC-SHA256 hex del cuerpo crudo` con `WEBHOOK_SECRET` |

Con token: el timestamp no puede diferir más de 5 minutos, una firma no se puede
reutilizar y el token de un carrusel no vale para otro. `ALLOW_GLOBAL_WEBHOOK_SECRET=0`
desactiva el caso sin token. Errores: `401` con `Missing signature`,
`Missing timestamp`, `Expired timestamp`, `Invalid signature` o `Signature already used`.

---

## Token por cliente (solo super-admin)

### `POST /api/users/token?userId=USER2`

Genera o regenera el token de webhook. La respuesta es **la única vez** que se ve:

```json
{ "success": true, "data": { "userId": "USER2", "token": "crt_…", "hint": "aB3x", "createdAt": "…" } }
```

En el servidor queda cifrado (AES-256-GCM con `TOKEN_ENC_KEY`). `GET /api/users`
solo devuelve `hasToken`, `tokenHint` (últimos 4) y `tokenCreatedAt`.

---

## Espacio y consumo

### `GET /api/usage[?userId=USER2][&month=AAAA-MM]`

Sesión requerida. Un usuario ve lo suyo; el super-admin pasa `?userId`.

```json
{
  "success": true,
  "data": {
    "userId": "USER2",
    "storage": { "usedBytes": 190840832, "limitBytes": 524288000, "freeBytes": 333447168, "fileCount": 42, "storageLimitMb": null, "defaultLimitMb": 500 },
    "usage": { "month": "2026-10", "images": 42, "imagesNoTokens": 40, "videos": 3, "videoSeconds": 15, "tokensIn": 400, "tokensOut": 2000, "tokensTotal": 2400, "imagePriceUsd": 0.06, "estimatedCostUsd": 2.4 }
  }
}
```

`estimatedCostUsd` = `imagesNoTokens × imagePriceUsd`. Los meses son UTC.
Sin `userId`, el super-admin recibe `{ "imagePriceUsd": 0.06 }`.

### `PATCH /api/usage` (solo super-admin)

`{ "imagePriceUsd": 0.06 }` — precio aproximado por imagen sin tokens reportados.

### `POST /api/usage/USER2` (firmado, desde n8n)

```json
{ "eventId": "exec-123-qwen", "kind": "image", "model": "qwen-image", "count": 1,
  "tokens": { "input": 0, "output": 0, "total": 0 }, "seconds": 5 }
```

`kind`: `image` | `video` | `text`. `tokens` acepta también `input_tokens` /
`output_tokens` / `total_tokens` o `prompt_tokens` / `completion_tokens`. Un
`eventId` repetido responde `200` con `duplicate: true` y no suma.

### Límite de espacio

- `PATCH /api/users?userId=USER2` acepta `storageLimitMb` (entero ≥ 1; `null` = límite
  por defecto, `DEFAULT_STORAGE_MB`, 500).
- Cuando una subida no cabe (`/api/images-upload` o `/api/upload/USERx`) la respuesta es
  `413` con `details.code = "QUOTA_EXCEEDED"`, `usedBytes`, `limitBytes` y `fileBytes`.
- Borrar una imagen libera su espacio. Un archivo solo lo puede borrar el carrusel que lo subió.
- `node scripts/migrate-storage.mjs [--dry-run]` anota los archivos subidos antes de que
  existiera el límite. No borra nada.

---

## Ajustes de generación

### `GET /api/settings[?userId=USER2]` · `PATCH /api/settings[?userId=USER2]`

Sesión requerida. Lo que el bot de n8n usa para generar el póster de ese cliente:
`googleDriveFolder`, `colorPalette` (hasta 5 colores HEX), `slideDuration`, `defaultOrientation` y
`posterResolution`.

- `defaultOrientation`: `horizontal` (16:9), `vertical` (9:16), `cuadrado` (1:1), `horizontal43` (4:3) o `vertical34` (3:4).
- `posterResolution`: `hd` (lado corto 720), `fullhd` (1080, por defecto), `2k` (1440) o `4k` (2160). Otro valor → `400`.
- Juntos dan el tamaño del póster, por ejemplo `horizontal` + `4k` = 3840×2160 y `vertical34` + `2k` = 1080×1440.
  Un cliente que nunca eligió resolución recibe `fullhd`, igual que antes.

`POST /api/settings-read/USER2` (firmado, desde n8n) devuelve además de esos datos
`posterWidth` y `posterHeight`, ya calculados.

---

## Sesiones

- La cookie lleva un identificador de sesión. `DELETE /api/auth` la revoca: una copia
  de esa cookie deja de servir.
- `DELETE /api/auth?all=1` cierra todas las sesiones de la cuenta.
- Cambiar la contraseña de un usuario cierra sus sesiones abiertas.
- La sesión de super-admin dura 30 min (`ADMIN_JWT_EXPIRY`) y solo vale en el navegador
  donde se inició.
- Tras 10 intentos fallidos seguidos desde la misma IP contra la misma cuenta, el login
  responde `429` durante 15 minutos (`LOGIN_MAX_FAILS`, `LOGIN_LOCK_SECONDS`).
- Las contraseñas nuevas requieren 10 caracteres o más.
- Las peticiones que cambian datos con un `Origin` distinto al del sitio reciben `403`.

---

## CORS

Las rutas responden a `OPTIONS` para preflight. Los orígenes permitidos usan
`Access-Control-Allow-Origin: *`; el acceso a datos sensibles está protegido por
cookie/JWT y HMAC, no por CORS.

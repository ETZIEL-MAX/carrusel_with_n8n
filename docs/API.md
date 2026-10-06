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
- **Body**: `multipart/form-data` con `file` (JPEG, PNG, WebP o GIF; el tipo se comprueba por el contenido real del archivo) y `alt` opcional.
- **Límite**: 4 MB por archivo (`MANUAL_UPLOAD_MAX_BYTES`). El panel reduce las fotos a 1920 px antes de enviarlas, así que las fotos de móvil quedan muy por debajo.
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

## CORS

Las rutas responden a `OPTIONS` para preflight. Los orígenes permitidos usan
`Access-Control-Allow-Origin: *`; el acceso a datos sensibles está protegido por
cookie/JWT y HMAC, no por CORS.

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

**Body**: `{ "id": "...", "url"?, "alt"?, "order"? }` (solo los campos a cambiar).

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

### `POST /api/webhook`

Reemplaza **todo** el carrusel. Autenticado por firma HMAC.

- **Auth**: header `X-Webhook-Secret` = HMAC-SHA256 (hex) del **cuerpo crudo**
  usando `WEBHOOK_SECRET`.
- **Rate limit**: `RATE_LIMIT_WEBHOOK` (10/min por defecto).
- **Límites**: 1 a 100 imágenes por petición.

**Body**

```json
{
  "images": [
    { "url": "https://cdn.ejemplo.com/1.jpg", "alt": "Primera" },
    { "url": "https://cdn.ejemplo.com/2.jpg", "alt": "Segunda" }
  ]
}
```

Cada elemento admite también `id`, `order` y `createdAt` opcionales; si no se
envían, se generan automáticamente.

**Respuesta 200**

```json
{
  "success": true,
  "message": "Successfully replaced 2 images",
  "data": { "count": 2, "images": [ ] }
}
```

**Errores**

| Código | Motivo |
|---|---|
| `400` | JSON inválido, `images` ausente/vacío, > 100 imágenes, o validación fallida. |
| `401` | Falta la firma o no coincide. |
| `429` | Rate limit excedido. |

**Ejemplo con firma**

```bash
BODY='{"images":[{"url":"https://cdn.ejemplo.com/1.jpg","alt":"Una"}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://TU-APP.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

> Importante: firma el **string exacto** que envías como cuerpo. Cualquier
> diferencia de espacios o saltos de línea invalida la firma.

---

## Upload (re-hospedaje de imágenes)

### `POST /api/upload`

Descarga una imagen desde una URL **temporal** y la re-hospeda de forma
**permanente en Vercel Blob**, devolviendo la nueva URL. Pensado para que n8n
convierta la URL efímera de un generador de imágenes (p. ej. Alibaba/Qwen, que
caduca en ~24 h) en una URL estable para el carrusel.

- **Auth**: header `X-Webhook-Secret` = HMAC-SHA256 (hex) del **cuerpo crudo**, con `WEBHOOK_SECRET`.
- **Rate limit**: `RATE_LIMIT_WEBHOOK` (10/min por defecto).
- **Límites**: 15 MB por defecto (`UPLOAD_MAX_BYTES`); timeout de descarga 20 s (`UPLOAD_FETCH_TIMEOUT`).

**Body**

```json
{ "url": "https://dashscope-....aliyuncs.com/....png?Expires=...", "alt": "Título opcional" }
```

`url` debe ser `http(s)` y su host debe estar en `UPLOAD_ALLOWED_HOSTS`
(por defecto `aliyuncs.com,cloudinary.com,pollinations.ai`) para evitar SSRF.

**Respuesta 200**

```json
{
  "success": true,
  "message": "Image re-hosted permanently",
  "data": {
    "url": "https://xxxx.public.blob.vercel-storage.com/carousel/1712345678-1a2b3c4d.png",
    "pathname": "carousel/1712345678-1a2b3c4d.png",
    "contentType": "image/png",
    "alt": "Título opcional"
  }
}
```

**Errores**

| Código | Motivo |
|---|---|
| `400` | URL ausente/inválida, JSON inválido, host no permitido, o no es una imagen. |
| `401` | Falta la firma o no coincide. |
| `413` | Imagen demasiado grande. |
| `429` | Rate limit excedido. |
| `500` | `BLOB_READ_WRITE_TOKEN` no configurado o fallo al subir. |
| `502`/`504` | No se pudo descargar la imagen o expiró el tiempo. |

**Ejemplo**

```bash
BODY='{"url":"https://dashscope-....aliyuncs.com/x.png","alt":"Poster"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://TU-APP.vercel.app/api/upload \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

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

Login. Valida la contraseña contra `ADMIN_PASSWORD_HASH` (Argon2id).

- **Body**: `{ "password": "..." }`
- **Éxito 200**: establece la cookie `auth_token` (HttpOnly, Secure, SameSite=Strict).

```bash
curl -X POST https://TU-APP.vercel.app/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"tu-contraseña"}' \
  -c cookies.txt
```

**Errores**: `400` sin contraseña, `401` credenciales inválidas, `429` demasiados intentos.

---

### `GET /api/auth`

Comprueba la sesión actual.

```json
{ "authenticated": true, "role": "admin" }
```

Si no hay sesión válida: `{ "authenticated": false }`.

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

# Integración con n8n

Este documento explica cómo sincronizar el carrusel desde **n8n** usando el
webhook firmado `/api/webhook`.

El endpoint hace un **reemplazo total**: el array que envíes pasa a ser el
contenido completo del carrusel. Si quieres conservar las existentes, primero
haz `GET /api/images`, modifica el array y vuelve a enviarlo.

---

## 1. Requisitos

- La URL pública de tu app en Vercel, p. ej. `https://tu-app.vercel.app`.
- La variable `WEBHOOK_SECRET` configurada en Vercel.
- En n8n, una variable de entorno `WEBHOOK_SECRET` con el **mismo** valor
  (*Settings → Variables*, o `$env.WEBHOOK_SECRET` en un nodo Code).

---

## 2. Formato de la petición

```
POST https://TU-APP.vercel.app/api/webhook
Content-Type: application/json
X-Webhook-Secret: <HMAC-SHA256 hex del cuerpo crudo>

{
  "images": [
    { "url": "https://cdn.ejemplo.com/1.jpg", "alt": "Primera" },
    { "url": "https://cdn.ejemplo.com/2.jpg", "alt": "Segunda" }
  ]
}
```

- `images`: entre 1 y 100 elementos.
- `url`: obligatoria, `http` o `https`.
- `alt`: opcional, se muestra como título sobre la imagen.
- `order` / `id` / `createdAt`: opcionales.

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
};

const body = JSON.stringify(payload); // sin espacios extra
const signature = crypto
  .createHmac('sha256', $env.WEBHOOK_SECRET)
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

payload = {"images": [{"url": i["json"]["url"], "alt": i["json"].get("alt", "")} for i in _items]}
body = json.dumps(payload, separators=(',', ':'))

signature = hmac.new(secret.encode(), body.encode('utf-8'), hashlib.sha256).hexdigest()

return [{"json": {"body": body, "signature": signature}}]
```

---

## 4. Nodo HTTP Request

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://TU-APP.vercel.app/api/webhook` |
| Body Content Type | `Raw` / `JSON` |
| Body | `={{ $json.body }}` |
| Header | `Content-Type: application/json` |
| Header | `X-Webhook-Secret: {{ $json.signature }}` |

Respuesta esperada:

```json
{ "success": true, "message": "Successfully replaced 2 images", "data": { "count": 2 } }
```

---

## 5. Workflow importable

En [`n8n-workflow.json`](n8n-workflow.json) tienes un workflow mínimo:

```
Manual Trigger → Code (firma) → HTTP Request (webhook)
```

Pasos para usarlo:

1. En n8n: **Workflows → Import from File** y selecciona `n8n-workflow.json`.
2. Edita el nodo **HTTP Request** y sustituye `TU-APP.vercel.app` por tu dominio.
3. Define la variable `WEBHOOK_SECRET` en n8n.
4. En el nodo **Set imágenes** (o en el Code) cambia el array de ejemplo.
5. Ejecuta y comprueba que el carrusel se actualiza.

---

## 6. Casos de uso

### Sincronizar desde un CMS / base de datos

1. **Nodo** que devuelve filas (Postgres, Airtable, Google Sheets…).
2. **Code** que mapea cada fila a `{ url, alt }`.
3. **HTTP Request** al webhook.

### Añadir una imagen sin borrar las existentes

1. **HTTP Request** `GET https://TU-APP.vercel.app/api/images`.
2. **Code** que hace `push` de la nueva imagen en `images`.
3. **HTTP Request** `POST /api/webhook` con el array completo.

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
| `400` | `images` vacío o URL inválida | Revisa el mapeo y que cada `url` sea `http(s)`. |
| `429` | Demasiadas peticiones | Sube `RATE_LIMIT_WEBHOOK` o agrupa envíos. |
| `500` | Redis no configurado | Revisa `KV_REST_API_URL` / `KV_REST_API_TOKEN` en Vercel. |

---

## 8. Probar la firma en local

```bash
BODY='{"images":[{"url":"https://picsum.photos/seed/a/1600/900","alt":"Test"}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -i -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SIG" \
  -d "$BODY"
```

---

## 9. Re-hospedaje permanente (Vercel Blob)

Los generadores de imágenes suelen devolver URLs **temporales** (Alibaba/Qwen
caduca en ~24 h). Para que el carrusel no las pierda, usa `/api/upload`: recibe
la URL temporal, descarga la imagen y la guarda **permanentemente** en Vercel
Blob, devolviendo la URL estable.

### Flujo recomendado

```
Generar imagen → POST /api/upload  (con la URL temporal, firmado)
                     └─► devuelve { url: <permanente> }
                          └─► POST /api/webhook  (con la URL permanente)
```

### Nodo Code: firmar el body de upload

```js
const crypto = require('crypto');
const payload = { url: $json.imageUrl, alt: $json.alt ?? '' };
const body = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', $env.WEBHOOK_SECRET)
  .update(body, 'utf8').digest('hex');
return [{ json: { body, signature } }];
```

### Nodo HTTP Request (upload)

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://TU-APP.vercel.app/api/upload` |
| Body Content Type | `Raw` / `JSON` |
| Body | `={{ $json.body }}` |
| Header | `Content-Type: application/json` |
| Header | `X-Webhook-Secret: {{ $json.signature }}` |

La respuesta trae `data.url` (permanente). Úsala luego en `/api/webhook`.

> El host de la URL de origen debe estar en `UPLOAD_ALLOWED_HOSTS`
> (por defecto `aliyuncs.com,cloudinary.com,pollinations.ai`).


# Carrusel full-screen con n8n

Carrusel de imágenes a pantalla completa, gestionable desde un panel de administración o sincronizable automáticamente desde **n8n** mediante un webhook firmado.

Desplegado como sitio estático + funciones serverless en **Vercel**, con **Upstash Redis** como almacén de datos.

---

## Tabla de contenido

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Inicio rápido (local)](#inicio-rápido-local)
- [Variables de entorno](#variables-de-entorno)
- [Despliegue en Vercel](#despliegue-en-vercel)
- [Referencia de la API](#referencia-de-la-api)
- [Integración con n8n](#integración-con-n8n)
- [Seguridad](#seguridad)
- [Solución de problemas](#solución-de-problemas)

---

## Características

**Carrusel (`/`)**
- Ocupa toda la pantalla, imágenes con `object-fit: cover`.
- Autoplay configurable con barra de progreso.
- Navegación por flechas, puntos (dots), teclado (`←` / `→` / `Espacio`) y swipe táctil.
- Pausa automática al pasar el mouse o al ocultar la pestaña.
- Sincronización en vivo: consulta `/api/images` cada 10 s y al volver a la pestaña.
- Respeta `prefers-reduced-motion`.

**Panel de administración (`/admin`)**
- Acceso con contraseña (hash Argon2id).
- Alta, edición y borrado de imágenes.
- Reordenamiento por arrastrar y soltar.
- Vista previa del orden y contador de imágenes.

**Webhook para n8n (`/api/webhook`)**
- Reemplazo total del carrusel en una sola petición.
- Autenticación por firma **HMAC-SHA256** (sin exponer secretos en la URL).
- Validación de cada imagen y límite de 100 por petición.

---

## Arquitectura

```
┌─────────────┐   POST /api/webhook   ┌──────────────────┐
│    n8n      │──(HMAC-SHA256)──────▶ │                  │
└─────────────┘                       │   Upstash Redis  │
                                      │  carousel:images │
┌─────────────┐   CRUD /api/images    │                  │
│ admin.html  │──(cookie HttpOnly)──▶ │                  │
└─────────────┘                       └────────┬─────────┘
                                               │ GET /api/images
                                      ┌────────▼─────────┐
                                      │   index.html     │
                                      │   (carrusel)     │
                                      └──────────────────┘
```

- **Frontend**: HTML/CSS/JS vanilla, sin paso de build.
- **Backend**: Vercel Functions (Node.js runtime).
- **Datos**: una única clave Redis (`carousel:images`) con el array de imágenes.

---

## Estructura del proyecto

```
pagina_con_endpoints/
├── index.html            # Carrusel a pantalla completa
├── admin.html            # Panel de administración
├── carousel.js           # Lógica del carrusel
├── admin.js              # Lógica del panel
├── api.js                # Helper fetch compartido (cliente)
├── styles.css            # Estilos compartidos
├── vercel.json           # Configuración de Vercel
├── package.json          # Dependencias y scripts
├── .env.example          # Plantilla de variables de entorno
├── api/
│   ├── _utils.js         # Utilidades compartidas (JWT, HMAC, validación)
│   ├── _redis.js         # Cliente Redis REST (Upstash / Vercel KV)
│   ├── images.js         # CRUD de imágenes
│   ├── webhook.js        # Endpoint para n8n (HMAC)
│   └── auth.js           # Login / logout / sesión
├── scripts/
│   └── hash-password.js  # Generador de hash Argon2id
└── docs/
    ├── API.md            # Referencia de la API
    ├── N8N.md            # Guía de integración con n8n
    ├── DEPLOYMENT.md     # Guía de despliegue
    └── n8n-workflow.json # Workflow importable
```

---

## Inicio rápido (local, sin servicios externos)

Requiere solo **Node.js 18+**. No necesita Redis ni Vercel Blob: usa archivos en `.data/`.

```bash
npm install
npm run dev:local     # o: npm start
```

Abre:
- Carrusel: `http://localhost:3000/`
- Panel admin: `http://localhost:3000/admin` → contraseña **`10Cuidado.2026`**

Los datos (imágenes del carrusel e imágenes subidas) **persisten** en `.data/`.

Prueba automática de todos los endpoints:

```bash
npm test
```

---

## Docker

```bash
docker compose up --build
```

- Disponible en `http://localhost:8080`
- Contraseña admin: `10Cuidado.2026`
- Los datos persisten en `./.data` (volumen montado)

Detener:

```bash
docker compose down
```

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `KV_REST_API_URL` | Sí | URL REST de Upstash (inyectada por la integración de Vercel). |
| `KV_REST_API_TOKEN` | Sí | Token REST de Upstash (inyectado). |
| `UPSTASH_REDIS_REST_URL` | Alternativa | Se acepta este nombre si usas el prefijo `UPSTASH_`. |
| `UPSTASH_REDIS_REST_TOKEN` | Alternativa | Ídem. |
| `ADMIN_PASSWORD_HASH` | Sí | Hash Argon2id de la contraseña. Genera con `npm run hash:password`. |
| `JWT_SECRET` | Sí | Secreto para firmar sesiones (mín. 32 caracteres aleatorios). |
| `JWT_EXPIRY` | No | Caducidad de la sesión. Por defecto `1h`. |
| `WEBHOOK_SECRET` | Sí | Secreto compartido con n8n para la firma HMAC. |
| `LOCAL_STORAGE` | No | `1` usa archivos locales (`.data/`) en vez de Redis/Blob. Lo activa el servidor local y Docker. |
| `LOCAL_DATA_DIR` | No | Carpeta de datos en modo local. Por defecto `.data/`. |
| `ADMIN_PASSWORD` | No | Solo local/Docker: el servidor hashea esta contraseña al arrancar. |
| `BLOB_ACCESS` | No | `public` (por defecto) o `private` para Vercel Blob. |
| `BLOB_READ_WRITE_TOKEN` | Sí (para upload en Vercel) | Token de Vercel Blob. Lo inyecta Vercel al crear un Blob store. |
| `UPLOAD_ALLOWED_HOSTS` | No | Hosts permitidos como origen de imagen en `/api/upload`. Default `aliyuncs.com,cloudinary.com,pollinations.ai`. |
| `UPLOAD_MAX_BYTES` | No | Tamaño máximo de imagen en `/api/upload`. Default 15 MB. |
| `RATE_LIMIT_IMAGES` | No | Peticiones/min por IP en `/api/images`. Por defecto `60`. |
| `RATE_LIMIT_WEBHOOK` | No | Peticiones/min por IP en `/api/webhook`. Por defecto `10`. |
| `RATE_LIMIT_AUTH` | No | Intentos de login/min por IP. Por defecto `5`. |

---

## Despliegue en Vercel

Ver guía detallada en [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Resumen:

1. **Redis**: en el dashboard de Vercel → *Storage* → añade **Upstash Redis** (Marketplace). Esto inyecta `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
2. **Variables**: añade `ADMIN_PASSWORD_HASH`, `JWT_SECRET` y `WEBHOOK_SECRET` en *Settings → Environment Variables*.
3. **Deploy**:
   ```bash
   npm install -g vercel
   vercel        # preview
   vercel --prod # producción
   ```

---

## Referencia de la API

Resumen; detalle completo en [`docs/API.md`](docs/API.md).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/images` | Pública | Devuelve las imágenes ordenadas. |
| `POST` | `/api/images` | Admin | Añade una imagen. |
| `PATCH` | `/api/images` | Admin | Actualiza una imagen o reordena varias. |
| `DELETE` | `/api/images?id=...` | Admin | Elimina una imagen. |
| `POST` | `/api/webhook` | HMAC | Reemplaza todo el carrusel (n8n). |
| `POST` | `/api/upload` | HMAC | Re-hospeda una URL temporal en Vercel Blob (permanente). |
| `POST` | `/api/health` | HMAC | Diagnóstico: presencia de variables de entorno y modo de almacenamiento. |
| `POST` | `/api/auth` | Pública | Login con contraseña → cookie de sesión. |
| `GET` | `/api/auth` | Pública | Comprueba si hay sesión activa. |
| `DELETE` | `/api/auth` | Pública | Cierra sesión. |

Forma de una imagen:

```json
{
  "id": "uuid",
  "url": "https://res.cloudinary.com/.../foto.jpg",
  "alt": "Título que aparece sobre la imagen",
  "order": 0,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## Integración con n8n

Ver guía completa en [`docs/N8N.md`](docs/N8N.md).

**Resumen:** envía un `POST` a `/api/webhook` con el array completo de imágenes
y el header `X-Webhook-Secret` conteniendo el HMAC-SHA256 del cuerpo crudo.

```json
{
  "images": [
    { "url": "https://cdn.ejemplo.com/1.jpg", "alt": "Primera" },
    { "url": "https://cdn.ejemplo.com/2.jpg", "alt": "Segunda" }
  ]
}
```

En n8n, calcula la firma en un nodo **Code**:

```js
const crypto = require('crypto');
const body = JSON.stringify({ images: $json.images });
const signature = crypto
  .createHmac('sha256', $env.WEBHOOK_SECRET)
  .update(body, 'utf8')
  .digest('hex');

return [{ json: { body, signature } }];
```

Luego un nodo **HTTP Request**: `POST https://TU-APP.vercel.app/api/webhook`,
body `={{ $json.body }}` (tipo *raw / JSON*) y header
`X-Webhook-Secret: {{ $json.signature }}`.

---

## Seguridad

- **Contraseña de admin**: nunca se guarda en claro; se valida contra un hash **Argon2id**.
- **Sesión**: JWT firmado (HS256) en cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Webhook**: firma **HMAC-SHA256** comparada en tiempo constante (`timingSafeEqual`).
- **Rate limiting**: por IP en login, CRUD y webhook.
- **Cabeceras**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.
- **Secretos**: solo en variables de entorno; `.env` está en `.gitignore`.

> Nunca subas `.env`, `node_modules/` ni la carpeta `.vercel/` al repositorio.

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| El carrusel dice "Aún no hay imágenes" | Redis vacío o mal configurado | Añade una imagen desde `/admin` o revisa las variables `KV_REST_API_*`. |
| Login responde 500 | `ADMIN_PASSWORD_HASH` o `JWT_SECRET` ausentes | Defínelos en `.env` / Vercel. |
| Webhook responde 401 | Firma incorrecta | Firma el **cuerpo crudo exacto** con `WEBHOOK_SECRET`. |
| Webhook responde 429 | Rate limit excedido | Ajusta `RATE_LIMIT_WEBHOOK` o espacia las peticiones. |
| Los cambios de n8n no aparecen | Caché del navegador | El carrusel hace polling cada 10 s; refresca la pestaña. |

---

## Licencia

Privado. Todos los derechos reservados.

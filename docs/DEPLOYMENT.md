# Guía de despliegue en Vercel

Esta guía cubre el despliegue completo: base de datos Redis, variables de
entorno, deploy y verificación.

---

## 1. Prerrequisitos

- Cuenta en [Vercel](https://vercel.com).
- Repositorio en GitHub (recomendado) o la CLI de Vercel instalada:
  ```bash
  npm install -g vercel
  ```

---

## 2. Crear la base de datos Redis (Upstash)

El proyecto **no** usa Vercel KV (obsoleto). Usa **Upstash Redis** a través del
Marketplace de Vercel.

1. Entra en tu proyecto de Vercel → pestaña **Storage**.
2. **Create Database** → **Upstash** → **Redis**.
3. Elige región cercana a tus usuarios y plan gratuito.
4. Conéctala al proyecto. Vercel inyecta automáticamente:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

> El cliente `api/_redis.js` acepta también los nombres
> `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, por lo que funciona con
> cualquiera de las dos convenciones.

---

## 3. Generar secretos

### Hash de la contraseña de admin

```bash
npm install
npm run hash:password
# Introduce una contraseña de al menos 12 caracteres.
# Copia el valor ADMIN_PASSWORD_HASH que imprime.
```

### JWT_SECRET y WEBHOOK_SECRET

Genera dos cadenas aleatorias de al menos 32 caracteres.

```bash
# Linux / macOS
openssl rand -base64 32

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

---

## 4. Configurar variables en Vercel

**Project → Settings → Environment Variables**. Añade para
*Production*, *Preview* y *Development*:

| Variable | Valor |
|---|---|
| `ADMIN_PASSWORD_HASH` | El hash Argon2id generado. |
| `JWT_SECRET` | La cadena aleatoria. |
| `WEBHOOK_SECRET` | Otra cadena aleatoria (la misma en n8n). |
| `JWT_EXPIRY` | Opcional, por defecto `1h`. |
| `RATE_LIMIT_WEBHOOK` | Opcional, por defecto `10`. |

`KV_REST_API_URL` y `KV_REST_API_TOKEN` ya las inyecta la integración de Upstash.

---

## 5. Desplegar

### Opción A — CLI

```bash
vercel          # despliegue de preview (prueba)
vercel --prod   # despliegue de producción
```

### Opción B — GitHub

1. Sube el repositorio a GitHub.
2. En Vercel: **Add New → Project → Import Git Repository**.
3. Framework Preset: **Other**. No hay build command.
4. Añade las variables de entorno y pulsa **Deploy**.

---

## 6. Verificación post-deploy

1. **Público** — abre `https://TU-APP.vercel.app`; debe cargar el carrusel
   (vacío si aún no hay imágenes).
2. **API pública**:
   ```bash
   curl https://TU-APP.vercel.app/api/images
   # → {"images":[]}
   ```
3. **Login**:
   ```bash
   curl -i -X POST https://TU-APP.vercel.app/api/auth \
     -H "Content-Type: application/json" \
     -d '{"password":"tu-contraseña"}'
   # → 200 + Set-Cookie: auth_token=...; HttpOnly; Secure; SameSite=Strict
   ```
4. **Panel**: entra en `https://TU-APP.vercel.app/admin`, inicia sesión y añade
   una imagen.
5. **Webhook**: prueba desde [`N8N.md`](N8N.md#8-probar-la-firma-en-local)
   cambiando `localhost:3000` por tu dominio.

---

## 7. Dominio personalizado (opcional)

**Project → Settings → Domains** → añade tu dominio y configura los registros
DNS que indique Vercel.

---

## 8. Actualizaciones

Cada `git push` a la rama de producción (o `vercel --prod`) genera un nuevo
deployment. Los datos en Redis se conservan entre despliegues.

---

## 9. Rollback

En **Deployments**, selecciona un deployment anterior → **⋯ → Promote to
Production**. No afecta a los datos de Redis.

---

## 10. Checklist final

- [ ] Base Upstash conectada (`KV_REST_API_*` presentes).
- [ ] `ADMIN_PASSWORD_HASH` definido.
- [ ] `JWT_SECRET` definido.
- [ ] `WEBHOOK_SECRET` definido e idéntico en n8n.
- [ ] `GET /api/images` responde `{"images":[]}`.
- [ ] Login en `/admin` correcto.
- [ ] Prueba de webhook con firma válida → `success: true`.
- [ ] `.env` y `node_modules` **fuera** del repositorio.

# Registro propio, recuperación de contraseña y WhatsApp desde el panel

Qué hace cada pieza y qué hay que configurar fuera del código para encenderla en producción.
Mientras falten las variables, el panel no muestra "Crear cuenta" ni "¿Olvidaste tu contraseña?"
y la sección de WhatsApp aparece como "todavía no disponible".

## Cómo funciona

**Crear cuenta.** En el login, pestaña Usuario → *Crear cuenta*: nombre, correo, contraseña
(mínimo 10) y el captcha de Cloudflare. Llega un correo con un enlace que vale 24 horas y se usa
una vez. Al abrirlo se crea la cuenta y la persona entra directo a su panel. Antes de confirmar
el correo no existe ninguna cuenta.

**Olvidé mi contraseña.** Pestaña Usuario → *¿Olvidaste tu contraseña?*. El enlace vale 30
minutos y se usa una vez. Al poner la clave nueva se cierran todas las sesiones abiertas.

Las dos pantallas responden siempre lo mismo, exista o no el correo. Si alguien intenta
registrarse con un correo que ya tiene cuenta, al dueño le llega un aviso con un enlace de
recuperación.

**Límites.** Hasta 10 correos por hora desde la misma IP (`ACCOUNT_HOURLY_LIMIT`) y uno cada
2 minutos al mismo correo (`MAIL_COOLDOWN_SECONDS`). `SIGNUP_ENABLED=0` cierra el registro sin
apagar la recuperación.

**WhatsApp.** En *Configuración*, cada cliente escribe su número (10 dígitos). El servidor crea un
token nuevo y lo manda, junto con el número, al flujo de n8n "Alta de número", que escribe la
fila en `whatsapp_numeros`. El token nunca se muestra en el navegador. Si n8n no responde, no se
cambia nada. Un número solo puede estar en una cuenta. El super-admin ve el número en la lista y
puede desvincularlo desde los ajustes del usuario.

**Tope mensual.** Cada cuenta puede generar hasta N imágenes al mes: el tope general se cambia en
el panel del super-admin y cada usuario puede tener uno propio. `settings-read` le entrega a n8n
`quota: { used, limit, remaining }`. Cuando `remaining` es 0, el flujo debe contestar que se
llegó al límite y no generar.

## Pasos de configuración

### 1. Resend (correo)
1. Crear cuenta en https://resend.com.
2. *Domains → Add domain*: `etziel.com` (o un subdominio como `mail.etziel.com`).
3. Copiar en Cloudflare DNS los registros que da Resend (DKIM `TXT`, y `MX` + `TXT` SPF del
   subdominio de envío). Cloudflare: "DNS only" (nube gris) en esos registros.
4. Esperar a que el dominio diga *Verified*.
5. *API Keys → Create*, con permiso solo de envío.
6. En `.env.prod`: `RESEND_API_KEY=re_…` y `MAIL_FROM="Carrusel <no-reply@etziel.com>"`.

Plan gratuito: unos 3,000 correos al mes y 100 al día.

### 2. Cloudflare Turnstile (captcha)
1. Cloudflare → *Turnstile → Add widget*. Hostname `carrusel.etziel.com`, modo *Managed*.
2. En `.env.prod`: `TURNSTILE_SITE_KEY=0x…` y `TURNSTILE_SECRET_KEY=0x…`.

### 3. n8n: flujo "Alta de número"
Webhook `POST` con *Header Auth* (header `X-Carrusel-Key`, valor = `N8N_NUMBERS_SECRET`). Cuerpo:

```json
{ "action": "upsert", "numero": "8112345678", "numeroAnterior": null, "carrusel": "USER5", "token": "crt_…" }
{ "action": "delete", "numero": "8112345678", "carrusel": "USER5" }
```

- `upsert`: si `numeroAnterior` viene, borrar esa fila; luego *upsert* en `whatsapp_numeros`
  por `numero` con `carrusel`, `token`, `activo = true` y `workflow_id` = el del flujo
  `DIRECTOR_DE_ARTE_WHATSAPP`.
  **Antes**, si ya hay una fila con ese `numero` y otro `carrusel`, responder **409** y no tocar
  nada: así nadie se queda con el número de un cliente dado de alta a mano.
- `delete`: borrar la fila de `numero` solo si su `carrusel` coincide.
- Responder 200 al terminar. Cualquier otra respuesta hace que el panel diga que no se pudo y no
  guarde nada.

En `.env.prod`: `N8N_NUMBERS_WEBHOOK_URL` (URL de producción del webhook) y `N8N_NUMBERS_SECRET`
(`openssl rand -hex 32`, el mismo valor que la credencial *Header Auth* de n8n). También hace
falta `TOKEN_ENC_KEY`.

Los clientes que hoy están en la tabla puestos a mano (USER1, USER2) no aparecen como vinculados
en el panel. Para pasarlos al sistema nuevo, el super-admin abre sus ajustes y vincula el mismo
número: el flujo lo acepta porque el `carrusel` coincide, y la fila queda con un token nuevo.

### 4. Tope en el flujo de WhatsApp
Después del nodo que llama a `settings-read`, agregar un *IF*:
`{{ $json.data.quota.remaining === 0 }}`. Por la rama verdadera, contestar
"Llegaste al límite de {{ $json.data.quota.limit }} imágenes de este mes" y terminar.

### 5. Otras variables
- `APP_URL=https://carrusel.etziel.com` (ya está en `deploy/docker-compose.prod.yml`).
- `N8N_ALLOWED_HOSTS`: host del n8n al que apunta el webhook de generación del panel, si se usa.

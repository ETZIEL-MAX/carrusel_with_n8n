# Despliegue a producción

Producción corre en el EC2 `13.59.86.154` (Docker + nginx + Redis; ver `CLAUDE.md`).

- **Fase 1:** subir lo nuevo a `carrusel.etziel.com`, sin cambiar de dominio.
- **Fase 2:** cambiar a `eninternet.tv`, más adelante.

Revisado el 2026-10-18 desde fuera. Producción ya tiene el registro propio con correo (Resend) y no
tiene captcha. Le falta todo lo posterior al commit `15ea801`:

- código QR;
- planes y prueba de 7 días;
- límite de pantallas y botón para liberarlas;
- Crear con IA (borradores);
- conteo de mensajes de WhatsApp;
- Términos y Aviso de privacidad.

## Fase 1 · Lo nuevo en carrusel.etziel.com

### Antes
1. **Páginas legales (`terminos.html`, `privacidad.html`).**
   - Llenar lo marcado en amarillo: razón social, domicilio, teléfono, correos de contacto y de privacidad, y país de JEV.
   - Que las revise un abogado.
   - El registro pide aceptarlas: no publicar con los espacios en amarillo.
2. **Precios.** Los Términos dicen que los precios **incluyen IVA**. Poner los precios reales con IVA en
   la tabla Planes del super-admin, justo después del deploy.
3. **Cuentas actuales.** Las que ya existen no tienen plan: siguen sin límites y nunca se bloquean.
   Para cobrarles, asignarles un plan desde el super-admin. Las cuentas nuevas empiezan con 7 días gratis.

### El día del deploy
1. **Código.** Revisar `git status` (otras sesiones editan el repo), hacer commit, unir a `main` y hacer push.
   Antes, correr `npm test`, `npm run test:n8n` y `npm run test:ui`.
2. **Respaldo** de `~/carrusel/data` y de Redis en `~/carrusel/backups/<fecha>/`.
3. **`.env.prod` a mano** (no correr `deploy/make-env.sh`: regenera los secretos). Revisar que existan:
   - `N8N_ALLOWED_HOSTS=n8ndokployupdates.etziel.com`
   - `N8N_WEB_GENERATION_URL=https://n8ndokployupdates.etziel.com/webhook/generar-web-carrusel`, para Crear con IA.
   - `N8N_NUMBERS_WEBHOOK_URL` y `N8N_NUMBERS_SECRET`, para vincular WhatsApp. Probablemente ya están.
4. **Imagen** (procedimiento de siempre, ver la memoria `prod-deploy-ec2`):
   1. En local: `docker build --platform linux/amd64 -t carrusel:prod .`
   2. `docker save | gzip`, y luego `scp` a `/tmp` del servidor.
   3. En el servidor: `sudo docker tag carrusel:prod carrusel:prev` (para poder volver atrás).
   4. `docker load`.
   5. `sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d carrusel`.
5. **nginx no cambia** en esta fase.
6. **n8n.**
   - El flujo de WhatsApp ya tiene lo nuevo (cupo del mes y conteo de mensajes): no se toca. Empieza a funcionar
     solo cuando el servidor devuelve `quota` y acepta `kind: 'message'`.
   - **Publicar `GENERAR_DESDE_WEB`.**
   - Hacer que n8n borre las ejecuciones de más de 30 días, como promete el Aviso de privacidad
     (`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=720`).
7. **Verificar.**
   - `bash check.sh` en el servidor y `npm run test:prod` en local.
   - Abrir `/terminos` y `/privacidad`.
   - Crear una cuenta de prueba: debe pedir aceptar los términos y quedar con 7 días gratis.
   - Mandar un mensaje por WhatsApp.
   - Generar una imagen desde Crear con IA (cuenta como una imagen del mes).
   - Comprobar que `https://plasticosvirgo.com` sigue bien.
8. **Pantallas.** Con el deploy, las TVs abiertas se recargan solas y empiezan a mandar su id. Las cuentas
   sin plan no tienen límite, así que ninguna TV se bloquea.

## Fase 2 · Cambio a eninternet.tv (más adelante)

Ya está preparado:

- `deploy/nginx-eninternet.conf`: el dominio nuevo.
- `deploy/nginx-carrusel-transicion.conf`: el dominio viejo atiende solo `/api/` y `/uploads/` y redirige
  lo demás, para que n8n y las TVs no se caigan.
- `deploy/install-nginx-eninternet.sh`: instala los dos y revierte si algo falla.

El orden importa: eninternet.tv tiene que responder **antes** de instalar ese nginx.

1. **DNS.** Hoy `eninternet.tv` apunta a `34.206.64.157`, otro servidor que no responde.
   - Agregar el dominio a Cloudflare.
   - Registros `A` de `@` y `www` → `13.59.86.154`.
   - Dejarlos en nube gris mientras se saca el certificado; después, nube naranja.
2. **Correo y captcha.**
   - Verificar `eninternet.tv` en Resend y cambiar a `MAIL_FROM="Carrusel <no-reply@eninternet.tv>"`.
   - Turnstile, si se usa: agregar el hostname.
   - Buzones de contacto y privacidad, si cambian de dominio: actualizarlos en las páginas legales.
3. **Certificado.**
   - Instalar `deploy/nginx-eninternet-http.conf` como `/etc/nginx/conf.d/zz-eninternet.conf` y recargar nginx.
   - Correr `sudo certbot certonly --webroot -w /var/www/letsencrypt -d eninternet.tv -d www.eninternet.tv`.
4. **App.**
   - En `deploy/docker-compose.prod.yml`, poner `APP_URL: "https://eninternet.tv"`.
   - En `.env.prod`, agregar `eninternet.tv` a `UPLOAD_ALLOWED_HOSTS`.
   - Volver a levantar el contenedor.
5. **nginx.** Copiar `deploy/nginx-*.conf`, `nginx-proxy.inc` e `install-nginx-eninternet.sh` y correr
   `bash install-nginx-eninternet.sh`.
6. **n8n** (justo después):

   ```bash
   CARRUSEL_URL=https://eninternet.tv node scripts/n8n-patch-flujo.mjs n8n/.work/copia.live.json n8n/.work/copia.patched.json
   CARRUSEL_URL=https://eninternet.tv node scripts/n8n-flujo-web.mjs n8n/.work/copia.patched.json n8n/.work/web.json n8n/.work/web.sdk.js
   ```

   - Subir los dos flujos: en el de WhatsApp cambian las URLs de 8 nodos; en el web, `Traer settings`.
   - Cambiar también el flujo de Telegram (USER1). Mientras tanto sigue funcionando por el dominio viejo.
7. **Código y pruebas.** Cambiar el dominio por defecto en el código:
   - `APP_BASE` en `scripts/n8n-patch-flujo.mjs`;
   - `n8n/respuestas.js`;
   - `playwright.config.js`;
   - `docs/`.

   Correr `npm run test:prod` con `PROD_URL=https://eninternet.tv`.
8. **Pantallas.** Las TVs pasan solas al dominio nuevo al recargarse, y ahí cuentan como pantalla nueva.
9. **Dominio viejo.** Cuando ningún flujo ni TV use `carrusel.etziel.com` (revisar los logs de nginx), retirarlo.

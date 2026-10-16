# AGENTS.md

Guidance for AI agents and contributors working on this repository.

## Project summary

A full-screen image carousel that can be managed from an admin panel or synced
from **n8n** via a signed webhook. Deployed on **Vercel** (static assets +
serverless functions) with **Upstash Redis** for storage.

There is **no build step**. The frontend is plain HTML/CSS/JS served as static
files; the backend is Vercel Functions written as ES modules.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs runtime + dev dependencies. |
| `npm start` / `npm run dev:local` | Runs the standalone local server (`scripts/server.mjs`) with file storage — no Redis/Blob needed. |
| `npm test` | End-to-end test of every endpoint against the local server. |
| `docker compose up --build` | Runs the whole app in Docker on `http://localhost:8080`. |
| `npm run dev` | Alias of the local server. |
| `npm run deploy` | `vercel --prod`. |
| `npm run hash:password` | Interactive prompt → prints `ADMIN_PASSWORD_HASH`. |
| `node --check <file>` | Syntax check an individual file. |

There is no test runner configured. When adding tests, prefer a standalone
`.mjs` script that imports the handlers directly and stubs `globalThis.fetch`
for Redis (see git history for a full integration harness pattern).

## Architecture

- **Frontend**
  - `index.html` + `carousel.js` — public gallery. Polls `/api/images` every
    10s and on `visibilitychange`; rerenders only when the data signature changes.
  - `admin.html` + `admin.js` — login + CRUD + drag-and-drop reordering.
  - `api.js` — thin `fetch` wrapper shared by both pages (`window.API`).
  - `styles.css` — all styling. Editorial/cinematic dark theme.
- **Backend** (`api/`, Vercel Functions, ESM)
  - `_store.js` — storage abstraction: Upstash/Vercel Blob on Vercel, local
    files under `.data/` when `LOCAL_STORAGE=1` (Docker / local server).
  - `_redis.js` — minimal Redis REST client (Upstash-compatible, prefix-agnostic). No SDK.
  - `_utils.js` — JWT, HMAC verification, validation, rate limiting, image ops,
    response helpers.
  - `images.js` — public `GET`; admin-only `POST`/`PATCH`/`DELETE`.
  - `_webhook-shared.js` — shared logic for the per-carousel endpoints.
  - `webhook/[userId].js` — per-carousel n8n webhook, HMAC-authenticated;
    `mode: "append"` (default, dedupes URLs) or `mode: "replace"`.
  - `upload/[userId].js` — HMAC-authenticated; downloads a temporary image URL
    and re-hosts it (Vercel Blob, or `.data/uploads` locally). Hosts are
    restricted by `UPLOAD_ALLOWED_HOSTS` to avoid SSRF (skipped when local).
  - `manage/[userId].js` — HMAC-authenticated; lets n8n list, delete or change the
    duration of an image by its position in the carousel (chat commands).
  - `webhook.js` / `upload.js` — retired global endpoints; respond `410 Gone`.
  - `health.js` — HMAC-protected diagnostics (env var presence, storage mode).
  - `auth.js` — login/logout/session check. `DELETE ?all=1` closes every session.
  - `users.js` — super-admin CRUD; `POST /api/users/token` issues the per-client
    webhook token (returned once); `PATCH` accepts `storageLimitMb`.
  - `images-upload.js` — cookie; raw-body image upload from the panel (no multipart).
    Streamed: `handleImageUpload(request, stream)` writes to a temp file,
    then `saveImageFromTemp` (sharp, from disk) → quota → carousel.
  - `_stream.js` — `writeCapped` (stream → temp file with size cap), upload slots,
    stale `.tmp-*` sweep. Shared by the panel image upload and n8n URL downloads.
  - `usage.js` — `GET` storage + monthly generation usage (cookie); `PATCH` global
    config (super-admin). `usage/[userId].js` — HMAC; n8n reports generation events.

Stored images are converted to WebP (q90) and capped at 3840 px on the long side (`MAX_IMAGE_SIDE` in `_store.js`),
so a 4K poster keeps its size. Above 1920 px `webpProfile` uses a light encoder profile: a 4K photo with the
normal one peaks near 217 MB and two at once OOM-kill the 256 MB container. The poster size a client asks n8n for is `defaultOrientation` + `posterResolution`
(`posterSize` in `_utils.js`; `hd`/`fullhd`/`2k`/`4k` = short side 720/1080/1440/2160).

Data lives under a single key: `carousel:images` (a JSON array). In local mode
it is `.data/kv/carousel_images.json`; images are served from `/uploads/*`.

**Per-client webhook token.** Each user may have its own token (`crt_…`), stored
encrypted (AES-256-GCM, `TOKEN_ENC_KEY`) and shown only when generated. With a
token the signature is `HMAC(token, "<timestamp>.<rawBody>")` plus the
`X-Webhook-Timestamp` header (5 min window, no replays). Users without a token
still accept the legacy global signature unless `ALLOW_GLOBAL_WEBHOOK_SECRET=0`.
All n8n endpoints go through `authorizeClient` in `_webhook-shared.js`.

**Storage quota.** Hosted files are named `USERx-<ts>-<uuid>.<ext>` and recorded
in the hash `carousel:USERx:files` (name → bytes). Always store through
`saveUserFile` and delete through `removeUserFile` (`_utils.js`): they enforce the
quota (`413 QUOTA_EXCEEDED`) and file ownership. `scripts/migrate-storage.mjs`
registers files uploaded before the quota existed.

**Usage.** Monthly counters live in the hash `carousel:USERx:usage:YYYY-MM`
(UTC). Estimated cost = images without provider tokens × `imagePriceUsd`
(`carousel:config`, default 0.06).

**Monthly image cap.** `getGenerationQuota` compares `images` of the current month with the
user's own `monthlyImageLimit` or, if unset, `carousel:config.monthlyImageLimit`
(`null` = no cap; unset = `MONTHLY_IMAGE_LIMIT` or 50). `settings-read` returns it as `quota`
so n8n can stop before generating; `POST /api/generate` answers 429 when `remaining` is 0.

**Self-service accounts** (`api/account.js`). `register` stores the pending account (with the
argon2 hash) in the temp key `carousel:signup:<sha256(token)>` for 24 h and mails
`APP_URL/admin.html#verificar=<token>`; nothing is written to `carousel:users` until `verify`,
which creates the user (`createdBy: 'self'`) and opens a session. `forgot` stores
`carousel:reset:<sha256(token)>` = `USERn:<fingerprint of the current hash>` for 30 min; `reset`
takes it once (`tempTake`, GETDEL) and refuses it if the password changed meanwhile.
`register` and `forgot` always answer the same, whether the address exists or not. Mail goes
through Resend (`_mail.js`; without `RESEND_API_KEY` outside production it is written to
`LOCAL_DATA_DIR/mail/`), the captcha is Cloudflare Turnstile (`_turnstile.js`; skipped outside
production when unset, fails closed in production). Links are built from `APP_URL`, never from
the Host header.

**Writes to `carousel:users`** go through `withUsersLock` (a `setOnce` lock): the users live in
one JSON document and concurrent sign-ups would otherwise overwrite each other. The lock is not
reentrant. `USERn` numbers come from `carousel:userSeq` and are never reused, because a deleted
`USERn` may still be on screens and in n8n rows.

**WhatsApp link** (`api/whatsapp.js`). A user saves their number (last 10 digits, the same
key the n8n flow uses). The server makes a new client token, sends it with the number to the
n8n flow "Alta de número" (`N8N_NUMBERS_WEBHOOK_URL`, header `X-Carrusel-Key`), and saves both
only if n8n answered 2xx. Regenerating the token of a linked user and deleting a user also
update n8n. A number belongs to one account at most.

**Visibility.** Each image may carry `suspended` (hidden, not deleted), `schedule`
(`{ days: [0-6], from, to }`, weekdays and/or an inclusive date range) and `blur` (fill the
letterbox with a blurred copy; default off = black). `isVisibleAt` in `_utils.js` is the single
rule; `GET /api/carrusel` filters with it in `CAROUSEL_TIMEZONE` (default `America/Monterrey`),
while the panel's `GET /api/images` returns everything plus `visibleNow`.

**Whose carousel.** Cookie handlers get the target carousel from `resolveUserId`:
a user's comes from the session and a different `?userId` is a 403; the super-admin
must pass `?userId`.

**Sessions.** The JWT carries `sid` and `sv`. Logout revokes the `sid`; a password
change (or "close all sessions") bumps the version. Use `requireSession` in
handlers; do not call `verifyToken` directly for auth.

Each image may carry its own `duration` (seconds, 2–3600; `null` = carousel default).
The per-carousel default is the `slideDuration` user setting (8 s when unset) and is
returned by `GET /api/carrusel` next to `images`.

## Conventions

- **ESM everywhere**: `package.json` has `"type": "module"`. Use `import`/`export`.
- **No framework, no bundler**: keep the frontend dependency-free unless there is
  a strong reason. Do not introduce React/Vite/etc. for small changes.
- **UI language is Spanish** (labels, messages, comments in docs). Code
  identifiers and `AGENTS.md` are English.
- **Handlers** export `GET`/`POST`/`PATCH`/`DELETE`/`OPTIONS` and receive the
  standard `Request`, returning a `Response`. Use the helpers in `_utils.js`
  (`jsonResponse`, `errorResponse`, `successResponse`).
- **Validate before persisting.** URL must be `http(s)`. Use
  `validateImageData` for creates and `validateImagePatch` for partial updates.
- **Never add a background `setInterval`/`setTimeout` loop** at module scope in
  `api/` — it keeps serverless instances alive. Rate-limit cleanup is done
  opportunistically.
- Keep secrets out of the client. Only publishable values may reach the browser.

## Security invariants — do not break these

1. The admin session cookie MUST remain `HttpOnly`, `Secure`, `SameSite=Strict`.
2. `ADMIN_PASSWORD_HASH` is verified with Argon2id (`@node-rs/argon2`); never
   compare plaintext passwords.
3. `/api/webhook/USERx` MUST verify the HMAC-SHA256 signature of the **raw body**
   using `timingSafeEqual`. Never trust an unsigned payload.
4. Mutating `/api/images` routes MUST verify the JWT cookie and `role === 'admin'`.
5. Do not log or return secrets. Do not commit `.env`.
6. A client webhook token is returned exactly once (when generated) and stored only
   encrypted. Never add an endpoint that reads it back. When a WhatsApp number is linked
   the token goes once to the n8n numbers webhook instead, never to the browser.
7. Any `userId` coming from a request MUST pass `normalizeUserId` before it is used
   in a storage key.
8. A file may only be deleted by the user whose file ledger contains it.
9. `POST /api/generate` only calls hosts in `N8N_ALLOWED_HOSTS`, and only the super-admin
   may set `n8nGenerationWebhook`: the server makes that request.

## Known gotchas

- **Do not reintroduce `@vercel/kv`.** Vercel KV is sunset; `_redis.js` targets the
  Upstash REST API and accepts both `KV_REST_API_*` and `UPSTASH_REDIS_REST_*`.
- **`argon2` (native) is intentionally not used.** `@node-rs/argon2` ships
  prebuilt binaries and builds reliably on Vercel.
- **Git root warning**: this project originally lived under a home directory that
  had an unrelated `.git`. This project is its own repository; run git commands
  from the project root.
- `GET /api/images` sends a short `Cache-Control`; the carousel fetches with
  `cache: 'no-store'` to bypass it.

## File map (quick reference)

```
api/_store.js   storage abstraction (Redis/Blob vs local files)
api/_utils.js   JWT, HMAC, validation, rate limit, image CRUD, responses
api/_redis.js   getJson / setJson against Upstash REST
api/_webhook-shared.js  per-user webhook/upload logic
api/images.js   GET (public) | POST/PATCH/DELETE (admin)
api/webhook/[userId].js  POST (HMAC) — append (default) or replace
api/upload/[userId].js   POST (HMAC) — re-host a temporary image URL (Blob or disk)
api/manage/[userId].js   POST (HMAC) — list / delete / set duration by position
api/webhook.js / api/upload.js  retired globals — 410 Gone
api/health.js   POST (HMAC) — diagnostics
api/auth.js     POST login | GET me | DELETE logout (?all=1 = every session)
api/users.js    super-admin CRUD | POST /api/users/token (token shown once)
api/images-upload.js  POST (cookie) — streamed image upload (raw body, → WebP)
api/_stream.js  writeCapped, upload slots, stale temp sweep
api/usage.js    GET storage + usage (cookie) | PATCH config (super-admin)
api/usage/[userId].js    POST (HMAC) — n8n reports generation usage
api/account.js  POST register | verify | forgot | reset (public, captcha + rate limits)
api/_mail.js    sendMail (Resend or local outbox) + Spanish templates
api/_turnstile.js  Cloudflare Turnstile check
api/whatsapp.js GET | POST | DELETE (cookie) — link the client's WhatsApp number
api/_n8n-numbers.js  pushNumber → n8n flow "Alta de número"
api/qr.js       GET (cookie) — { url, dataUrl }: QR PNG of the public carousel (APP_URL), for the settings panel
scripts/migrate-storage.mjs  register pre-quota files (never deletes)
scripts/server.mjs  standalone local/Docker server
scripts/test-e2e.mjs  end-to-end test (npm test)
n8n/firma.js, consumo.js, formato.js, prompt.js, comandos.js, respuestas.js  source of the n8n Code-node snippets (signing, usage report, poster size and logo zone, prompt messages, chat command parser and replies); no import/export
n8n/espera.js  5-second debounce: text messages sent in a row are stored in the n8n table whatsapp_espera and answered once, 5 s after the last one, with all their text joined
scripts/n8n-patch-flujo.mjs  patches an exported n8n workflow JSON with those snippets
n8n/clasificador.js  JEV (HTTP call to jevmodel.org/v1/systemone): default questions + parser of its answer (spam / poster with or without logo / command); the API key lives only in n8n
n8n/prompt.js  default texts of the "Instrucciones del director" node + armarMensajes
scripts/n8n-lienzo.mjs  canvas layout: 12 sections with sticky notes; refuses to reorder sibling branches
docs/N8N-FLUJO.md  step-by-step guide to the WhatsApp workflow (Spanish)
scripts/test-n8n.mjs  tests for the above (npm run test:n8n); n8n/.work/ holds exports (git-ignored, may contain secrets)
```

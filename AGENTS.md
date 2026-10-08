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
   encrypted. Never add an endpoint that reads it back.
7. Any `userId` coming from a request MUST pass `normalizeUserId` before it is used
   in a storage key.
8. A file may only be deleted by the user whose file ledger contains it.

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
scripts/migrate-storage.mjs  register pre-quota files (never deletes)
scripts/server.mjs  standalone local/Docker server
scripts/test-e2e.mjs  end-to-end test (npm test)
n8n/firma.js, n8n/consumo.js  source of the n8n Code-node snippets (signing, usage report); no import/export
scripts/n8n-patch-flujo.mjs  patches an exported n8n workflow JSON with those snippets
scripts/test-n8n.mjs  tests for the above (npm run test:n8n); n8n/.work/ holds exports (git-ignored, may contain secrets)
```

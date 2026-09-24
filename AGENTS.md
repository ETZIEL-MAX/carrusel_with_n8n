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
| `npm run dev` | Runs `vercel dev` (local full stack, requires Redis env vars). |
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
  - `_redis.js` — minimal Redis REST client (Upstash-compatible). No SDK.
  - `_utils.js` — JWT, HMAC verification, validation, rate limiting, image ops,
    response helpers.
  - `images.js` — public `GET`; admin-only `POST`/`PATCH`/`DELETE`.
  - `webhook.js` — n8n endpoint, HMAC-authenticated, full replace.
  - `upload.js` — HMAC-authenticated; downloads a temporary image URL and
    re-hosts it permanently in **Vercel Blob** (`@vercel/blob`). Hosts are
    restricted by `UPLOAD_ALLOWED_HOSTS` to avoid SSRF.
  - `auth.js` — login/logout/session check.

Data lives under a single Redis key: `carousel:images` (a JSON array).

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
3. `/api/webhook` MUST verify the HMAC-SHA256 signature of the **raw body**
   using `timingSafeEqual`. Never trust an unsigned payload.
4. Mutating `/api/images` routes MUST verify the JWT cookie and `role === 'admin'`.
5. Do not log or return secrets. Do not commit `.env`.

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
api/_utils.js   JWT, HMAC, validation, rate limit, image CRUD, responses
api/_redis.js   getJson / setJson against Upstash REST
api/images.js   GET (public) | POST/PATCH/DELETE (admin)
api/webhook.js  POST (HMAC) — full replace
api/upload.js   POST (HMAC) — re-host a temporary image URL in Vercel Blob
api/auth.js     POST login | GET me | DELETE logout
```

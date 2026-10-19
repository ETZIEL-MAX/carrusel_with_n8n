# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) is the main reference: architecture, conventions, security
invariants and file map. The sections below only add what it lacks or correct what has
drifted. When they disagree, trust this file and the code.

## Tests

`AGENTS.md` says no test runner is configured; that is out of date. There are three suites:

| Command | What it runs |
|---|---|
| `npm test` | `scripts/test-e2e.mjs`: spawns the local server on port 3123 with a temp data dir and checks every endpoint. One script, no filter. |
| `npm run test:n8n` | `scripts/test-n8n.mjs`: tests the `n8n/*.js` snippets and the workflow patcher. No server needed. |
| `npm run test:ui` | Playwright specs in `tests/`. Starts `tests/serve.mjs` on port 3210 with a clean temp data dir each run. |
| `npm run test:prod` | Playwright with `PROD=1`: only `tests/prod.readonly.spec.js`, against `PROD_URL` (default `https://carrusel.etziel.com`). Read-only, no login. |

Running part of the Playwright suite:

```bash
npx playwright test tests/admin.spec.js              # one file
npx playwright test -g "part of the test name"       # by title
npx playwright test --project=tv-horizontal          # one project
```

Playwright projects: `tv-horizontal` (1920×1080, every spec except prod), `tv-vertical`
and `movil` (only `carousel.spec.js`). It runs with one worker because all specs share
one server and its state. `tests/helpers.js` has the signing helpers, the test password
and `freshIp()`; rate limits are per IP, so requests in tests send a distinct
`X-Forwarded-For`.

There is no linter. `node --check <file>` is the only syntax check.

## Where it actually runs

`AGENTS.md` and `README.md` describe a Vercel deployment. Production
(`carrusel.etziel.com`; it will move to `eninternet.tv`, see `docs/DESPLIEGUE.md`) is instead `scripts/server.mjs` in Docker on an EC2 host behind
nginx and Cloudflare, with a Redis container (`deploy/docker-compose.prod.yml`). The
image is built locally and loaded on the server with `docker load`. `docs/DEPLOYMENT.md`
covers only Vercel.

What follows from that:

- **`scripts/server.mjs` is the production router, not only a dev tool.** Routes are
  registered by hand in `API_ROUTES`, static files are limited to the `PUBLIC_FILES`
  allowlist, and the CSP is set there. A new handler in `api/` or a new frontend file is
  unreachable until it is added there. `vercel.json` rewrites and headers must be
  mirrored by hand.
- **Three storage modes**, chosen in `api/_store.js` and `api/_redis.js`:
  - `LOCAL_STORAGE=1`: everything in files under `LOCAL_DATA_DIR` (dev, tests).
  - `LOCAL_STORAGE=0` + `REDIS_URL` + `IMAGE_STORAGE=local`: data in Redis through
    `ioredis`, image files on disk. This is Docker and production.
  - Neither set: Upstash REST + Vercel Blob.

  So `_redis.js` is not REST-only, and `ioredis` is a real dependency.
- **Memory is tight**: the production container is capped at 256 MB with
  `--max-old-space-size=128`. Uploads are streamed to temp files for this reason; do not
  buffer image bodies in memory.
- With `NODE_ENV=production` the server refuses to start on missing or short secrets and
  seeds no demo data. Without it, it creates `USER1` (`user1@local.test`) and sample
  images, using the dev password from `README.md`.

## Asset versioning and the service worker

`server.mjs` rewrites `admin.js`, `carousel.js`, `api.js` and `styles.css` references in
the HTML to `?v=<content hash>` and serves those as immutable; HTML and `sw.js` are
`no-cache`. `__BUILD__` in `index.html` and `sw.js` is replaced by a build id derived
from those files. The public carousel compares it with the server's and reloads itself,
and the new service worker drops old caches. Keep the plain `src="/x.js"` form in the
HTML and the `__BUILD__` placeholder intact; do not hand-write version strings.

`sw.js` serves the public carousel (TV screens): `/uploads/*` cache-first, and the page
and `/api/carrusel` network-first with a cache fallback so a screen keeps playing offline.

## Data keys

Storage is per carousel, not the single `carousel:images` key that `AGENTS.md` and
`README.md` mention: `carousel:users`, `carousel:USERx:images`, `carousel:USERx:files`,
`carousel:USERx:devices`, `carousel:USERx:devices:revoked`, `carousel:USERx:drafts`,
`carousel:USERx:usage:YYYY-MM`, `carousel:config`.

## Handlers missing from the AGENTS.md map

- `api/carrusel.js`: public `GET ?userId=`; what the carousel page actually polls.
- `api/settings.js`: cookie; per-carousel generation settings.
- `api/settings-read/[userId].js`: HMAC; lets n8n read those settings without a login.
- `api/generate.js`: cookie; triggers a generation from the panel.

## Other

- `OBS_MANAGER/` is a separate project (own `package.json`, own `README.md`): a Node bot
  that switches OBS scenes from Telegram and WhatsApp, shipped as a Windows installer. It
  shares nothing with the carousel app; run its `npm` commands from inside that folder.
- `graphify-out/` (knowledge graph output) and `n8n/.work/` (workflow exports, may hold
  secrets) are generated; do not edit or commit them.

# Graph Report - pagina_con_endpoints  (2026-10-08)

## Corpus Check
- 70 files · ~84,954 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 4, .conf 2, .example 1)

## Summary
- 649 nodes · 1725 edges · 26 communities (19 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.88)
- Token cost: 136,062 input · 0 output

## Community Hubs (Navigation)
- Storage, Users and Quota
- Auth, Images and Generation API
- Admin Panel and Project Rules
- Redis REST Client
- Admin Panel Frontend
- Health and Retired Endpoints
- n8n Signed Client Endpoints
- Package Dependencies
- Playwright UI Tests
- Public Carousel Player
- Usage Tracking and n8n Token Plan
- End-to-End API Test
- n8n Snippet Tests
- Service Worker Cache
- WebP Migration and Test Server
- n8n Workflow Patcher
- Video Validation (H.264)
- Vercel Config
- Storage Migration Script
- Password Hash Script
- Deploy Check Script
- Nginx Install Script
- Production Test Runner
- Browser API Wrapper
- Env File Generator

## God Nodes (most connected - your core abstractions)
1. `errorResponse()` - 46 edges
2. `successResponse()` - 36 edges
3. `getUsers()` - 28 edges
4. `getClientIp()` - 26 edges
5. `checkRateLimit()` - 25 edges
6. `requireSession()` - 22 edges
7. `handleUpload()` - 22 edges
8. `resolveUserId()` - 21 edges
9. `handleImageUpload()` - 21 edges
10. `handleVideoUpload()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `POST /api/usage/USERx (n8n reports generation events)` --references--> `handleUsageReport()`  [INFERRED]
  docs/API.md → api/_webhook-shared.js
- `Usage reporting from n8n (Firmar consumo -> Reportar consumo)` --references--> `armarConsumo()`  [INFERRED]
  docs/N8N.md → n8n/consumo.js
- `Own token per client (new signature by crt_ prefix)` --references--> `patchWorkflow()`  [INFERRED]
  docs/N8N.md → scripts/n8n-patch-flujo.mjs
- `Task 1: n8n/firma.js signature by token` --references--> `loadSnippet()`  [EXTRACTED]
  docs/superpowers/plans/2026-10-08-n8n-token-y-consumo.md → scripts/test-n8n.mjs
- `Security invariants (do not break)` --references--> `normalizeUserId()`  [EXTRACTED]
  AGENTS.md → api/_utils.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **HMAC-signed n8n endpoints sharing one signing scheme** — docs_api_firma_peticiones_n8n, docs_api_post_api_webhook_userx, docs_api_post_api_upload_userx, docs_api_post_api_manage_userx, docs_api_usage_userx [EXTRACTED 1.00]
- **Per-client token rollout across server, panel and n8n flow** — agents_per_client_webhook_token, docs_api_users_token, admin_settings_modal, docs_n8n_token_propio_por_cliente, docs_n8n_whatsapp_numeros, docs_superpowers_plans_2026_10_08_n8n_token_y_consumo_task_3_patch_flujo [INFERRED 0.85]
- **Storage quota across server ledger, API errors, panel meter and bot handling** — agents_storage_quota, docs_api_limite_de_espacio, admin_plan_panel, docs_n8n_espacio_lleno [INFERRED 0.85]

## Communities (26 total, 7 thin omitted)

### Community 0 - "Storage, Users and Quota"
Cohesion: 0.06
Nodes (90): RATE_LIMIT, deleteImageFile(), ownFileName(), putImage(), putImageFromFile(), DELETE(), GET(), PATCH() (+82 more)

### Community 1 - "Auth, Images and Generation API"
Cohesion: 0.07
Nodes (76): DELETE(), GET(), POST(), RATE_LIMIT, GET(), GENERATE_TIMEOUT_MS, POST(), RATE_LIMIT (+68 more)

### Community 2 - "Admin Panel and Project Rules"
Cohesion: 0.05
Nodes (66): admin.html: admin panel page, Add / edit image modal (orientation, duration), Login view (Super-Admin / Usuario tabs), Plan panel (storage meter + generation usage), Approximate cost per image form, User settings modal (account, storage limit, n8n token, webhook docs, generation), Super-admin dashboard (accounts grid), Password / token shown-once modal (+58 more)

### Community 3 - "Redis REST Client"
Cohesion: 0.08
Nodes (47): command(), delKey(), exists(), expire(), getIoredis(), getJson(), hDel(), hGetAll() (+39 more)

### Community 4 - "Admin Panel Frontend"
Cohesion: 0.08
Nodes (38): activeUserId(), announceNews(), baseName(), canvasToBlob(), checkAuth(), closeSettingsModal(), copyText(), escapeHtml() (+30 more)

### Community 5 - "Health and Retired Endpoints"
Cohesion: 0.08
Nodes (30): POST(), isConfigured(), POST(), jsonResponse(), verifyWebhookSignature(), POST(), API_ROUTES, applySecurityHeaders() (+22 more)

### Community 6 - "n8n Signed Client Endpoints"
Cohesion: 0.09
Nodes (24): POST(), POST(), isLocal(), POST(), POST(), clientSignatureHasher(), MAX_DURATION, MIN_DURATION (+16 more)

### Community 7 - "Package Dependencies"
Cohesion: 0.06
Nodes (30): dependencies, ioredis, jose, @node-rs/argon2, sharp, @vercel/blob, description, devDependencies (+22 more)

### Community 8 - "Playwright UI Tests"
Cohesion: 0.17
Nodes (16): @playwright/test, IMAGES, apiLogin(), freshIp(), PASSWORD, poster(), SECRET, setCarousel() (+8 more)

### Community 9 - "Public Carousel Player"
Cohesion: 0.16
Nodes (26): applyFit(), applyFitAll(), applyList(), build(), currentMs(), escapeHtml(), inWindow(), loadImage() (+18 more)

### Community 10 - "Usage Tracking and n8n Token Plan"
Cohesion: 0.16
Nodes (20): normalizeTokens(), recordUsage(), toCount(), usageKey(), COPIA_SEGURIDAD_DIRECTOR_ARTE workflow (inactive copy), DIRECTOR_DE_ARTE_WHATSAPP workflow (production, all clients), RECEPCIONISTA_WHATSAPP workflow, Own token per client (new signature by crt_ prefix) (+12 more)

### Community 11 - "End-to-End API Test"
Cohesion: 0.21
Nodes (9): check(), child, J(), PNG, request(), ROOT, runTests(), sign() (+1 more)

### Community 12 - "n8n Snippet Tests"
Cohesion: 0.15
Nodes (9): { armarConsumo }, c, exportPath, f, { hmacSha256Hex, firmar }, loadSnippet(), ROOT, wan (+1 more)

### Community 13 - "Service Worker Cache"
Cohesion: 0.29
Nodes (8): cachedSize(), cacheFirst(), fromStoredVideo(), storeVideo(), storing, trim(), videoBudget(), videoResponse()

### Community 14 - "WebP Migration and Test Server"
Cohesion: 0.22
Nodes (5): BACKUP, DRY, ids, UPLOADS, DATA

### Community 15 - "n8n Workflow Patcher"
Cohesion: 0.29
Nodes (9): addNode(), HTTP_NODES, link(), patchSignCode(), patchWorkflow(), replaceOnce(), ROOT, SIGN_NODES (+1 more)

### Community 16 - "Video Validation (H.264)"
Cohesion: 0.39
Nodes (7): fail(), H264, inspectVideo(), isRotated(), OTHER_VIDEO, readAvcEntry(), readDuration()

### Community 17 - "Vercel Config"
Cohesion: 0.25
Nodes (7): maxDuration, functions, api/**/*.js, headers, regions, rewrites, version

### Community 18 - "Storage Migration Script"
Cohesion: 0.29
Nodes (4): DRY, owners, ROOT, uploadsDir

## Knowledge Gaps
- **116 isolated node(s):** `API`, `localTemp`, `localLocks`, `optimizeQueue`, `MAX_CONCURRENT` (+111 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 170 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `isVideoItem()` connect `Admin Panel Frontend` to `Storage, Users and Quota`, `Auth, Images and Generation API`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `API`, `localTemp`, `localLocks` to the rest of the system?**
  _116 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Storage, Users and Quota` be split into smaller, more focused modules?**
  _Cohesion score 0.056578947368421055 - nodes in this community are weakly interconnected._
- **Why does `Plan: n8n token per row and usage report` connect `Usage Tracking and n8n Token Plan` to `Admin Panel and Project Rules`, `n8n Signed Client Endpoints`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `Auth, Images and Generation API` be split into smaller, more focused modules?**
  _Cohesion score 0.06909174102036147 - nodes in this community are weakly interconnected._
- **Should `Admin Panel and Project Rules` be split into smaller, more focused modules?**
  _Cohesion score 0.0528169014084507 - nodes in this community are weakly interconnected._
- **Should `Redis REST Client` be split into smaller, more focused modules?**
  _Cohesion score 0.0792156862745098 - nodes in this community are weakly interconnected._
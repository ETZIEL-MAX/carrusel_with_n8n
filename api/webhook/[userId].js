import { handleWebhook, parseUserIdFromPath, CORS_OPTIONS } from '../_webhook-shared.js';

// POST /api/webhook/USER1 — webhook propio de cada carrusel.
// Body firmado (HMAC): { "images": [...], "mode": "append"|"replace" }
export async function POST(request) {
  return handleWebhook(request, parseUserIdFromPath(request));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_OPTIONS });
}

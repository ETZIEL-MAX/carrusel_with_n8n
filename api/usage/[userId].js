import { handleUsageReport, parseUserIdFromPath, CORS_OPTIONS } from '../_webhook-shared.js';

// POST /api/usage/USER1 — n8n reporta lo que generó para este carrusel.
// Body firmado (HMAC): { "eventId": "...", "kind": "image", "tokens": {...} }
export async function POST(request) {
  return handleUsageReport(request, parseUserIdFromPath(request));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_OPTIONS });
}

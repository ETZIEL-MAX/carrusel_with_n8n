import { handleUpload, parseUserIdFromPath, CORS_OPTIONS } from '../_webhook-shared.js';

// POST /api/upload/USER1 — re-hospeda una imagen temporal en el carrusel del usuario.
// Body firmado (HMAC): { "url": "<URL temporal>", "alt": "..." }
export async function POST(request) {
  return handleUpload(request, parseUserIdFromPath(request));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_OPTIONS });
}

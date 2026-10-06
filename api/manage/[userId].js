import { handleManage, parseUserIdFromPath, CORS_OPTIONS } from '../_webhook-shared.js';

// POST /api/manage/USER1 — administra el carrusel desde n8n (chat) sin login:
// listar, borrar o cambiar la duración de una imagen. Firmado por HMAC.
// Body firmado (HMAC): { "action": "list" | "delete" | "duration", "index": 3, "duration": 20 }
export async function POST(request) {
  return handleManage(request, parseUserIdFromPath(request));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_OPTIONS });
}

import { handleSettingsRead, parseUserIdFromPath, CORS_OPTIONS } from '../_webhook-shared.js';

// POST /api/settings-read/USER1 — devuelve la config de generación (carpeta de
// Drive + paleta) firmada por HMAC, para que n8n la lea sin login.
// Body firmado (HMAC): "{}" (o vacío).
export async function POST(request) {
  return handleSettingsRead(request, parseUserIdFromPath(request));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_OPTIONS });
}

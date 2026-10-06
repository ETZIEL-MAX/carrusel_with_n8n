import { jsonResponse } from './_utils.js';

// Endpoint global retirado. Ahora cada carrusel tiene su propio webhook.
// Usa POST /api/webhook/USER1 (con el userId del carrusel al final).
export async function POST() {
  return jsonResponse(
    { error: 'Endpoint retirado. Usa /api/webhook/USERx (por ejemplo /api/webhook/USER1).' },
    410
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
      'Access-Control-Max-Age': '86400',
    },
  });
}

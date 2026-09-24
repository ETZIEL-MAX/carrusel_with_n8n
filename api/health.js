import { verifyWebhookSignature, jsonResponse, errorResponse } from './_utils.js';
import { isConfigured as redisConfigured } from './_redis.js';

// POST /api/health — diagnóstico protegido por HMAC (mismo WEBHOOK_SECRET).
// Devuelve booleanos y los NOMBRES de las variables relevantes (nunca sus valores).
export async function POST(request) {
  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  const relevantEnvNames = Object.keys(process.env)
    .filter((k) => /REDIS|KV|BLOB|JWT|ADMIN|WEBHOOK|UPLOAD/i.test(k))
    .sort();

  return jsonResponse({
    ok: true,
    node: process.version,
    redisConfigured: redisConfigured(),
    blobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    blobAccess: (process.env.BLOB_ACCESS || 'public').toLowerCase(),
    jwtSecret: Boolean(process.env.JWT_SECRET),
    webhookSecret: Boolean(process.env.WEBHOOK_SECRET),
    adminHash: Boolean(process.env.ADMIN_PASSWORD_HASH),
    uploadAllowedHosts: process.env.UPLOAD_ALLOWED_HOSTS || '(default)',
    relevantEnvNames,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
      'Access-Control-Max-Age': '86400',
    },
  });
}

import { randomUUID } from 'crypto';
import { putImage, isLocal } from './_store.js';
import {
  verifyWebhookSignature,
  validateImageUrl,
  checkRateLimit,
  successResponse,
  errorResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_WEBHOOK || '10', 10);
const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(15 * 1024 * 1024), 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.UPLOAD_FETCH_TIMEOUT || '20000', 10);

const ALLOWED_HOSTS = (process.env.UPLOAD_ALLOWED_HOSTS || 'aliyuncs.com,cloudinary.com,pollinations.ai')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isHostAllowed(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return ALLOWED_HOSTS.some((suffix) => host === suffix || host.endsWith('.' + suffix));
  } catch {
    return false;
  }
}

function extensionFor(contentType) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

// POST /api/upload
// Body (firmado con HMAC igual que el webhook): { "url": "<URL temporal de la imagen>", "alt": "..." }
// Descarga la imagen y la re-hospeda en Vercel Blob de forma permanente.
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`upload:${clientIp}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { url, alt = '' } = body || {};
  if (!url || typeof url !== 'string' || !validateImageUrl(url)) {
    return errorResponse('A valid image `url` is required (http/https)', 400);
  }

  if (!isLocal() && !isHostAllowed(url)) {
    return errorResponse(
      `Host no permitido. Configura UPLOAD_ALLOWED_HOSTS. Host recibido: ${(() => {
        try { return new URL(url).hostname; } catch { return 'invalido'; }
      })()}`,
      400
    );
  }

  if (!isLocal() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let phase = 'download';

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      return errorResponse(`No se pudo descargar la imagen (${res.status})`, 502);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return errorResponse('La URL no devuelve una imagen', 400);
    }

    const declaredLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (declaredLength && declaredLength > MAX_BYTES) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }

    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${extensionFor(contentType)}`;

    phase = 'upload';
    const stored = await putImage(fileName, buffer, contentType.split(';')[0].trim(), request);

    return successResponse(
      { url: stored.url, pathname: stored.pathname, contentType: stored.contentType, alt },
      'Image re-hosted permanently'
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      return errorResponse('Tiempo de descarga agotado', 504);
    }
    console.error(`POST /api/upload error (${phase}):`, err);
    if (phase === 'upload') {
      const detail = [err?.name, err?.message, err?.cause?.message].filter(Boolean).join(' | ');
      return errorResponse(`Error al guardar la imagen: ${detail || 'error'}`, 500);
    }
    return errorResponse(`No se pudo descargar la imagen: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
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

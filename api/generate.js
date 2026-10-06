import {
  verifyToken,
  getTokenFromCookie,
  checkRateLimit,
  isSuperAdmin,
  isUser,
  getTargetUserId,
  getGenerationSettings,
  errorResponse,
  successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_GENERATE || '5', 10);
const GENERATE_TIMEOUT_MS = parseInt(process.env.GENERATE_TIMEOUT_MS || '30000', 10);

async function requireAuth(request) {
  const token = getTokenFromCookie(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const payload = await verifyToken(token);
  if (!payload || (!isSuperAdmin(payload) && !isUser(payload))) return errorResponse('Forbidden', 403);
  return { payload };
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userId = getTargetUserId(request, auth.payload);
  if (!userId) return errorResponse('userId required for super-admin', 400);

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`generate:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });

  const settings = await getGenerationSettings(userId);
  if (!settings) return errorResponse('User not found', 404);
  if (!settings.n8nGenerationWebhook) {
    return errorResponse('No n8n generation webhook configured. Save one in Configuración first.', 400);
  }

  const origin = request.headers.get('origin') || '';
  const host = request.headers.get('host') || '';
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  const baseUrl = origin.startsWith('http') ? origin : `${proto}://${host}`;
  const carouselWebhookUrl = `${baseUrl}/api/webhook/${userId}`;

  const n8nPayload = {
    userId,
    googleDriveFolder: settings.googleDriveFolder,
    colorPalette: settings.colorPalette,
    carouselWebhookUrl,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  try {
    const res = await fetch(settings.n8nGenerationWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`POST /api/generate: n8n webhook returned ${res.status}:`, text);
      return errorResponse(`n8n webhook returned ${res.status}`, 502);
    }

    return successResponse({ userId, carouselWebhookUrl }, 'Generation triggered');
  } catch (err) {
    if (err.name === 'AbortError') return errorResponse('n8n webhook timed out', 504);
    console.error('POST /api/generate fetch error:', err);
    return errorResponse('Failed to call n8n webhook', 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

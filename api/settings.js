import {
  verifyToken,
  getTokenFromCookie,
  checkRateLimit,
  isSuperAdmin,
  isUser,
  getTargetUserId,
  getGenerationSettings,
  updateUserSettings,
  errorResponse,
  successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10);

async function requireAuth(request) {
  const token = getTokenFromCookie(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const payload = await verifyToken(token);
  if (!payload || (!isSuperAdmin(payload) && !isUser(payload))) return errorResponse('Forbidden', 403);
  return { payload };
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userId = getTargetUserId(request, auth.payload);
  if (!userId) return errorResponse('userId required for super-admin', 400);

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`settings:get:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });

  try {
    const settings = await getGenerationSettings(userId);
    if (!settings) return errorResponse('User not found', 404);
    return successResponse(settings, 'Settings retrieved');
  } catch (err) {
    console.error('GET /api/settings error:', err);
    return errorResponse('Failed to fetch settings', 500);
  }
}

export async function PATCH(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userId = getTargetUserId(request, auth.payload);
  if (!userId) return errorResponse('userId required for super-admin', 400);

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`settings:patch:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { googleDriveFolder, colorPalette, n8nGenerationWebhook } = body || {};

  if (googleDriveFolder === undefined && colorPalette === undefined && n8nGenerationWebhook === undefined) {
    return errorResponse('Nothing to update', 400);
  }

  try {
    const updated = await updateUserSettings(userId, { googleDriveFolder, colorPalette, n8nGenerationWebhook });
    if (!updated) return errorResponse('User not found', 404);
    return successResponse(updated, 'Settings updated');
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return errorResponse(err.message, 400, err.details);
    console.error('PATCH /api/settings error:', err);
    return errorResponse('Failed to update settings', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

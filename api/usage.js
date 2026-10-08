import {
  requireSession, checkRateLimit, getClientIp, resolveUserId, isSuperAdmin,
  getUsers, getStorageUsage, getUsageSummary, currentMonth, isValidMonth,
  getConfig, updateConfig, imagePriceFrom,
  errorResponse, successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10);
const MAX_IMAGE_PRICE_USD = 100;

// GET /api/usage[?userId=USER2][&month=2026-10]
// Espacio usado y consumo de generación del mes. Un usuario ve lo suyo; el
// super-admin pasa ?userId. Sin userId, el super-admin recibe la configuración global.
export async function GET(request) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;

  const rl = checkRateLimit(`usage:get:${getClientIp(request)}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || currentMonth();
  if (!isValidMonth(month)) return errorResponse('month debe tener el formato AAAA-MM', 400);

  try {
    if (isSuperAdmin(auth.payload) && !url.searchParams.get('userId')) {
      return successResponse({ imagePriceUsd: imagePriceFrom(await getConfig()) }, 'Config');
    }
    const userId = resolveUserId(request, auth.payload);
    if (userId instanceof Response) return userId;

    const users = await getUsers();
    if (!users[userId]) return errorResponse('User not found', 404);

    const storage = await getStorageUsage(userId, users);
    const usage = await getUsageSummary(userId, month);
    return successResponse({ userId, storage, usage }, 'Usage');
  } catch (err) {
    console.error('GET /api/usage error:', err);
    return errorResponse('Failed to fetch usage', 500);
  }
}

// PATCH /api/usage - Configuración global (solo super-admin).
// Body: { "imagePriceUsd": 0.06 } -> precio aproximado por imagen sin tokens reportados.
export async function PATCH(request) {
  const auth = await requireSession(request, { superAdmin: true });
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { imagePriceUsd } = body || {};
  if (typeof imagePriceUsd !== 'number' || !Number.isFinite(imagePriceUsd) || imagePriceUsd < 0 || imagePriceUsd > MAX_IMAGE_PRICE_USD) {
    return errorResponse(`imagePriceUsd debe ser un número entre 0 y ${MAX_IMAGE_PRICE_USD}`, 400);
  }

  try {
    const cfg = await updateConfig({ imagePriceUsd });
    return successResponse({ imagePriceUsd: imagePriceFrom(cfg) }, 'Config updated');
  } catch (err) {
    console.error('PATCH /api/usage error:', err);
    return errorResponse('Failed to update config', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

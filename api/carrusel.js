import {
  getImages, isVisibleAt, getGenerationSettings, DEFAULT_SLIDE_DURATION, errorResponse, successResponse,
  checkRateLimit, getClientIp, normalizeUserId, getUsers, getPlanState, isValidDeviceId, touchDevice,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_IMAGES || '60', 10);

// GET /api/carrusel?userId=USER1[&device=<uuid>] - Public carousel endpoint (no auth)
// 402 si la prueba o el plan venció. Con `device`, la pantalla cuenta contra el límite
// del plan; si ya no cabe responde { deviceBlocked: true } sin imágenes.
export async function GET(request) {
  const url = new URL(request.url);
  const userId = normalizeUserId(url.searchParams.get('userId'));
  
  if (!userId) {
    return errorResponse('Invalid userId', 400);
  }
  
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`carrusel:get:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  try {
    const users = await getUsers();
    const plan = await getPlanState(userId, users);
    if (plan.blocked) {
      return errorResponse('Este carrusel está suspendido', 402, { code: 'PLAN_EXPIRED' });
    }

    // Sin `device` (pantallas con la versión anterior en caché) se deja pasar: se
    // recargan solas con la versión nueva y desde ahí ya lo mandan.
    const device = url.searchParams.get('device');
    if (device && isValidDeviceId(device) && users[userId]) {
      const seat = await touchDevice(userId, device, plan.devices);
      if (seat.revoked) {
        return successResponse({ images: [], deviceRevoked: true }, 'Device disconnected');
      }
      if (!seat.allowed) {
        return successResponse({ images: [], deviceBlocked: true, limit: seat.limit }, 'Device limit reached');
      }
    }

    // Solo lo que toca mostrar ahora: ni suspendidas ni fuera de su programación.
    const images = (await getImages(userId)).filter((img) => isVisibleAt(img));
    const settings = await getGenerationSettings(userId);
    const slideDuration = settings?.slideDuration ?? DEFAULT_SLIDE_DURATION;
    return successResponse({ images, slideDuration }, 'Images retrieved');
  } catch (err) {
    console.error('GET /api/carrusel error:', err);
    return errorResponse('Failed to fetch images', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

import { getImages, jsonResponse, errorResponse, successResponse, checkRateLimit } from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_IMAGES || '60', 10);

// GET /api/carrusel?userId=USER1 - Public carousel endpoint (no auth)
export async function GET(request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  
  if (!userId || !userId.startsWith('USER')) {
    return errorResponse('Invalid userId', 400);
  }
  
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`carrusel:get:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  try {
    const images = await getImages(userId.toUpperCase());
    return successResponse({ images }, 'Images retrieved');
  } catch (err) {
    console.error('GET /api/carrusel error:', err);
    return errorResponse('Failed to fetch images', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
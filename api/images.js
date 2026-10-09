import { 
  getImages, addImage, updateImage, deleteImage, reorderImages, isVisibleAt,
  validateImageData, validateImagePatch,
  requireSession, checkRateLimit, getClientIp, resolveUserId,
  errorResponse, successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_IMAGES || '60', 10);

const requireAuth = (request) => requireSession(request);

const getUserIdFromRequest = resolveUserId;

// GET /api/images - Admin scoped by userId (query param for super-admin, session for user)
export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  
  const userId = await getUserIdFromRequest(request, auth.payload);
  if (userId instanceof Response) return userId;
  
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`images:get:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  try {
    // `visibleNow`: si hoy sale en el carrusel (ni suspendida ni fuera de su programación).
    const now = new Date();
    const images = (await getImages(userId)).map((img) => ({ ...img, visibleNow: isVisibleAt(img, now) }));
    return successResponse({ images }, 'Images retrieved');
  } catch (err) {
    console.error('GET /api/images error:', err);
    return errorResponse('Failed to fetch images', 500);
  }
}

// POST /api/images - Admin only (scoped by userId)
export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  
  const userId = await getUserIdFromRequest(request, auth.payload);
  if (userId instanceof Response) return userId;
  
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`images:post:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  try {
    const body = await request.json();
    const errors = validateImageData(body);
    if (errors.length > 0) {
      return errorResponse('Validation failed', 400, errors);
    }
    
    const image = await addImage(userId, body);
    return successResponse(image, 'Image added successfully');
  } catch (err) {
    console.error('POST /api/images error:', err);
    if (err instanceof SyntaxError) {
      return errorResponse('Invalid JSON', 400);
    }
    return errorResponse('Failed to add image', 500);
  }
}

// PATCH /api/images - Admin only (update or reorder, scoped by userId)
export async function PATCH(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  
  const userId = await getUserIdFromRequest(request, auth.payload);
  if (userId instanceof Response) return userId;
  
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`images:patch:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  try {
    const body = await request.json();
    
    // Check if it's a reorder request
    if (Array.isArray(body) && body.every(item => item.id && typeof item.order === 'number')) {
      const images = await reorderImages(userId, body);
      return successResponse(images, 'Images reordered successfully');
    }
    
    // Single image update
    const { id, ...updates } = body;
    if (!id) {
      return errorResponse('Image ID required', 400);
    }
    
    const errors = validateImagePatch(updates);
    if (errors.length > 0) {
      return errorResponse('Validation failed', 400, errors);
    }
    
    const image = await updateImage(userId, id, updates);
    if (!image) {
      return errorResponse('Image not found', 404);
    }
    
    return successResponse(image, 'Image updated successfully');
  } catch (err) {
    console.error('PATCH /api/images error:', err);
    if (err instanceof SyntaxError) {
      return errorResponse('Invalid JSON', 400);
    }
    return errorResponse('Failed to update image', 500);
  }
}

// DELETE /api/images?id=:id - Admin only (scoped by userId)
export async function DELETE(request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  
  const userId = await getUserIdFromRequest(request, auth.payload);
  if (userId instanceof Response) return userId;
  
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`images:delete:${clientIp}:${userId}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) {
    return errorResponse('Image ID required', 400);
  }
  
  try {
    const deleted = await deleteImage(userId, id);
    if (!deleted) {
      return errorResponse('Image not found', 404);
    }
    
    return successResponse(null, 'Image deleted successfully');
  } catch (err) {
    console.error('DELETE /api/images error:', err);
    return errorResponse('Failed to delete image', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
import { 
  getImages, addImage, updateImage, deleteImage, reorderImages,
  validateImageData, validateImagePatch,
  verifyToken, getTokenFromCookie, checkRateLimit,
  jsonResponse, errorResponse, successResponse
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_IMAGES || '60', 10);

// GET /api/images - Public endpoint, no auth required
export async function GET(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`images:get:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  try {
    const images = await getImages();
    return jsonResponse({ images }, 200, {
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    });
  } catch (err) {
    console.error('GET /api/images error:', err);
    return errorResponse('Failed to fetch images', 500);
  }
}

// POST /api/images - Admin only
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`images:post:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  // Verify admin auth
  const token = getTokenFromCookie(request);
  if (!token) {
    return errorResponse('Unauthorized', 401);
  }
  
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return errorResponse('Forbidden', 403);
  }
  
  try {
    const body = await request.json();
    const errors = validateImageData(body);
    if (errors.length > 0) {
      return errorResponse('Validation failed', 400, errors);
    }
    
    const image = await addImage(body);
    return successResponse(image, 'Image added successfully');
  } catch (err) {
    console.error('POST /api/images error:', err);
    if (err instanceof SyntaxError) {
      return errorResponse('Invalid JSON', 400);
    }
    return errorResponse('Failed to add image', 500);
  }
}

// PATCH /api/images - Admin only (update or reorder)
export async function PATCH(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`images:patch:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  const token = getTokenFromCookie(request);
  if (!token) {
    return errorResponse('Unauthorized', 401);
  }
  
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return errorResponse('Forbidden', 403);
  }
  
  try {
    const body = await request.json();
    
    // Check if it's a reorder request
    if (Array.isArray(body) && body.every(item => item.id && typeof item.order === 'number')) {
      const images = await reorderImages(body);
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
    
    const image = await updateImage(id, updates);
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

// DELETE /api/images?id=:id - Admin only
export async function DELETE(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`images:delete:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }
  
  const token = getTokenFromCookie(request);
  if (!token) {
    return errorResponse('Unauthorized', 401);
  }
  
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return errorResponse('Forbidden', 403);
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) {
    return errorResponse('Image ID required', 400);
  }
  
  try {
    const deleted = await deleteImage(id);
    if (!deleted) {
      return errorResponse('Image not found', 404);
    }
    
    return successResponse(null, 'Image deleted successfully');
  } catch (err) {
    console.error('DELETE /api/images error:', err);
    return errorResponse('Failed to delete image', 500);
  }
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
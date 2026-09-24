import { 
  replaceAllImages, validateImageData, validateImageUrl,
  verifyWebhookSignature, checkRateLimit,
  jsonResponse, errorResponse, successResponse
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_WEBHOOK || '10', 10);

// POST /api/webhook - n8n endpoint with HMAC verification
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`webhook:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  // Verify HMAC signature
  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }
  
  // Get raw body for signature verification
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
  
  // Validate payload
  if (!body.images || !Array.isArray(body.images)) {
    return errorResponse('Expected { images: [...] }', 400);
  }
  
  if (body.images.length === 0) {
    return errorResponse('Images array cannot be empty', 400);
  }
  
  if (body.images.length > 100) {
    return errorResponse('Maximum 100 images per request', 400);
  }
  
  // Validate each image
  const validationErrors = [];
  body.images.forEach((img, index) => {
    const errors = validateImageData(img);
    if (errors.length > 0) {
      validationErrors.push({ index, errors });
    }
  });
  
  if (validationErrors.length > 0) {
    return errorResponse('Validation failed', 400, validationErrors);
  }
  
  try {
    const images = await replaceAllImages(body.images);
    return successResponse(
      { count: images.length, images },
      `Successfully replaced ${images.length} images`
    );
  } catch (err) {
    console.error('POST /api/webhook error:', err);
    return errorResponse('Failed to process webhook', 500);
  }
}

// OPTIONS for CORS
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
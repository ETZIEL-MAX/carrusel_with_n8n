import { 
  createToken, verifyToken, getTokenFromCookie, 
  setAuthCookie, clearAuthCookie, checkRateLimit,
  jsonResponse, errorResponse, successResponse
} from './_utils.js';
import { verify } from '@node-rs/argon2';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!PASSWORD_HASH) {
  console.warn('WARNING: ADMIN_PASSWORD_HASH not set. Auth will fail.');
}

// POST /api/auth/login
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`auth:login:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Too many login attempts', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  if (!PASSWORD_HASH) {
    return errorResponse('Server misconfigured', 500);
  }
  
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  
  const { password } = body;
  if (!password || typeof password !== 'string') {
    return errorResponse('Password required', 400);
  }
  
  try {
    const valid = await verify(PASSWORD_HASH, password);
    if (!valid) {
      // Add delay to prevent timing attacks
      await new Promise(r => setTimeout(r, 500));
      return errorResponse('Invalid credentials', 401);
    }
    
    const token = await createToken({ role: 'admin' }, process.env.JWT_EXPIRY || '1h');
    
    const response = successResponse({ authenticated: true }, 'Login successful');
    setAuthCookie(response, token);
    
    return response;
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return errorResponse('Login failed', 500);
  }
}

// POST /api/auth/logout
export async function DELETE(request) {
  const response = successResponse(null, 'Logged out');
  clearAuthCookie(response);
  return response;
}

// GET /api/auth/me - Check current auth status
export async function GET(request) {
  const token = getTokenFromCookie(request);
  if (!token) {
    return jsonResponse({ authenticated: false });
  }
  
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return jsonResponse({ authenticated: false });
  }
  
  return jsonResponse({ authenticated: true, role: payload.role });
}

// OPTIONS for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
import {
  createToken, verifyToken, getTokenFromCookie,
  setAuthCookie, clearAuthCookie, checkRateLimit,
  jsonResponse, errorResponse, successResponse,
  verifyUserLogin, getUsers, isSuperAdmin, isUser
} from './_utils.js';
import { verify } from '@node-rs/argon2';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!ADMIN_PASSWORD_HASH) {
  console.warn('WARNING: ADMIN_PASSWORD_HASH not set. Auth will fail.');
}

// POST /api/auth/login - supports super-admin (password only) or user (email + password)
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`auth:login:${clientIp}`, RATE_LIMIT);
  
  if (!rateLimit.allowed) {
    return errorResponse('Too many login attempts', 429, { 
      resetAt: rateLimit.resetAt 
    });
  }
  
  if (!ADMIN_PASSWORD_HASH) {
    return errorResponse('Server misconfigured', 500);
  }
  
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  
  const { password, email } = body;
  if (!password || typeof password !== 'string') {
    return errorResponse('Password required', 400);
  }

  try {
    // Super-admin login: only password provided (no email)
    if (!email) {
      const valid = await verify(ADMIN_PASSWORD_HASH, password);
      if (!valid) {
        await new Promise(r => setTimeout(r, 500));
        return errorResponse('Invalid credentials', 401);
      }

      const token = await createToken({ role: 'super-admin' }, process.env.JWT_EXPIRY || '1h');

      const response = successResponse({ authenticated: true, role: 'super-admin' }, 'Login successful');
      setAuthCookie(response, token);

      return response;
    }

    // User login: email + password
    if (typeof email !== 'string') {
      return errorResponse('Email required', 400);
    }
    const user = await verifyUserLogin(email, password);
    if (!user) {
      await new Promise(r => setTimeout(r, 500));
      return errorResponse('Invalid credentials', 401);
    }

    const token = await createToken({ role: 'user', userId: user.userId }, process.env.JWT_EXPIRY || '1h');

    const response = successResponse(
      { authenticated: true, role: 'user', userId: user.userId, name: user.name, email: user.email },
      'Login successful'
    );
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
  if (!payload || (!payload.role || (payload.role !== 'super-admin' && payload.role !== 'user'))) {
    return jsonResponse({ authenticated: false });
  }

  if (payload.role === 'user' && payload.userId) {
    try {
      const users = await getUsers();
      const data = users[payload.userId];
      if (data) {
        return jsonResponse({
          authenticated: true, role: 'user', userId: payload.userId,
          name: data.name, email: data.email,
        });
      }
    } catch { /* fall through */ }
  }

  return jsonResponse({ authenticated: true, role: payload.role, userId: payload.userId });
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
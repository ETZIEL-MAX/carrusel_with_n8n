import {
  setAuthCookie, clearAuthCookie, checkRateLimit,
  jsonResponse, errorResponse, successResponse,
  verifyUserLogin, getUsers, getClientIp, sameOrigin,
  startSession, getSession, endSession, endAllSessions,
  isLoginLocked, noteLoginFailure, clearLoginFailures,
} from './_utils.js';
import { verify } from '@node-rs/argon2';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!ADMIN_PASSWORD_HASH) {
  console.warn('WARNING: ADMIN_PASSWORD_HASH not set. Auth will fail.');
}

// POST /api/auth/login - supports super-admin (password only) or user (email + password)
export async function POST(request) {
  if (!sameOrigin(request)) return errorResponse('Forbidden', 403);

  const rateLimit = checkRateLimit(`auth:login:${getClientIp(request)}`, RATE_LIMIT);

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

  const { password, email } = body || {};
  if (!password || typeof password !== 'string') {
    return errorResponse('Password required', 400);
  }
  if (email && typeof email !== 'string') {
    return errorResponse('Email required', 400);
  }

  try {
    // Demasiados fallos seguidos desde esta IP contra esta cuenta: bloqueo temporal.
    const account = email || null;
    if (await isLoginLocked(request, account)) {
      return errorResponse('Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', 429);
    }
    const reject = async () => {
      await noteLoginFailure(request, account);
      await new Promise(r => setTimeout(r, 500));
      return errorResponse('Invalid credentials', 401);
    };

    // Super-admin login: only password provided (no email)
    if (!email) {
      const valid = await verify(ADMIN_PASSWORD_HASH, password);
      if (!valid) return reject();
      await clearLoginFailures(request, account);

      const { token, maxAge } = await startSession(request, { role: 'super-admin' });

      const response = successResponse({ authenticated: true, role: 'super-admin' }, 'Login successful');
      setAuthCookie(response, token, { 'Max-Age': maxAge });

      return response;
    }

    // User login: email + password
    const user = await verifyUserLogin(email, password);
    if (!user) return reject();
    await clearLoginFailures(request, account);

    const { token, maxAge } = await startSession(request, { role: 'user', userId: user.userId });

    const response = successResponse(
      { authenticated: true, role: 'user', userId: user.userId, name: user.name, email: user.email },
      'Login successful'
    );
    setAuthCookie(response, token, { 'Max-Age': maxAge });

    return response;
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return errorResponse('Login failed', 500);
  }
}

// DELETE /api/auth        - cierra esta sesión (la cookie deja de valer aunque se haya copiado)
// DELETE /api/auth?all=1  - cierra todas las sesiones de la cuenta, en todos los dispositivos
export async function DELETE(request) {
  if (!sameOrigin(request)) return errorResponse('Forbidden', 403);
  try {
    if (new URL(request.url).searchParams.get('all') === '1') {
      const payload = await getSession(request);
      if (!payload) return errorResponse('Unauthorized', 401);
      await endAllSessions(payload);
    } else {
      await endSession(request);
    }
  } catch (err) {
    console.error('DELETE /api/auth error:', err);
  }
  const response = successResponse(null, 'Logged out');
  clearAuthCookie(response);
  return response;
}

// GET /api/auth/me - Check current auth status
export async function GET(request) {
  const payload = await getSession(request);
  if (!payload) {
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
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

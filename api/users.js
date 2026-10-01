import {
  getUsers, getImages, createUser, updateUser, updateUserPassword, deleteUser,
  verifyToken, getTokenFromCookie, checkRateLimit,
  jsonResponse, errorResponse, successResponse,
  isSuperAdmin
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);

async function requireSuperAdmin(request) {
  const token = getTokenFromCookie(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const payload = await verifyToken(token);
  if (!isSuperAdmin(payload)) return errorResponse('Forbidden', 403);
  return { payload };
}

function validUserId(userId) {
  return typeof userId === 'string' && /^USER\d+$/i.test(userId.trim());
}

// GET /api/users - List all users (super-admin only).
// Includes imageCount + up to 3 preview thumbnails per user. Never includes hashes.
export async function GET(request) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const users = await getUsers();
  const list = await Promise.all(
    Object.entries(users).map(async ([userId, data]) => {
      let images = [];
      try {
        images = (await getImages(userId)) || [];
      } catch {
        images = [];
      }
      const sorted = [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return {
        userId,
        name: data.name || userId,
        email: data.email || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        imageCount: sorted.length,
        preview: sorted.slice(0, 3).map((i) => i.url),
      };
    })
  );

  return successResponse({ users: list });
}

// POST /api/users - Create new user (super-admin only).
// Body: { name, email, password }. The password is returned once; it is never readable again.
export async function POST(request) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`users:post:${clientIp}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { name, email, password } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return errorResponse('Name required', 400);
  }
  if (!email || typeof email !== 'string') {
    return errorResponse('Email required', 400);
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return errorResponse('Password must be at least 6 characters', 400);
  }

  try {
    const result = await createUser({ name, email, password });
    return successResponse(
      { userId: result.userId, name: result.name, email: result.email, password: result.password },
      'User created'
    );
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') return errorResponse('Email already in use', 409);
    if (err.message === 'Invalid email') return errorResponse('Invalid email', 400);
    if (err.message === 'Invalid name') return errorResponse('Invalid name', 400);
    console.error('POST /api/users error:', err);
    return errorResponse('Failed to create user', 500);
  }
}

// PATCH /api/users?userId=USER2 - Update name/email (super-admin only)
// PATCH /api/users/password?userId=USER2 - Change password (super-admin only)
export async function PATCH(request) {
  const url = new URL(request.url);
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const rawUserId = url.searchParams.get('userId');
  if (!validUserId(rawUserId)) {
    return errorResponse('Invalid userId', 400);
  }
  const userId = rawUserId.trim().toUpperCase();

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (url.pathname.endsWith('/password')) {
    const { password } = body || {};
    if (!password || typeof password !== 'string' || password.length < 6) {
      return errorResponse('Password must be at least 6 characters', 400);
    }

    const updated = await updateUserPassword(userId, password);
    if (!updated) {
      return errorResponse('User not found', 404);
    }

    return successResponse({ userId, password }, 'Password updated');
  }

  const { name, email } = body || {};
  if (name === undefined && email === undefined) {
    return errorResponse('Nothing to update', 400);
  }

  try {
    const updated = await updateUser(userId, { name, email });
    if (!updated) {
      return errorResponse('User not found', 404);
    }
    return successResponse(
      { userId, name: updated.name, email: updated.email, updatedAt: updated.updatedAt },
      'User updated'
    );
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') return errorResponse('Email already in use', 409);
    if (err.code === 'INVALID_EMAIL') return errorResponse('Invalid email', 400);
    if (err.code === 'INVALID_NAME') return errorResponse('Invalid name', 400);
    console.error('PATCH /api/users error:', err);
    return errorResponse('Failed to update user', 500);
  }
}

// DELETE /api/users?userId=USER2 - Delete user + their carousel (super-admin only)
export async function DELETE(request) {
  const url = new URL(request.url);
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const rawUserId = url.searchParams.get('userId');
  if (!validUserId(rawUserId)) {
    return errorResponse('Invalid userId', 400);
  }

  const deleted = await deleteUser(rawUserId.trim().toUpperCase());
  if (!deleted) {
    return errorResponse('User not found', 404);
  }

  return successResponse(null, 'User deleted');
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

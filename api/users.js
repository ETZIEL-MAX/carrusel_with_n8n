import {
  getUsers, getImages, createUser, updateUser, updateUserPassword, deleteUser,
  requireSession, checkRateLimit, getClientIp, normalizeUserId,
  getStorageUsage, generateClientToken, isValidNewPassword, PASSWORD_ERROR,
  errorResponse, successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);

const requireSuperAdmin = (request) => requireSession(request, { superAdmin: true });

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
      let storage = null;
      try {
        storage = await getStorageUsage(userId, users);
      } catch {
        storage = null;
      }
      return {
        userId,
        name: data.name || userId,
        email: data.email || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        imageCount: sorted.length,
        preview: sorted.slice(0, 3).map((i) => i.url),
        usedBytes: storage?.usedBytes ?? 0,
        limitBytes: storage?.limitBytes ?? 0,
        storageLimitMb: storage?.storageLimitMb ?? null,
        defaultLimitMb: storage?.defaultLimitMb ?? null,
        // Del token solo se sabe si existe y sus últimos 4 caracteres.
        hasToken: Boolean(data.webhookTokenEnc),
        tokenHint: data.webhookTokenHint || null,
        tokenCreatedAt: data.webhookTokenCreatedAt || null,
      };
    })
  );

  return successResponse({ users: list });
}

// POST /api/users - Create new user (super-admin only).
// Body: { name, email, password }. The password is returned once; it is never readable again.
// POST /api/users/token?userId=USER2 - Genera (o regenera) el token de webhook del cliente.
// Se devuelve UNA sola vez; el anterior deja de funcionar.
export async function POST(request) {
  const url = new URL(request.url);
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const rateLimit = checkRateLimit(`users:post:${getClientIp(request)}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  if (url.pathname.endsWith('/token')) {
    const userId = normalizeUserId(url.searchParams.get('userId'));
    if (!userId) return errorResponse('Invalid userId', 400);
    try {
      const created = await generateClientToken(userId);
      if (!created) return errorResponse('User not found', 404);
      return successResponse({ userId, ...created }, 'Token generado');
    } catch (err) {
      if (err.code === 'NO_ENC_KEY') {
        return errorResponse('Falta configurar TOKEN_ENC_KEY en el servidor (mínimo 32 caracteres)', 500);
      }
      console.error('POST /api/users/token error:', err);
      return errorResponse('No se pudo generar el token', 500);
    }
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
  if (!isValidNewPassword(password)) {
    return errorResponse(PASSWORD_ERROR, 400);
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

  const userId = normalizeUserId(url.searchParams.get('userId'));
  if (!userId) {
    return errorResponse('Invalid userId', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (url.pathname.endsWith('/password')) {
    const { password } = body || {};
    if (!isValidNewPassword(password)) {
      return errorResponse(PASSWORD_ERROR, 400);
    }

    const updated = await updateUserPassword(userId, password);
    if (!updated) {
      return errorResponse('User not found', 404);
    }

    return successResponse({ userId, password }, 'Password updated');
  }

  const { name, email, storageLimitMb } = body || {};
  if (name === undefined && email === undefined && storageLimitMb === undefined) {
    return errorResponse('Nothing to update', 400);
  }

  try {
    const updated = await updateUser(userId, { name, email, storageLimitMb });
    if (!updated) {
      return errorResponse('User not found', 404);
    }
    return successResponse(
      {
        userId, name: updated.name, email: updated.email, updatedAt: updated.updatedAt,
        storageLimitMb: updated.storageLimitMb ?? null,
      },
      'User updated'
    );
  } catch (err) {
    if (err.code === 'INVALID_LIMIT') return errorResponse(err.message, 400);
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

  const userId = normalizeUserId(url.searchParams.get('userId'));
  if (!userId) {
    return errorResponse('Invalid userId', 400);
  }

  const deleted = await deleteUser(userId);
  if (!deleted) {
    return errorResponse('User not found', 404);
  }

  return successResponse(null, 'User deleted');
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

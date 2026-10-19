import {
  getUsers, getImages, createUser, updateUser, updateUserPassword, deleteUser,
  requireSession, checkRateLimit, getClientIp, normalizeUserId,
  getStorageUsage, getGenerationQuota, generateClientToken, newClientToken, isValidNewPassword, PASSWORD_ERROR,
  getPlans, getUsageSummary, listDevices, setPlan,
  errorResponse, successResponse,
} from './_utils.js';
import { numbersConfigured, pushNumber } from './_n8n-numbers.js';
import { planState } from './_plans.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);

const requireSuperAdmin = (request) => requireSession(request, { superAdmin: true });

// GET /api/users - List all users (super-admin only).
// Includes imageCount + up to 3 preview thumbnails per user. Never includes hashes.
export async function GET(request) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  const users = await getUsers();
  const plans = await getPlans();
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
      const quota = await getGenerationQuota(userId, users).catch(() => null);
      const usage = await getUsageSummary(userId).catch(() => null);
      const devices = await listDevices(userId).catch(() => []);
      return {
        userId,
        name: data.name || userId,
        email: data.email || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        createdBy: data.createdBy || 'admin',
        // Prueba de que aceptó los términos al registrarse (null si la creó el super-admin).
        termsVersion: data.termsVersion || null,
        termsAcceptedAt: data.termsAcceptedAt || null,
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
        whatsappPhone: data.whatsappPhone || null,
        quota,
        plan: planState(data, plans),
        devicesActive: devices.filter((d) => d.active).length,
        // Del mes en curso: lo que más interesa en la lista del super-admin.
        usage: usage ? { month: usage.month, images: usage.images, whatsappMessages: usage.whatsappMessages } : null,
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
      // Con número vinculado, el token nuevo va primero a la fila de n8n: si no, ese
      // WhatsApp dejaría de poder firmar.
      const token = newClientToken();
      const phone = (await getUsers())[userId]?.whatsappPhone;
      if (phone && numbersConfigured()) {
        try {
          await pushNumber({ action: 'upsert', numero: phone, numeroAnterior: null, carrusel: userId, token });
        } catch (err) {
          console.error('POST /api/users/token n8n error:', err.message);
          return errorResponse('No se pudo actualizar el token en n8n; el anterior sigue valiendo', 502);
        }
      }
      const created = await generateClientToken(userId, token);
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

  // plan: 'basico'|'pro'|'empresa'|'custom'; planEndsAt: fecha ISO o null (sin fin).
  const { name, email, storageLimitMb, monthlyImageLimit, plan, planEndsAt } = body || {};
  if (name === undefined && email === undefined && storageLimitMb === undefined && monthlyImageLimit === undefined && plan === undefined) {
    return errorResponse('Nothing to update', 400);
  }

  try {
    if (plan !== undefined) {
      const changed = await setPlan(userId, { planId: plan, until: planEndsAt ?? null, provider: 'manual' });
      if (!changed) return errorResponse('User not found', 404);
    }
    const onlyPlan = name === undefined && email === undefined && storageLimitMb === undefined && monthlyImageLimit === undefined;
    const updated = onlyPlan ? { userId, ...(await getUsers())[userId] } : await updateUser(userId, { name, email, storageLimitMb, monthlyImageLimit });
    if (!updated) {
      return errorResponse('User not found', 404);
    }
    return successResponse(
      {
        userId, name: updated.name, email: updated.email, updatedAt: updated.updatedAt,
        storageLimitMb: updated.storageLimitMb ?? null,
        monthlyImageLimit: updated.monthlyImageLimit ?? null,
        plan: planState(updated, await getPlans()),
      },
      'User updated'
    );
  } catch (err) {
    if (err.code === 'INVALID_LIMIT' || err.code === 'INVALID_PLAN') return errorResponse(err.message, 400);
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

  // Su número deja de estar en n8n (si falla se registra y se sigue: la fila apuntaría a
  // un USERn que ya no existe y que no se reutiliza, así que no da acceso a nada).
  const phone = (await getUsers())[userId]?.whatsappPhone;
  if (phone && numbersConfigured()) {
    await pushNumber({ action: 'delete', numero: phone, carrusel: userId })
      .catch((err) => console.error('DELETE /api/users n8n error:', err.message));
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

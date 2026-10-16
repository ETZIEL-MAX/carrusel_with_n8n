// Número de WhatsApp vinculado a un carrusel (cookie; el super-admin indica ?userId).
//   GET    /api/whatsapp            -> { phone, linkedAt, available }
//   POST   /api/whatsapp { phone }  -> vincula o cambia el número
//   DELETE /api/whatsapp            -> lo desvincula
// Al vincular se genera un token nuevo que va directo a n8n (nunca al navegador).
// Se guarda solo si n8n respondió bien: si falla, el número y el token anteriores siguen.
import {
  requireSession, resolveUserId, checkRateLimit, getClientIp, getUsers,
  normalizePhone, phoneOwner, newClientToken, setWhatsapp,
  errorResponse, successResponse,
} from './_utils.js';
import { numbersConfigured, pushNumber } from './_n8n-numbers.js';
import { sendMail, mailConfigured, phoneLinkedMessage } from './_mail.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10);

async function target(request) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const userId = resolveUserId(request, auth.payload);
  if (userId instanceof Response) return userId;
  const rl = checkRateLimit(`whatsapp:${request.method}:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Demasiados intentos. Espera un momento.', 429, { resetAt: rl.resetAt });
  const user = (await getUsers())[userId];
  if (!user) return errorResponse('User not found', 404);
  return { userId, user };
}

const view = (user) => ({
  phone: user.whatsappPhone || null,
  linkedAt: user.whatsappLinkedAt || null,
  available: numbersConfigured(),
});

export async function GET(request) {
  const t = await target(request);
  if (t instanceof Response) return t;
  return successResponse(view(t.user));
}

export async function POST(request) {
  const t = await target(request);
  if (t instanceof Response) return t;
  if (!numbersConfigured()) return errorResponse('La vinculación de WhatsApp no está disponible todavía', 503);

  let body;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const phone = normalizePhone(body?.phone);
  if (!phone) return errorResponse('Escribe un número de WhatsApp de 10 dígitos', 400);

  if (phoneOwner(await getUsers(), phone, t.userId)) {
    return errorResponse('Ese número ya está vinculado a otra cuenta', 409);
  }

  const token = newClientToken();
  const previous = t.user.whatsappPhone || null;
  try {
    await pushNumber({ action: 'upsert', numero: phone, numeroAnterior: previous !== phone ? previous : null, carrusel: t.userId, token });
  } catch (err) {
    if (err.status === 409) return errorResponse('Ese número ya está vinculado a otra cuenta', 409);
    console.error('POST /api/whatsapp n8n error:', err.message);
    return errorResponse('No se pudo vincular con WhatsApp. Inténtalo de nuevo en unos minutos.', 502);
  }

  const saved = await setWhatsapp(t.userId, { phone, token });
  if (saved.error === 'PHONE_TAKEN') return errorResponse('Ese número ya está vinculado a otra cuenta', 409);
  if (saved.error) return errorResponse('User not found', 404);

  if (t.user.email && mailConfigured()) {
    sendMail({ to: t.user.email, ...phoneLinkedMessage({ name: t.user.name || '', phone }) })
      .catch((err) => console.error('POST /api/whatsapp mail error:', err.message));
  }
  return successResponse(view(saved.user), 'Número vinculado');
}

export async function DELETE(request) {
  const t = await target(request);
  if (t instanceof Response) return t;
  const phone = t.user.whatsappPhone;
  if (!phone) return successResponse(view(t.user), 'No había número vinculado');
  if (numbersConfigured()) {
    try {
      await pushNumber({ action: 'delete', numero: phone, carrusel: t.userId });
    } catch (err) {
      console.error('DELETE /api/whatsapp n8n error:', err.message);
      return errorResponse('No se pudo desvincular en WhatsApp. Inténtalo de nuevo en unos minutos.', 502);
    }
  }
  const saved = await setWhatsapp(t.userId, { phone: null });
  if (saved.error) return errorResponse('User not found', 404);
  return successResponse(view(saved.user), 'Número desvinculado');
}

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

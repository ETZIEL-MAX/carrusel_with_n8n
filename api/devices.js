// Pantallas (TVs / navegadores) que reproducen el carrusel. Cookie; el super-admin pasa ?userId.
//   GET    /api/devices          -> { devices: [{ id, lastSeen, active }], limit, active }
//   DELETE /api/devices?id=<id>  -> libera esa pantalla y la desconecta: si sigue encendida
//                                   no vuelve a entrar; en la TV se puede conectar como nueva
//   DELETE /api/devices?all=1    -> lo mismo con todas las pantallas
import {
  requireSession, resolveUserId, getUsers, checkRateLimit, getClientIp,
  getPlanState, listDevices, removeDevice, isValidDeviceId,
  errorResponse, successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10);

async function target(request) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const userId = resolveUserId(request, auth.payload);
  if (userId instanceof Response) return userId;
  const rl = checkRateLimit(`devices:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });
  const users = await getUsers();
  if (!users[userId]) return errorResponse('User not found', 404);
  return { userId, users };
}

export async function GET(request) {
  const t = await target(request);
  if (t instanceof Response) return t;
  const devices = await listDevices(t.userId);
  const plan = await getPlanState(t.userId, t.users);
  return successResponse({
    devices,
    active: devices.filter((d) => d.active).length,
    limit: plan.devices,
  });
}

export async function DELETE(request) {
  const t = await target(request);
  if (t instanceof Response) return t;
  const params = new URL(request.url).searchParams;
  if (params.get('all') === '1') {
    const removed = await removeDevice(t.userId, null);
    return successResponse({ removed }, 'Pantallas liberadas');
  }
  const id = params.get('id');
  if (!isValidDeviceId(id)) return errorResponse('id inválido', 400);
  const removed = await removeDevice(t.userId, id);
  if (!removed) return errorResponse('Pantalla no encontrada', 404);
  return successResponse({ removed }, 'Pantalla liberada');
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

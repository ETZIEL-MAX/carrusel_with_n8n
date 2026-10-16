// Código QR del carrusel público (cookie; el super-admin indica ?userId).
//   GET /api/qr -> { url, dataUrl }: url = carrusel público, dataUrl = PNG en data URL
// La URL sale de APP_URL, nunca del header Host. El QR no es secreto: el carrusel es público.
import QRCode from 'qrcode';
import {
  requireSession, resolveUserId, appBaseUrl, getUsers, checkRateLimit, getClientIp,
  errorResponse, successResponse,
} from './_utils.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10);

export async function GET(request) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const userId = resolveUserId(request, auth.payload);
  if (userId instanceof Response) return userId;
  const rl = checkRateLimit(`qr:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Demasiados intentos. Espera un momento.', 429, { resetAt: rl.resetAt });
  if (!(await getUsers())[userId]) return errorResponse('User not found', 404);

  const base = appBaseUrl(request);
  if (!base) return errorResponse('APP_URL no está configurada', 503);
  const url = `${base}/carrusel/${userId}`;
  // Fondo blanco y margen: un QR sobre el tema oscuro del panel no se lee bien en algunos lectores.
  const dataUrl = await QRCode.toDataURL(url, {
    type: 'image/png', width: 720, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  return successResponse({ url, dataUrl });
}

// "Crear con IA" desde el panel. Cookie; el super-admin pasa ?userId.
//   GET    /api/drafts                         -> { drafts, quota }
//   POST   /api/drafts  { prompt }             -> crea un borrador y pide la imagen a n8n
//   POST   /api/drafts  { id, action: 'publicar' } -> la imagen pasa al carrusel
//   PATCH  /api/drafts  { id, cambios }        -> otra ronda con indicaciones nuevas
//   DELETE /api/drafts?id=<id>                 -> descarta el borrador y su archivo
// n8n contesta en POST /api/drafts/callback?userId=USERx&id=<id> (ver handleDraftCallback).
//
// A n8n se le manda: { userId, draftId, round, prompt, changes, previousImageUrl, format,
// width, height, googleDriveFolder, colorPalette, callbackUrl, callbackToken }.
// La imagen se cuenta en el consumo del mes al llegar: el flujo web no reporta /api/usage.
import { randomUUID } from 'crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  requireSession, resolveUserId, getUsers, checkRateLimit, getClientIp, normalizeUserId,
  getGenerationSettings, getGenerationQuota, posterSize, isAllowedN8nUrl, appBaseUrl,
  planBlockedResponse, addImage, removeUserFile, recordUsage, saveImageFromTemp, quotaErrorResponse,
  errorResponse, successResponse,
} from './_utils.js';
import {
  listDrafts, createDraft, requestChanges, failRound, finishRound, takeDraft, findDraft, tokenMatches,
  publicDraft, isValidDraftId, MAX_PROMPT, MAX_CHANGES,
} from './_drafts.js';
import { rehostImageUrl, isBinaryUpload } from './_webhook-shared.js';
import { uploadTempDir, isLocalImages } from './_store.js';
import { writeCapped, withUploadSlot, cleanupTemp } from './_stream.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_GENERATE || '10', 10);
const READ_LIMIT = parseInt(process.env.RATE_LIMIT_SETTINGS || '30', 10) * 4; // el panel refresca mientras genera
const TRIGGER_TIMEOUT_MS = parseInt(process.env.GENERATE_TIMEOUT_MS || '30000', 10);
const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(15 * 1024 * 1024), 10);
const JSON_LIMIT = 64 * 1024;

async function target(request, limit) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const userId = resolveUserId(request, auth.payload);
  if (userId instanceof Response) return userId;
  const rl = checkRateLimit(`drafts:${request.method}:${getClientIp(request)}:${userId}`, limit);
  if (!rl.allowed) return errorResponse('Demasiadas solicitudes. Espera un momento.', 429, { resetAt: rl.resetAt });
  if (!(await getUsers())[userId]) return errorResponse('User not found', 404);
  return userId;
}

const draftError = (err) => {
  if (['TOO_MANY', 'BUSY', 'NOT_READY'].includes(err.code)) return errorResponse(err.message, 409);
  if (err.code === 'DRAFTS_BUSY') return errorResponse(err.message, 503);
  return null;
};

// Webhook del flujo "Generar desde web": el propio del carrusel (lo fija el super-admin) o
// el general del servidor. Solo hosts de N8N_ALLOWED_HOSTS.
function generationWebhook(settings) {
  return settings.n8nGenerationWebhook || process.env.N8N_WEB_GENERATION_URL || null;
}

// Antes de crear una ronda: plan activo, cupo del mes y webhook válido.
async function canGenerate(userId, request) {
  const blocked = await planBlockedResponse(userId);
  if (blocked) return blocked;
  const quota = await getGenerationQuota(userId);
  if (quota.remaining === 0) {
    return errorResponse(`Llegaste al límite de ${quota.limit} imágenes de este mes`, 429, { quota });
  }
  const settings = await getGenerationSettings(userId);
  const hook = generationWebhook(settings);
  if (!hook) return errorResponse('La generación desde la web no está configurada todavía.', 503);
  if (!isAllowedN8nUrl(hook)) return errorResponse('El webhook de generación no está en N8N_ALLOWED_HOSTS', 500);
  const base = appBaseUrl(request);
  if (!base) return errorResponse('Falta configurar APP_URL en el servidor', 500);
  return { settings, hook, base };
}

async function trigger(ctx, userId, draft, callbackToken) {
  const { settings, hook, base } = ctx;
  const size = posterSize(settings.defaultOrientation, settings.posterResolution);
  const payload = {
    userId,
    draftId: draft.id,
    round: draft.round,
    prompt: draft.prompt,
    changes: draft.changes,
    previousImageUrl: draft.url ? (draft.url.startsWith('/') ? base + draft.url : draft.url) : null,
    format: settings.defaultOrientation,
    width: size.width,
    height: size.height,
    googleDriveFolder: settings.googleDriveFolder,
    colorPalette: settings.colorPalette,
    callbackUrl: `${base}/api/drafts/callback?userId=${userId}&id=${draft.id}`,
    callbackToken,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.N8N_NUMBERS_SECRET) headers['X-Carrusel-Key'] = process.env.N8N_NUMBERS_SECRET;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const res = await fetch(hook, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      console.error(`drafts: n8n respondió ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('drafts: no se pudo llamar a n8n:', err.name === 'AbortError' ? 'timeout' : err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  const userId = await target(request, READ_LIMIT);
  if (userId instanceof Response) return userId;
  const drafts = await listDrafts(userId);
  const quota = await getGenerationQuota(userId);
  // enabled: hay webhook de generación (si no, el panel no muestra "Crear con IA").
  const enabled = Boolean(generationWebhook(await getGenerationSettings(userId)));
  return successResponse({ drafts, quota, enabled });
}

export async function POST(request) {
  const userId = await target(request, RATE_LIMIT);
  if (userId instanceof Response) return userId;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // Publicar: la imagen ya está guardada y anotada en el espacio del usuario.
  if (body?.action === 'publicar') {
    if (!isValidDraftId(body.id)) return errorResponse('id inválido', 400);
    const blocked = await planBlockedResponse(userId);
    if (blocked) return blocked;
    try {
      const d = await takeDraft(userId, body.id, { onlyReady: true });
      if (!d) return errorResponse('Borrador no encontrado', 404);
      const image = await addImage(userId, { url: d.url, alt: d.prompt.slice(0, 300) });
      return successResponse(image, 'Publicada en el carrusel');
    } catch (err) {
      return draftError(err) || errorResponse('No se pudo publicar', 500);
    }
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return errorResponse('Escribe qué imagen quieres', 400);
  if (prompt.length > MAX_PROMPT) return errorResponse(`El texto puede tener hasta ${MAX_PROMPT} caracteres`, 400);

  const ctx = await canGenerate(userId, request);
  if (ctx instanceof Response) return ctx;
  try {
    const { draft, callbackToken } = await createDraft(userId, prompt);
    if (!(await trigger(ctx, userId, draft, callbackToken))) {
      await failRound(userId, draft.id, 'No se pudo contactar al generador', { removeIfNew: true });
      return errorResponse('No se pudo contactar al generador. Inténtalo de nuevo en un momento.', 502);
    }
    return successResponse(publicDraft(draft), 'Generando');
  } catch (err) {
    return draftError(err) || errorResponse('No se pudo crear el borrador', 500);
  }
}

export async function PATCH(request) {
  const userId = await target(request, RATE_LIMIT);
  if (userId instanceof Response) return userId;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  if (!isValidDraftId(body?.id)) return errorResponse('id inválido', 400);
  const cambios = typeof body?.cambios === 'string' ? body.cambios.trim() : '';
  if (!cambios) return errorResponse('Escribe qué quieres cambiar', 400);
  if (cambios.length > MAX_CHANGES) return errorResponse(`Los cambios pueden tener hasta ${MAX_CHANGES} caracteres`, 400);

  const ctx = await canGenerate(userId, request);
  if (ctx instanceof Response) return ctx;
  try {
    const round = await requestChanges(userId, body.id, cambios);
    if (!round) return errorResponse('Borrador no encontrado', 404);
    if (!(await trigger(ctx, userId, round.draft, round.callbackToken))) {
      await failRound(userId, body.id, 'No se pudo contactar al generador. Pide los cambios otra vez.');
      return errorResponse('No se pudo contactar al generador. Inténtalo de nuevo en un momento.', 502);
    }
    return successResponse(publicDraft(round.draft), 'Generando cambios');
  } catch (err) {
    return draftError(err) || errorResponse('No se pudieron pedir los cambios', 500);
  }
}

export async function DELETE(request) {
  const userId = await target(request, RATE_LIMIT);
  if (userId instanceof Response) return userId;
  const id = new URL(request.url).searchParams.get('id');
  if (!isValidDraftId(id)) return errorResponse('id inválido', 400);
  try {
    const d = await takeDraft(userId, id);
    if (!d) return errorResponse('Borrador no encontrado', 404);
    if (d.url) await removeUserFile(userId, { url: d.url }).catch((err) => console.error('drafts: borrar archivo:', err.message));
    return successResponse(null, 'Borrador descartado');
  } catch (err) {
    return draftError(err) || errorResponse('No se pudo descartar', 500);
  }
}

// ==================== Respuesta de n8n ====================
// POST /api/drafts/callback?userId=USERx&id=<draftId>   cabecera X-Draft-Token: <callbackToken>
// Cuerpo, una de tres:
//   - la imagen tal cual (Content-Type: image/*): se escribe a disco mientras llega
//   - { "url": "<URL temporal>" }: se descarga (mismos hosts que /api/upload)
//   - { "error": "texto" }: la ronda falló
// El secreto vale para una sola respuesta de la ronda en curso.
async function readJson(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > JSON_LIMIT) return { tooBig: true };
    chunks.push(chunk);
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { body: null };
  }
}

// `stream`: el cuerpo (Readable). En el servidor propio llega aparte (no se junta en memoria).
export async function handleDraftCallback(request, stream) {
  const url = new URL(request.url);
  const userId = normalizeUserId(url.searchParams.get('userId'));
  const id = url.searchParams.get('id');
  if (!userId || !isValidDraftId(id)) return errorResponse('Parámetros inválidos', 400);
  const rl = checkRateLimit(`drafts:callback:${getClientIp(request)}`, 60);
  if (!rl.allowed) return errorResponse('Rate limit exceeded', 429, { resetAt: rl.resetAt });

  const token = request.headers.get('x-draft-token') || '';
  const draft = await findDraft(userId, id);
  // Nada se lee ni se guarda sin el secreto de la ronda en curso.
  if (!tokenMatches(draft, token)) return errorResponse('Token inválido o vencido', 401);
  const blocked = await planBlockedResponse(userId);
  if (blocked) return blocked;
  if (!stream) return errorResponse('Falta el cuerpo', 400);

  let storedUrl = null;
  let failure = null;
  const tmpDir = uploadTempDir();
  const tmp = join(tmpDir, `.tmp-${randomUUID()}`);
  try {
    if (isBinaryUpload(request.headers.get('content-type'))) {
      if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) return errorResponse('Almacenamiento no configurado', 500);
      await mkdir(tmpDir, { recursive: true });
      const size = await withUploadSlot(() => writeCapped(stream, tmp, MAX_BYTES));
      if (size === -1) return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
      if (size === 0) return errorResponse('Imagen vacía', 400);
      const stored = await saveImageFromTemp(userId, tmp);
      if (!stored) return errorResponse('El contenido no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
      storedUrl = stored.url;
    } else {
      const { body, tooBig } = await readJson(stream);
      if (tooBig) return errorResponse('Payload too large', 413);
      if (!body || typeof body !== 'object') return errorResponse('Invalid JSON', 400);
      if (typeof body.error === 'string' && !body.url) {
        failure = body.error;
      } else {
        const res = await rehostImageUrl(userId, body.url, '');
        if (!res.ok) return res;
        storedUrl = (await res.json()).data.url;
      }
    }
  } catch (err) {
    const full = quotaErrorResponse(err);
    if (full) {
      await finishRound(userId, id, token, { error: 'No hay espacio para guardar la imagen. Borra imágenes o pide más espacio.' }).catch(() => {});
      return full;
    }
    console.error('POST /api/drafts/callback error:', err);
    return errorResponse('Error al guardar la imagen', 500);
  } finally {
    await cleanupTemp(tmp);
  }

  const done = await finishRound(userId, id, token, storedUrl ? { url: storedUrl } : { error: failure });
  if (!done) {
    // La ronda cambió mientras se guardaba: la imagen ya no tiene a dónde ir.
    if (storedUrl) await removeUserFile(userId, { url: storedUrl }).catch(() => {});
    return errorResponse('Token inválido o vencido', 401);
  }
  if (storedUrl) {
    if (done.previousUrl) await removeUserFile(userId, { url: done.previousUrl }).catch(() => {});
    await recordUsage(userId, { eventId: `draft-${id}-${done.draft.round}`, kind: 'image' });
  }
  return successResponse({ id, status: done.draft.status }, storedUrl ? 'Imagen recibida' : 'Error registrado');
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

// Para Vercel (api/drafts/callback.js): el cuerpo sale del Request.
export const callbackFromRequest = (request) =>
  handleDraftCallback(request, request.body ? Readable.fromWeb(request.body) : null);

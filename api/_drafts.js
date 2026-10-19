// Borradores de imágenes generadas desde el panel ("Crear con IA").
// Viven en carousel:USERx:drafts (lista JSON). Cada uno pasa por:
//   generando -> listo (llegó la imagen) | error
//   listo/error --"pedir cambios"--> generando (otra ronda)
//   listo --"publicar"--> entra al carrusel y sale de la lista
// n8n devuelve la imagen a /api/drafts/callback con un secreto de un solo uso por ronda
// (callbackToken): no depende del token de WhatsApp del cliente.
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { getJson, setJson, setOnce, tempDelete } from './_store.js';

export const MAX_DRAFTS = 20;
export const MAX_PROMPT = 1000;
export const MAX_CHANGES = 500;
export const MAX_ROUNDS = 10;
// Si n8n no contesta en este tiempo, la ronda se da por fallida y su secreto deja de servir.
export const ROUND_TIMEOUT_MS = 15 * 60 * 1000;

const key = (userId) => `carousel:${userId}:drafts`;
const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
export const isValidDraftId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

async function read(userId) {
  const list = await getJson(key(userId));
  return Array.isArray(list) ? list : [];
}

// Escrituras de la lista con candado: el callback de n8n y el panel pueden cruzarse.
export async function withDrafts(userId, fn) {
  const lock = `carousel:lock:drafts:${userId}`;
  const deadline = Date.now() + 10000;
  while (!(await setOnce(lock, 15))) {
    if (Date.now() > deadline) throw Object.assign(new Error('Borradores ocupados, inténtalo de nuevo'), { code: 'DRAFTS_BUSY' });
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
  }
  try {
    const list = await read(userId);
    const result = await fn(list);
    await setJson(key(userId), list);
    return result;
  } finally {
    await tempDelete(lock);
  }
}

// Una ronda que pasó del tiempo cuenta como fallida.
function effective(d, now = Date.now()) {
  if (d.status === 'generando' && now - Date.parse(d.updatedAt) > ROUND_TIMEOUT_MS) {
    return { ...d, status: 'error', error: 'La generación tardó demasiado. Pide cambios para intentarlo otra vez.' };
  }
  return d;
}

// Lo que ve el panel: sin el hash del secreto.
export function publicDraft(d) {
  const e = effective(d);
  return {
    id: e.id, prompt: e.prompt, changes: e.changes, round: e.round, status: e.status,
    url: e.url, error: e.error, createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

export async function listDrafts(userId) {
  return (await read(userId)).map(publicDraft);
}

export async function findDraft(userId, id) {
  return (await read(userId)).find((d) => d.id === id) || null;
}

// Nuevo secreto para la ronda; se guarda solo su hash.
function newRound(d) {
  const token = randomBytes(24).toString('base64url');
  d.tokenHash = sha(token);
  d.status = 'generando';
  d.error = null;
  d.updatedAt = new Date().toISOString();
  return token;
}

export async function createDraft(userId, prompt) {
  return withDrafts(userId, (list) => {
    if (list.length >= MAX_DRAFTS) {
      throw Object.assign(new Error(`Tienes ${MAX_DRAFTS} borradores. Publica o descarta alguno antes de crear otro.`), { code: 'TOO_MANY' });
    }
    const now = new Date().toISOString();
    const d = { id: randomUUID(), prompt, changes: [], round: 1, url: null, createdAt: now };
    const callbackToken = newRound(d);
    list.unshift(d);
    return { draft: d, callbackToken };
  });
}

// "Pedir cambios": otra ronda con las indicaciones nuevas.
export async function requestChanges(userId, id, changes) {
  return withDrafts(userId, (list) => {
    const d = list.find((x) => x.id === id);
    if (!d) return null;
    if (effective(d).status === 'generando') throw Object.assign(new Error('Este borrador todavía se está generando'), { code: 'BUSY' });
    if (d.round >= MAX_ROUNDS) throw Object.assign(new Error(`Llegaste a ${MAX_ROUNDS} rondas de cambios. Crea un borrador nuevo.`), { code: 'TOO_MANY' });
    d.changes = [...d.changes, changes];
    d.round += 1;
    const callbackToken = newRound(d);
    return { draft: d, callbackToken };
  });
}

// La llamada a n8n falló: el borrador nuevo se quita; uno con cambios queda en error.
export async function failRound(userId, id, message, { removeIfNew = false } = {}) {
  return withDrafts(userId, (list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) return;
    if (removeIfNew && list[i].round === 1 && !list[i].url) {
      list.splice(i, 1);
      return;
    }
    list[i].status = 'error';
    list[i].error = message;
    list[i].tokenHash = null;
    list[i].updatedAt = new Date().toISOString();
  });
}

// ¿El secreto abre la ronda en curso de este borrador?
export function tokenMatches(d, token) {
  if (!d || !d.tokenHash || typeof token !== 'string' || !token) return false;
  if (effective(d).status !== 'generando') return false;
  const a = Buffer.from(sha(token), 'hex');
  const b = Buffer.from(d.tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Llegó el resultado de la ronda. Devuelve { draft, previousUrl } o null si el secreto
// ya no vale (otra ronda empezó, se descartó o venció mientras se guardaba la imagen).
export async function finishRound(userId, id, token, { url = null, error = null }) {
  return withDrafts(userId, (list) => {
    const d = list.find((x) => x.id === id);
    if (!tokenMatches(d, token)) return null;
    const previousUrl = url ? d.url : null;
    d.tokenHash = null;
    d.updatedAt = new Date().toISOString();
    if (url) {
      d.url = url;
      d.status = 'listo';
      d.error = null;
    } else {
      d.status = 'error';
      d.error = String(error || 'No se pudo generar la imagen').slice(0, 300);
    }
    return { draft: d, previousUrl };
  });
}

// Quita el borrador de la lista (al publicar o descartar). Devuelve el borrador quitado.
export async function takeDraft(userId, id, { onlyReady = false } = {}) {
  return withDrafts(userId, (list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) return null;
    // Se puede publicar la última imagen buena aunque una ronda de cambios haya fallado,
    // pero no mientras se genera otra.
    if (onlyReady && (!list[i].url || effective(list[i]).status === 'generando')) {
      throw Object.assign(new Error('El borrador todavía no tiene imagen'), { code: 'NOT_READY' });
    }
    return list.splice(i, 1)[0];
  });
}

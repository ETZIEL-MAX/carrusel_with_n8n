// POST /api/drafts/callback (Vercel). n8n devuelve aquí la imagen de un borrador; ver api/drafts.js.
import { callbackFromRequest } from '../drafts.js';

export const POST = callbackFromRequest;

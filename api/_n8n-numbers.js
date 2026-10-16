// Alta y baja de números en la tabla `whatsapp_numeros` de n8n, a través del flujo
// "Alta de número" (Webhook con Header Auth). Es la única vía por la que el token de un
// cliente sale del servidor después de generarse: va directo a n8n y nunca al navegador.
//   POST N8N_NUMBERS_WEBHOOK_URL
//   X-Carrusel-Key: N8N_NUMBERS_SECRET
//   { action: 'upsert', numero, numeroAnterior, carrusel, token }
//   { action: 'delete', numero, carrusel }
// El flujo responde 409 si `numero` ya está en la tabla con otro `carrusel`.
// La URL sale del entorno, no de lo que mande un usuario.

const TIMEOUT_MS = 10000;

export function numbersConfigured() {
  return Boolean(process.env.N8N_NUMBERS_WEBHOOK_URL && process.env.N8N_NUMBERS_SECRET);
}

export async function pushNumber(payload) {
  if (!numbersConfigured()) {
    const err = new Error('La vinculación de WhatsApp no está configurada');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(process.env.N8N_NUMBERS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Carrusel-Key': process.env.N8N_NUMBERS_SECRET },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      const err = new Error(`n8n respondió ${res.status}: ${detail}`);
      // 409: el número ya está en la tabla con otro carrusel (filas dadas de alta a mano).
      err.status = res.status;
      throw err;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

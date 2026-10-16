// Envío de correos con Resend (API HTTP, sin SDK).
// Sin RESEND_API_KEY y fuera de producción, el correo se escribe en LOCAL_DATA_DIR/mail/
// como JSON: es la bandeja de dev y de los tests.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10000;

const isProd = () => process.env.NODE_ENV === 'production';

export function localOutboxDir() {
  return join(process.env.LOCAL_DATA_DIR || join(process.cwd(), '.data'), 'mail');
}

// ¿Se pueden mandar correos? En producción hacen falta la API key y el remitente.
export function mailConfigured() {
  if (process.env.RESEND_API_KEY) return Boolean(process.env.MAIL_FROM);
  return !isProd();
}

export async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (isProd()) {
      const err = new Error('El envío de correos no está configurado');
      err.code = 'NO_MAIL';
      throw err;
    }
    const dir = localOutboxDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ to, subject, html, text }, null, 2));
    return { id: 'local' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend respondió ${res.status}: ${detail}`);
    }
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

// ==================== Plantillas ====================

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function layout({ title, paragraphs, button, footer }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const btn = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">${escapeHtml(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#666;word-break:break-all">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(button.href)}</p>`
    : '';
  const foot = footer ? `<p style="margin:24px 0 0;font-size:13px;color:#666">${escapeHtml(footer)}</p>` : '';
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;background:#fff;padding:28px;border-radius:8px">
<h1 style="font-size:20px;margin:0 0 20px">${escapeHtml(title)}</h1>${body}${btn}${foot}</div></body></html>`;
  const text = [title, '', ...paragraphs, ...(button ? ['', `${button.label}: ${button.href}`] : []), ...(footer ? ['', footer] : [])].join('\n');
  return { html, text };
}

export function verifyEmailMessage({ name, link }) {
  return {
    subject: 'Confirma tu correo para crear tu cuenta',
    ...layout({
      title: `Hola, ${name}`,
      paragraphs: ['Para terminar de crear tu cuenta del carrusel, confirma tu correo. El enlace vale 24 horas y se usa una sola vez.'],
      button: { href: link, label: 'Confirmar mi correo' },
      footer: 'Si no fuiste tú, ignora este correo: no se creará ninguna cuenta.',
    }),
  };
}

export function alreadyRegisteredMessage({ name, link }) {
  return {
    subject: 'Ya tienes una cuenta con este correo',
    ...layout({
      title: `Hola, ${name}`,
      paragraphs: [
        'Alguien intentó crear una cuenta con este correo, pero ya tienes una.',
        'Si olvidaste tu contraseña, puedes poner una nueva con este enlace. Vale 30 minutos.',
      ],
      button: { href: link, label: 'Poner una contraseña nueva' },
      footer: 'Si no fuiste tú, ignora este correo: tu cuenta no cambió.',
    }),
  };
}

export function phoneLinkedMessage({ name, phone }) {
  return {
    subject: 'Vinculaste un número de WhatsApp a tu carrusel',
    ...layout({
      title: `Hola, ${name}`,
      paragraphs: [
        `El número terminado en ${String(phone).slice(-4)} quedó vinculado a tu cuenta. Desde él se pueden crear y cambiar las imágenes de tu carrusel por WhatsApp.`,
        'Si no fuiste tú, entra a tu panel y desvincúlalo, o avísanos.',
      ],
    }),
  };
}

export function resetPasswordMessage({ name, link }) {
  return {
    subject: 'Restablece tu contraseña',
    ...layout({
      title: `Hola, ${name}`,
      paragraphs: ['Recibimos una solicitud para cambiar la contraseña de tu cuenta. El enlace vale 30 minutos y se usa una sola vez.'],
      button: { href: link, label: 'Poner una contraseña nueva' },
      footer: 'Si no fuiste tú, ignora este correo: tu contraseña no cambia hasta que uses el enlace.',
    }),
  };
}

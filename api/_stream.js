// Subidas en streaming: el cuerpo se escribe a disco mientras llega, con tope de tamaño,
// y nunca se junta en memoria. Lo usan las subidas de imagen del panel y la
// descarga por URL de n8n.

import { createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Escribe el flujo en `file` sin pasar de `limit` bytes. Devuelve los bytes escritos,
// o -1 si se pasó (en ese caso deja de escribir y descarta el resto).
// `onChunk` (opcional) recibe cada trozo aceptado: sirve para firmar el cuerpo sin guardarlo.
export function writeCapped(stream, file, limit, onChunk) {
  return new Promise((resolve, reject) => {
    // Si quien sube ya cortó (cerró la pestaña, venció el proxy mientras esperaba turno),
    // el flujo no va a emitir nada más: sin esto la promesa quedaría colgada para siempre.
    if (stream.destroyed || stream.readableEnded) {
      reject(new Error('La subida se cortó antes de recibir el archivo'));
      return;
    }
    const out = createWriteStream(file, { flags: 'wx' });
    // El archivo tiene que estar cerrado antes de responder: quien llama puede borrarlo.
    const closed = new Promise((done) => out.once('close', done));
    let size = 0;
    let over = false;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', fail);
      stream.off('close', onClose);
      fn(value);
    };
    function fail(err) {
      out.destroy();
      closed.then(() => settle(reject, err));
    }
    function onData(chunk) {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        out.end();
        return;
      }
      if (onChunk) onChunk(chunk);
      if (!out.write(chunk)) {
        stream.pause();
        out.once('drain', () => stream.resume());
      }
    }
    function onEnd() {
      if (!over) out.end();
      closed.then(() => settle(resolve, over ? -1 : size));
    }
    // 'close' sin 'end': la conexión se cortó a mitad.
    function onClose() {
      if (!stream.readableEnded) fail(new Error('La subida se cortó a mitad'));
    }
    out.on('error', (err) => settle(reject, err));
    stream.on('error', fail);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('close', onClose);
  });
}

// Cuántas subidas escriben a la vez. Cada una usa poca RAM, pero el EC2 es compartido:
// con el tope evitamos que varias subidas grandes a la vez tiren el contenedor.
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.UPLOAD_CONCURRENCY || '2', 10));
let active = 0;
const waiting = [];

export async function withUploadSlot(fn) {
  // Si no hay hueco, espera; al liberarse, el turno pasa directo al siguiente (no se suelta
  // y se vuelve a tomar), así nunca hay más de MAX_CONCURRENT a la vez.
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

// Borra temporales `.tmp-*` que quedaron de subidas cortadas (el proceso murió a mitad).
// Se hace como mucho cada 10 minutos y solo con archivos de más de 1 hora: sin timers.
const STALE_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
let lastSweep = 0;

export async function sweepStaleTemps(dir) {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return; // la carpeta aún no existe
  }
  for (const name of names) {
    if (!name.startsWith('.tmp-')) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      if (now - info.mtimeMs > STALE_MS) await unlink(file);
    } catch {
      // desapareció mientras revisábamos: nada que hacer
    }
  }
}

// Borra un temporal y su derivado (.webp) si existen. Nunca lanza.
export async function cleanupTemp(file) {
  await unlink(file).catch(() => {});
  await unlink(`${file}.webp`).catch(() => {});
}

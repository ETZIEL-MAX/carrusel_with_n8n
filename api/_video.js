// Revisión de videos subidos, sin dependencias ni ffmpeg.
// Solo se acepta lo que reproducen todos los dispositivos (TV, iPhone, Android, PC):
// contenedor MP4 o MOV con video H.264. No se convierte nada: lo demás se rechaza.

import { open } from 'node:fs/promises';

// El índice (moov) se carga entero en memoria. Un video de 50 MB no pasa de unos pocos MB.
const MAX_MOOV_BYTES = 8 * 1024 * 1024;
const H264 = new Set(['avc1', 'avc3']);
// Códecs de video que NO se aceptan, con el nombre que entiende una persona.
const OTHER_VIDEO = {
  hvc1: 'HEVC/H.265', hev1: 'HEVC/H.265', dvh1: 'Dolby Vision (HEVC)', dvhe: 'Dolby Vision (HEVC)',
  av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 Part 2', s263: 'H.263',
  apcn: 'ProRes', apch: 'ProRes', apcs: 'ProRes', apco: 'ProRes', ap4h: 'ProRes',
  mjp2: 'Motion JPEG 2000', jpeg: 'Motion JPEG', 'mjpa': 'Motion JPEG',
};

// Lo que una Smart TV decodifica sin problema: hasta 1080p y nivel H.264 4.2.
// (4K o niveles más altos se recodifican en el panel antes de subir.)
const MAX_LONG_SIDE = 1920;
const MAX_SHORT_SIDE = 1088; // 1080 redondeado a múltiplo de 16
const MAX_H264_LEVEL = 42;

const fail = (error) => ({ ok: false, error });

// Datos de la pista de video a partir de su caja `stsd` (posición `i` de la marca 'stsd').
// Entrada avc1: [tamaño:4][formato:4][...24][ancho:2][alto:2] ... y dentro, `avcC`:
// [versión][perfil][compatibilidad][nivel].
function readAvcEntry(moov, i) {
  const entry = i + 12;
  if (entry + 36 > moov.length) return null;
  const size = moov.readUInt32BE(entry);
  const end = Math.min(moov.length, entry + size);
  const info = { width: moov.readUInt16BE(entry + 32), height: moov.readUInt16BE(entry + 34), level: 0 };
  const avcC = moov.indexOf('avcC', entry, 'latin1');
  if (avcC !== -1 && avcC + 8 <= end) info.level = moov[avcC + 7];
  return info;
}

// Duración en segundos según `mvhd` (0 si no se puede leer; p. ej. MP4 fragmentado).
function readDuration(moov) {
  const i = moov.indexOf('mvhd', 0, 'latin1');
  if (i === -1) return 0;
  const version = moov[i + 4];
  try {
    const timescale = version === 1 ? moov.readUInt32BE(i + 24) : moov.readUInt32BE(i + 16);
    const duration = version === 1 ? Number(moov.readBigUInt64BE(i + 28)) : moov.readUInt32BE(i + 20);
    if (!timescale || duration === 0xffffffff) return 0;
    return Math.round((duration / timescale) * 100) / 100;
  } catch {
    return 0;
  }
}

// ¿La pista de video está girada 90°/270°? (video vertical de celular: se guarda
// apaisado y una matriz en `tkhd` indica que se muestra girado).
function isRotated(moov) {
  for (let i = moov.indexOf('tkhd', 0, 'latin1'); i !== -1; i = moov.indexOf('tkhd', i + 4, 'latin1')) {
    const version = moov[i + 4];
    const matrix = i + 8 + (version === 1 ? 32 : 20) + 16;
    if (matrix + 44 > moov.length) continue;
    const width = moov.readUInt32BE(matrix + 36);
    if (!width) continue; // pista de audio
    return moov.readInt32BE(matrix) === 0 && moov.readInt32BE(matrix + 4) !== 0;
  }
  return false;
}

// Devuelve { ok: true, container: 'mp4'|'mov', codec: 'avc1', width, height, durationSec,
// faststart } o { ok: false, error }. `width`/`height` son como se ve (ya girado).
export async function inspectVideo(filePath) {
  let file;
  try {
    file = await open(filePath, 'r');
    const { size } = await file.stat();
    const head = Buffer.alloc(16);

    let offset = 0;
    let brand = null;
    let moov = null;
    let sawMdat = false; // ¿los datos van antes que el índice? (arranque lento)
    // Recorre las cajas de primer nivel: [tamaño:4][tipo:4] (o tamaño de 64 bits si es 1).
    for (let guard = 0; offset + 8 <= size && guard < 10000; guard++) {
      const { bytesRead } = await file.read(head, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (bytesRead < 16) break;
        boxSize = Number(head.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset; // hasta el final del archivo
      }
      if (boxSize < headerSize || offset + boxSize > size) break; // archivo cortado o corrupto

      if (offset === 0) {
        if (type !== 'ftyp') return fail('El archivo no es un video MP4 o MOV válido');
        const major = Buffer.alloc(4);
        await file.read(major, 0, 4, offset + headerSize);
        brand = major.toString('latin1');
      } else if (type === 'moov') {
        const bodySize = boxSize - headerSize;
        if (bodySize > MAX_MOOV_BYTES) return fail('El índice del video es demasiado grande');
        moov = Buffer.alloc(bodySize);
        await file.read(moov, 0, bodySize, offset + headerSize);
        break;
      } else if (type === 'mdat') {
        sawMdat = true;
      }
      offset += boxSize;
    }

    if (!brand) return fail('El archivo no es un video MP4 o MOV válido');
    if (!moov) return fail('El video está incompleto o dañado (no tiene índice)');

    // Dentro de moov, cada pista describe su formato en una caja `stsd`:
    // 'stsd' [versión+flags:4] [nº entradas:4] [tamaño entrada:4] [formato:4]
    const formats = new Set();
    let avc = null;
    for (let i = moov.indexOf('stsd', 0, 'latin1'); i !== -1; i = moov.indexOf('stsd', i + 4, 'latin1')) {
      if (i + 20 > moov.length) continue;
      const format = moov.toString('latin1', i + 16, i + 20);
      formats.add(format);
      if (H264.has(format) && !avc) avc = readAvcEntry(moov, i);
    }

    const other = [...formats].find((f) => OTHER_VIDEO[f]);
    if (other) {
      return fail(
        `Este video está en ${OTHER_VIDEO[other]} y no se ve en todos los dispositivos. Expórtalo o grábalo en H.264 (en iPhone: Ajustes → Cámara → Formatos → «Más compatible») y vuelve a subirlo.`
      );
    }
    const h264 = [...formats].find((f) => H264.has(f));
    if (!h264) return fail('El archivo no trae video H.264. Sube un MP4 o MOV en H.264.');

    // Demasiado para una TV: el panel lo habría reducido; aquí solo llega si se saltó ese paso.
    const long = Math.max(avc?.width || 0, avc?.height || 0);
    const short = Math.min(avc?.width || 0, avc?.height || 0);
    if (long > MAX_LONG_SIDE || short > MAX_SHORT_SIDE) {
      return fail(`El video es de ${avc.width}×${avc.height} y muchas pantallas no lo reproducen. Súbelo en 1080p (Full HD) o menos.`);
    }
    if (avc && avc.level > MAX_H264_LEVEL) {
      return fail('El video usa un nivel de H.264 que muchas pantallas no reproducen. Expórtalo en 1080p a 30 fps.');
    }

    const rotated = isRotated(moov);
    return {
      ok: true,
      container: brand.trim() === 'qt' ? 'mov' : 'mp4',
      codec: h264,
      width: (rotated ? avc?.height : avc?.width) || 0,
      height: (rotated ? avc?.width : avc?.height) || 0,
      durationSec: readDuration(moov),
      faststart: !sawMdat,
    };
  } catch {
    return fail('No se pudo leer el video');
  } finally {
    if (file) await file.close().catch(() => {});
  }
}

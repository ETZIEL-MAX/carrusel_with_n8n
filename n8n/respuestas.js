// Respuestas del bot a los comandos del chat. Se pega AL INICIO del nodo "Armar respuesta".
// Sin import/export: va tal cual dentro del nodo.
//
// armarRespuesta(cmd, r, base, anioActual) devuelve lo que usa el resto del flujo:
//   { texto, confirmar, fotoUrl, index, bodyToSign }
// `cmd` = salida de "Detectar ruta" ({ accion, index }); `r` = respuesta de POST /api/manage.
// `confirmar` solo es true al borrar: se muestra la imagen y se pide confirmacion.

var RESP_DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
var RESP_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "2026-10-17" -> "17 oct" (con el año si no es el actual)
function respFecha(ymd, anioActual) {
  var p = String(ymd).split('-'), y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
  return d + ' ' + RESP_MESES[m - 1] + (y === anioActual ? '' : ' ' + y);
}

// { days, from, to } -> "solo vie · 17 oct – 23 nov". Cadena vacia si no hay programacion.
function textoProgramacion(schedule, anioActual) {
  if (!schedule) { return ''; }
  var hoy = anioActual || new Date().getFullYear(), partes = [], i;
  if (schedule.days && schedule.days.length) {
    // De lunes a domingo
    var dias = schedule.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }), nombres = [];
    for (i = 0; i < dias.length; i++) { nombres.push(RESP_DIAS[dias[i]]); }
    partes.push('solo ' + nombres.join(', '));
  }
  if (schedule.from && schedule.to && schedule.from === schedule.to) { partes.push('solo el ' + respFecha(schedule.from, hoy)); }
  else if (schedule.from && schedule.to) { partes.push(respFecha(schedule.from, hoy) + ' – ' + respFecha(schedule.to, hoy)); }
  else if (schedule.from) { partes.push('desde ' + respFecha(schedule.from, hoy)); }
  else if (schedule.to) { partes.push('hasta ' + respFecha(schedule.to, hoy)); }
  return partes.join(' · ');
}

function armarRespuesta(cmd, r, base, anioActual) {
  cmd = cmd || {};
  var NL = String.fromCharCode(10);
  var BASE = base || 'https://carrusel.etziel.com';
  function abs(u) { u = String(u || ''); return u.indexOf('http') === 0 ? u : BASE + (u.charAt(0) === '/' ? '' : '/') + u; }
  var out = { texto: '', confirmar: false, fotoUrl: '', index: 0, bodyToSign: '' };
  var d = (r && r.data) || {};

  if (!r || r.success !== true) {
    out.texto = (r && typeof r.error === 'string' && r.error)
      ? '⚠️ ' + r.error
      : '⚠️ No pude comunicarme con el carrusel. Intenta de nuevo en un momento.';
    return out;
  }

  if (Array.isArray(d.images)) {
    if (cmd.accion === 'delete') {
      var img = null, i;
      for (i = 0; i < d.images.length; i++) { if (d.images[i].index === cmd.index) { img = d.images[i]; break; } }
      if (!img) {
        out.texto = '⚠️ No existe la imagen #' + cmd.index + '; hay ' + d.count + ' en el carrusel. Escribe LISTA para verlas.';
      } else {
        out.confirmar = true;
        out.index = img.index;
        out.fotoUrl = abs(img.url);
        out.texto = '¿Borrar la imagen #' + img.index + ' del carrusel? No se puede deshacer.' + NL + out.fotoUrl;
        // Se borra por id: si alguien reordena mientras confirmas, no se borra otra.
        out.bodyToSign = JSON.stringify({ action: 'delete', id: img.id });
      }
    } else if (!d.images.length) {
      out.texto = 'El carrusel esta vacio.';
    } else {
      var lines = ['Imagenes del carrusel: ' + d.count + ' (por defecto ' + d.slideDuration + ' s)', ''], k, im, estado, prog;
      for (k = 0; k < d.images.length; k++) {
        im = d.images[k];
        estado = '#' + im.index + ' · ' + im.effectiveDuration + ' s' + (im.duration ? '' : ' (por defecto)');
        if (im.suspended) { estado += ' · SUSPENDIDA'; }
        prog = textoProgramacion(im.schedule, anioActual);
        if (prog) { estado += ' · ' + prog; }
        if (!im.suspended && prog && im.visibleNow === false) { estado += ' · hoy no se muestra'; }
        if (im.blur) { estado += ' · difuminado'; }
        lines.push(estado);
        lines.push(abs(im.url));
      }
      var pie = ['', 'DURACION 3 20 · BORRAR 3 · SUSPENDER 3 · PROGRAMAR 3 VIERNES', 'AYUDA = todos los comandos'].join(NL);
      out.texto = lines.join(NL);
      if (out.texto.length > 3900 - pie.length) { out.texto = out.texto.slice(0, 3900 - pie.length - 4) + NL + '...'; }
      out.texto += pie;
    }
    return out;
  }

  var n = d.index, falta;
  if (cmd.accion === 'delete') {
    out.texto = '🗑️ Borrada la imagen #' + n + '. Quedan ' + d.count + ' en el carrusel.';
  } else if (cmd.accion === 'suspend') {
    out.texto = '⏸️ La imagen #' + n + ' quedo suspendida: ya no se muestra, pero no se borro.' + NL + 'Para volver a mostrarla: ACTIVAR ' + n;
  } else if (cmd.accion === 'resume') {
    out.texto = '▶️ La imagen #' + n + ' vuelve a mostrarse.';
    if (d.visibleNow === false) { out.texto += NL + 'Por su programacion, hoy no se muestra. Escribe LISTA para verla.'; }
  } else if (cmd.accion === 'schedule') {
    if (!d.schedule) {
      out.texto = '📅 La imagen #' + n + ' se muestra siempre.';
    } else {
      out.texto = '📅 La imagen #' + n + ' queda programada: ' + textoProgramacion(d.schedule, anioActual) + '.';
      if (!d.suspended && d.visibleNow === false) { out.texto += NL + 'Hoy no se muestra.'; }
      falta = 'Para quitar la programacion: PROGRAMAR ' + n + ' SIEMPRE';
      out.texto += NL + falta;
    }
    if (d.suspended) { out.texto += NL + 'Ojo: sigue suspendida. Para mostrarla: ACTIVAR ' + n; }
  } else if (cmd.accion === 'blur') {
    out.texto = d.blur
      ? '🌫️ La imagen #' + n + ' ahora rellena con fondo difuminado cuando no llena la pantalla.'
      : '⬛ La imagen #' + n + ' ahora deja en negro lo que no llena la pantalla.';
  } else if (d.index === 'all') {
    out.texto = '⏱️ Listo: las imagenes sin duracion propia ahora duran ' + d.slideDuration + ' s.';
  } else {
    out.texto = '⏱️ Listo: la imagen #' + n + ' ahora dura ' + d.duration + ' s.';
  }
  return out;
}

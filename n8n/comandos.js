// Comandos de texto del chat (sin IA). Se pega AL INICIO del nodo "Detectar ruta".
// Sin import/export: va tal cual dentro del nodo.
//
//   LISTA · AYUDA · BORRAR 3 · DURACION 3 20 · DURACION TODAS 12
//   SUSPENDER 3 · ACTIVAR 3
//   PROGRAMAR 3 VIERNES · PROGRAMAR 3 LUNES A VIERNES · PROGRAMAR 3 DEL 17 DE OCT AL 23 DE NOV
//   PROGRAMAR 3 SIEMPRE · DIFUMINAR 3 SI · DIFUMINAR 3 NO
//
// interpretarComando(texto, hoy) devuelve { ruta, accion, index, duracion, bodyToSign }:
//   ruta 'comando' -> bodyToSign es el cuerpo para POST /api/manage/USERx
//   ruta 'ayuda'   -> parecia un comando pero esta mal escrito
// o null si el mensaje no es un comando (sigue al flujo del poster).
// `hoy` = { anio, mes, dia } en la zona del negocio: decide el año de una fecha sin año.

var CMD_ACENTOS = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u' };
var CMD_RELLENO = ['la', 'el', 'las', 'los', 'de', 'a', 'en', 'por', 'imagen', 'foto', 'numero', 'num', 'segundos', 'segundo', 'segs', 'seg', 's'];
var CMD_RELLENO_FECHAS = ['la', 'el', 'las', 'los', 'de', 'del', 'al', 'en', 'por', 'y', 'solo', 'dia', 'dias', 'cada', 'imagen', 'foto', 'numero', 'num'];
var CMD_DIAS = {
  domingo: 0, domingos: 0, dom: 0, lunes: 1, lun: 1, martes: 2, mar: 2, miercoles: 3, mie: 3,
  jueves: 4, jue: 4, viernes: 5, vie: 5, sabado: 6, sabados: 6, sab: 6
};
var CMD_MESES = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12
};

// Minusculas, sin acentos y solo letras y numeros: "17/10" queda "17 10".
function cmdTokens(texto) {
  var t = String(texto || '').toLowerCase(), limpio = '', i, c;
  for (i = 0; i < t.length; i++) {
    c = t.charAt(i);
    if (CMD_ACENTOS[c]) { c = CMD_ACENTOS[c]; }
    limpio += ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === 'ñ') ? c : ' ';
  }
  return limpio.split(' ').filter(function (w) { return w; });
}

// Numero entero escrito con digitos ("20", "20s", "20seg"); null si no lo es.
function cmdEntero(w) {
  w = String(w === undefined || w === null ? '' : w);
  var sufijos = ['segundos', 'segs', 'seg', 's'], i, j;
  for (i = 0; i < sufijos.length; i++) {
    if (w.length > sufijos[i].length && w.slice(-sufijos[i].length) === sufijos[i]) { w = w.slice(0, -sufijos[i].length); break; }
  }
  if (!w || w.length > 5) { return null; }
  for (j = 0; j < w.length; j++) { if (w.charAt(j) < '0' || w.charAt(j) > '9') { return null; } }
  return parseInt(w, 10);
}

// "AAAA-MM-DD" si la fecha existe; null si no (31 de febrero).
function cmdYmd(y, m, d) {
  var f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) { return null; }
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

// Lo que va despues de "PROGRAMAR 3": dias de la semana y/o fechas.
// Devuelve { schedule } (schedule null = siempre) o null si no se entiende.
function cmdProgramacion(tokens, hoy) {
  var t = tokens.filter(function (w) { return CMD_RELLENO_FECHAS.indexOf(w) === -1; });
  if (t.length === 1 && (t[0] === 'siempre' || t[0] === 'todos' || t[0] === 'todas')) { return { schedule: null }; }
  var dias = [], fechas = [], modo = '', ultimoDia = null, rango = false, i = 0, w, n, sig, mes, usados, anio, d, k;
  while (i < t.length) {
    w = t[i];
    if (w === 'desde' || w === 'hasta') { modo = w; i++; continue; }
    if (w === 'a') { rango = ultimoDia !== null; i++; continue; }
    n = cmdEntero(w);
    if (n !== null) {
      // Una fecha: dia + mes (nombre o numero) y, si viene, el año.
      sig = t[i + 1]; mes = null; usados = 1;
      if (sig !== undefined && CMD_MESES[sig]) { mes = CMD_MESES[sig]; usados = 2; }
      else { k = cmdEntero(sig); if (k !== null && k >= 1 && k <= 12) { mes = k; usados = 2; } }
      if (mes === null) { return null; }
      anio = cmdEntero(t[i + usados]);
      if (anio !== null && anio >= 2000 && anio <= 2100) { usados++; } else { anio = null; }
      fechas.push({ d: n, m: mes, y: anio, modo: modo });
      modo = ''; ultimoDia = null; rango = false; i += usados;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(CMD_DIAS, w)) {
      d = CMD_DIAS[w];
      if (rango && ultimoDia !== null) {
        // "lunes a viernes": todos los de en medio (da la vuelta: "viernes a domingo")
        for (k = (ultimoDia + 1) % 7; k !== d; k = (k + 1) % 7) { if (dias.indexOf(k) === -1) { dias.push(k); } }
      }
      if (dias.indexOf(d) === -1) { dias.push(d); }
      ultimoDia = d; rango = false; i++;
      continue;
    }
    return null;
  }
  if (fechas.length > 2 || (!dias.length && !fechas.length)) { return null; }

  var H = hoy || {};
  if (!H.anio || !H.mes || !H.dia) { var ahora = new Date(); H = { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1, dia: ahora.getDate() }; }
  var clave = function (f) { return f.m * 100 + f.d; }, hoyClave = H.mes * 100 + H.dia;
  // Sin año: la proxima vez que toque (si ya paso este año, el siguiente).
  var proximo = function (f) { return f.y || (clave(f) >= hoyClave ? H.anio : H.anio + 1); };
  var desde = null, hasta = null, a, b, ya, yb;
  if (fechas.length === 2) {
    a = fechas[0]; b = fechas[1];
    yb = proximo(b);
    ya = a.y || (clave(a) <= clave(b) ? yb : yb - 1); // "15 dic al 10 ene" empieza el año anterior
    desde = cmdYmd(ya, a.m, a.d); hasta = cmdYmd(yb, b.m, b.d);
    if (!desde || !hasta || desde > hasta) { return null; }
  } else if (fechas.length === 1) {
    a = fechas[0];
    if (a.modo === 'desde') {
      // Un "desde" de hace poco ya empezo (este año); uno de hace mas de 6 meses es el que viene.
      ya = a.y || (clave(a) >= hoyClave || ((H.mes - a.m + 12) % 12) <= 6 ? H.anio : H.anio + 1);
      desde = cmdYmd(ya, a.m, a.d);
      if (!desde) { return null; }
    } else {
      hasta = cmdYmd(proximo(a), a.m, a.d);
      if (!hasta) { return null; }
      if (a.modo !== 'hasta') { desde = hasta; } // una sola fecha = solo ese dia
    }
  }
  dias.sort(function (x, y) { return x - y; });
  return { schedule: { days: dias.length ? dias : null, from: desde, to: hasta } };
}

function interpretarComando(texto, hoy) {
  var crudo = cmdTokens(texto);
  var f = crudo.filter(function (w) { return CMD_RELLENO.indexOf(w) === -1; });
  if (!f.length) { return null; }
  var comando = function (accion, index, cuerpo, duracion) {
    return { ruta: 'comando', accion: accion, index: index, duracion: duracion || 0, bodyToSign: JSON.stringify(cuerpo) };
  };
  var AYUDA = { ruta: 'ayuda', accion: '', index: 0, duracion: 0, bodyToSign: '' };
  // Un comando nuevo mal escrito muestra la ayuda solo si el mensaje es corto o trae el numero:
  // "pausa para el cafe 2x1" es un poster, no un comando.
  var malEscrito = function () { return (f.length <= 2 || cmdEntero(f[1]) !== null) ? AYUDA : null; };
  var v = f[0], n, idx, seg, todas;

  if (f.length === 1 && (v === 'lista' || v === 'listar')) { return comando('list', 0, { action: 'list' }); }
  if (f.length === 1 && (v === 'ayuda' || v === 'comandos')) { return AYUDA; }

  if (['borrar', 'borra', 'eliminar', 'elimina'].indexOf(v) !== -1) {
    n = f.length === 2 ? cmdEntero(f[1]) : null;
    // Primero se pide la lista para mostrar la imagen y confirmar; el borrado se firma despues.
    return (n !== null && n > 0) ? comando('delete', n, { action: 'list' }) : AYUDA;
  }

  if (v === 'duracion' || v === 'tiempo') {
    todas = f.length === 3 && ['todas', 'todos', 'todo'].indexOf(f[1]) !== -1;
    idx = f.length === 3 ? cmdEntero(f[1]) : null;
    seg = f.length === 3 ? cmdEntero(f[2]) : null;
    if (seg !== null && (todas || (idx !== null && idx > 0))) {
      return comando('duration', todas ? 'all' : idx, { action: 'duration', index: todas ? 'all' : idx, duration: seg }, seg);
    }
    return v === 'duracion' ? AYUDA : null;
  }

  var esSuspender = ['suspender', 'suspende', 'pausar', 'pausa', 'ocultar', 'oculta'].indexOf(v) !== -1;
  var esActivar = ['activar', 'activa', 'reactivar', 'reactiva', 'mostrar', 'muestra'].indexOf(v) !== -1;
  if (esSuspender || esActivar) {
    n = f.length === 2 ? cmdEntero(f[1]) : null;
    if (n !== null && n > 0) { return comando(esSuspender ? 'suspend' : 'resume', n, { action: esSuspender ? 'suspend' : 'resume', index: n }); }
    return malEscrito();
  }

  if (['difuminar', 'difumina', 'difuminado', 'blur'].indexOf(v) !== -1) {
    n = (f.length === 2 || f.length === 3) ? cmdEntero(f[1]) : null;
    var encender = true, valido = n !== null && n > 0;
    if (valido && f.length === 3) {
      if (['si', 'on', 'poner', 'pon', 'activar', 'encender'].indexOf(f[2]) !== -1) { encender = true; }
      else if (['no', 'off', 'quitar', 'quita', 'sin', 'apagar'].indexOf(f[2]) !== -1) { encender = false; }
      else { valido = false; }
    }
    if (valido) { return comando('blur', n, { action: 'blur', index: n, blur: encender }); }
    return malEscrito();
  }

  if (['programar', 'programa', 'agendar', 'agenda'].indexOf(v) !== -1) {
    // Aqui "a" importa ("lunes a viernes"): se usa el texto sin quitarle el relleno general.
    var resto = crudo.slice(1), p = 0;
    while (p < resto.length && CMD_RELLENO_FECHAS.indexOf(resto[p]) !== -1) { p++; }
    n = cmdEntero(resto[p]);
    if (n === null || n <= 0) { return malEscrito(); }
    var r = cmdProgramacion(resto.slice(p + 1), hoy);
    return r ? comando('schedule', n, { action: 'schedule', index: n, schedule: r.schedule }) : AYUDA;
  }

  return null;
}

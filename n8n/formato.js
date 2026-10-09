// Tamaño del póster y zona del logo. Se pega AL INICIO de los nodos "Init contexto",
// "Armar prompt", "Parsear salida", "Calcular posicion" y "Preparar Wan" (cada nodo Code
// lleva su propia copia). Sin import/export: va tal cual dentro del nodo.

// Tabla Full HD de siempre: se usa si el servidor no manda el tamaño (servidor viejo)
// o manda uno que no sirve. La tabla por resolución vive en api/_utils.js (posterSize).
var FORMATOS_FULLHD = {
  horizontal: { ancho: 1920, alto: 1080, texto: 'horizontal 16:9' },
  vertical: { ancho: 1080, alto: 1920, texto: 'vertical 9:16' },
  cuadrado: { ancho: 1080, alto: 1080, texto: 'cuadrado 1:1' },
  horizontal43: { ancho: 1440, alto: 1080, texto: 'horizontal 4:3' },
  vertical34: { ancho: 1080, alto: 1440, texto: 'vertical 3:4' }
};

// `cfg` = data de POST /api/settings-read (defaultOrientation, posterWidth, posterHeight).
// Devuelve { formato, ancho, alto, texto }. El tamaño del servidor solo se acepta si son
// enteros entre 256 y 4096.
function tamanoPoster(cfg) {
  var c = cfg || {};
  var fo = String(c.defaultOrientation || '');
  var formato = Object.prototype.hasOwnProperty.call(FORMATOS_FULLHD, fo) ? fo : 'horizontal';
  var base = FORMATOS_FULLHD[formato];
  var w = c.posterWidth, h = c.posterHeight;
  var valido = function (n) { return typeof n === 'number' && n % 1 === 0 && n >= 256 && n <= 4096; };
  if (valido(w) && valido(h)) { return { formato: formato, ancho: w, alto: h, texto: base.texto }; }
  return { formato: formato, ancho: base.ancho, alto: base.alto, texto: base.texto };
}

// El logo mide 420x224 con 50 px de margen en un Full HD (2 073 600 px). Con otro tamaño
// se escala con la raiz del area, para que el logo se vea igual de grande respecto al poster.
// zonaAnchoPct / zonaAltoPct = rectangulo de la esquina inferior derecha que debe quedar
// libre (logo + margen + un colchon de 40 px escalados), en porcentaje del lienzo.
function zonaLogo(ancho, alto) {
  var an = Number(ancho) || 1920, al = Number(alto) || 1080;
  var escala = Math.sqrt(an * al / 2073600);
  var logoAncho = Math.round(420 * escala), logoAlto = Math.round(224 * escala);
  var margen = Math.round(50 * escala), colchon = Math.round(40 * escala);
  return {
    logoAncho: logoAncho,
    logoAlto: logoAlto,
    margen: margen,
    zonaAnchoPct: Math.ceil((logoAncho + margen + colchon) / an * 100),
    zonaAltoPct: Math.ceil((logoAlto + margen + colchon) / al * 100)
  };
}

// Esquina inferior derecha del poster REAL (el generador puede devolver otro tamaño).
// Nunca negativa: si el poster es mas chico que el logo, el logo queda en (0, 0).
function posicionLogo(posterAncho, posterAlto, logoAncho, logoAlto, margen) {
  return {
    posX: Math.max(0, Math.round(posterAncho - logoAncho - margen)),
    posY: Math.max(0, Math.round(posterAlto - logoAlto - margen))
  };
}

// Tamaño que se le pide al generador: misma proporcion, lado mayor <= maxLado, medidas pares.
// El nodo "Optimizar imagen" lleva despues el resultado al tamaño exacto del panel.
function tamanoGeneracion(ancho, alto, maxLado) {
  var mayor = Math.max(ancho, alto);
  var k = mayor > maxLado ? maxLado / mayor : 1;
  var par = function (n) { return Math.max(2, 2 * Math.round(n * k / 2)); };
  return { ancho: par(ancho), alto: par(alto) };
}

// Reglas finales fijas que se agregan al prompt (no dependen de la IA): formato del panel,
// textos que quepan, escena a lienzo completo y esquina del logo.
function reglasLayout(ancho, alto) {
  var an = Number(ancho) || 1920, al = Number(alto) || 1080;
  var ori = an === al ? 'SQUARE' : (an > al ? 'HORIZONTAL (landscape)' : 'VERTICAL (portrait)');
  var z = zonaLogo(an, al);
  return ' FINAL LAYOUT RULES (highest priority, they override anything above):'
    + ' 1) FORMAT: this is a ' + ori + ' poster on a canvas of EXACTLY ' + an + 'x' + al + ' pixels. Compose the whole scene for this canvas and fill it edge to edge; ignore the aspect ratio of the product reference photo.'
    + ' 2) TEXT FIT: every text must be completely visible inside the canvas, with a safe margin of at least 6 percent on all four sides. Reduce the font size until each line fits; never crop, clip, overlap or let any letter or number touch or cross an edge. Keep each text on one or two short lines and well separated from the other texts and from the product.'
    + ' 3) FULL BLEED: the scene and its background must cover the whole canvas edge to edge, including the entire right side. Never leave a blank, white or empty half, band or column.'
    + ' 4) LOGO CORNER: only the bottom-right corner, a rectangle about ' + z.zonaAnchoPct + ' percent of the width and ' + z.zonaAltoPct + ' percent of the height, must be free of product, text, price, badges and icons. Do not leave it white or cut out: the same scene background continues there, smooth, light and low in detail, so a black logo placed later stays readable. Do not draw any logo, frame or box. Texts and price may go anywhere else, including the right side above that corner.';
}

// Mensajes para el modelo que redacta el prompt del póster. Se pega en el nodo "Armar prompt",
// DESPUES de n8n/formato.js (usa zonaLogo). Sin import/export.
//
// Las instrucciones se editan en n8n, en el nodo "Instrucciones del director" (campos `reglas`,
// `con_logo` y `sin_logo`). Los tres textos de abajo son los de fabrica: con ellos se crea ese
// nodo y son los que se usan si un campo se deja vacio.
//
// Marcadores que se rellenan solos:
//   [FORMATO]     formato y tamaño del poster, p. ej. "vertical 9:16, EXACTAMENTE 1080x1920 pixeles"
//   [ANCHO] [ALTO]  medidas del lienzo en pixeles
//   [ZONA_ANCHO] [ZONA_ALTO]  porcentaje del lienzo que ocupa la esquina del logo
//   [LOGO]        aqui va el parrafo `con_logo` o `sin_logo`, segun lo que pidio el cliente
var REGLAS_DIRECTOR = [
  'Eres DIRECTOR CREATIVO PUBLICITARIO y experto en PROMPTS para generadores de imagenes.',
  'Del MENSAJE del cliente identifica TRES cosas: PRODUCTO (el producto o servicio que se vende, o el AVISO que se quiere comunicar), PRECIO (solo si el cliente lo da) e INFORMACION ADICIONAL (cantidad, medidas, modelo, caracteristicas, promocion u otros datos).',
  'JERARQUIA: 1) PRODUCTO, 2) PRECIO, 3) INFORMACION ADICIONAL.',
  'Si PRODUCTO ACTUAL trae valor, esa es la fuente autoritativa del producto; si viene vacio, extrae el producto del MENSAJE. El precio y la info adicional se extraen del MENSAJE. NO inventes ni cambies ningun dato; NO inventes precio si no lo dan.',
  'REGLA CRITICA DE VALIDEZ: si existe un producto, servicio o aviso razonablemente identificable, SIEMPRE genera el JSON del anuncio. NO devuelvas FALSE por falta de precio. NO devuelvas FALSE por falta de foto. NO devuelvas FALSE por falta de informacion adicional. NO devuelvas FALSE porque el mensaje sea corto. NO hagas preguntas ni pidas aclaraciones. Responde FALSE UNICAMENTE si el MENSAJE es un saludo o charla sin ningun producto, servicio ni aviso (por ejemplo: hola, buenos dias, gracias, ok, jaja). Ante la duda NUNCA respondas FALSE: genera el anuncio.',
  'AVISOS: el poster tambien puede ser un AVISO o comunicado, sin producto ni precio (por ejemplo: "Cerrado el lunes por dia festivo", "Nuevo horario de 9 a 6", "Se solicita personal", "Feliz dia de las madres"). En ese caso el texto del aviso es el HEROE: grande, claro y muy legible, sobre una escena o ilustracion acorde al negocio y al tema; no inventes productos, precios ni datos, y en la clave producto pon un titulo corto del aviso.',
  'El prompt_final (en ingles) debe lograr: poster publicitario profesional nivel agencia, [FORMATO]; el PRODUCTO es el HEROE visual, grande, claro, reconocible y fotorrealista, con iluminacion profesional y una escena premium adaptada al producto (no una foto plana sobre fondo liso); el PRECIO (si existe) es el segundo elemento mas importante, grande y llamativo; la INFORMACION ADICIONAL va como texto secundario mas pequeno tipo badge o etiqueta.',
  'TEXTO EN LA IMAGEN: TODO en ESPANOL y en MAYUSCULAS, ortografia perfecta con acentos y la enie, tipografia publicitaria grande, nitida y muy legible; indica de forma EXPLICITA y entre comillas dobles los textos EXACTOS que debe renderizar el generador, tomados tal cual del MENSAJE (producto, precio si existe, info adicional); nada de texto en ingles, falso, aleatorio ni lorem ipsum; NO cambies numeros, precios, unidades ni cantidades.',
  'CANVAS: todo el producto, el precio y el texto deben quedar COMPLETAMENTE dentro del lienzo [ANCHO]x[ALTO], con margen de seguridad en los cuatro bordes; NINGUNA letra, numero, acento ni enie puede quedar cortada; si el texto no cabe, reduce el tamano, nunca lo elimines.',
  'COMPOSICION COMPLETA: la escena, el fondo y la iluminacion deben cubrir el 100 por ciento del lienzo, de borde a borde, incluido todo el lado derecho. PROHIBIDO dejar una mitad, franja o columna vacia, blanca o sin escena. Reparte producto, precio y textos en todo el ancho.',
  '[LOGO]',
  'La direccion de arte se adapta al producto (no todo neon, futurista ni metalico) y la claridad comercial SIEMPRE tiene prioridad sobre los efectos.',
  'RONDAS: si la ronda es mayor a 1, usa el PROMPT ANTERIOR como base, conserva lo que ya funciona, aplica el cambio pedido y mejora la calidad sin cambiar el producto, el precio ni los datos del cliente.',
  'FORMATO DE RESPUESTA OBLIGATORIO: responde UNICAMENTE con un objeto JSON valido, con comillas dobles, sin markdown, sin explicaciones y sin texto antes ni despues, con exactamente dos claves: producto (nombre corto del producto en espanol) y prompt_final (el prompt completo en ingles para el generador).'
].join('\n\n');

var LOGO_CON = 'LOGO: NO generes, dibujes ni insinues ningun logo, marca, emblema ni watermark. El logo se sobrepone despues, encima de la imagen ya terminada, en la esquina INFERIOR DERECHA (aproximadamente [ZONA_ANCHO] por ciento del ancho y [ZONA_ALTO] por ciento del alto): solo evita poner ahi textos, precio, badges o rostros, porque quedarian tapados. NO prepares nada para el logo: PROHIBIDO crear una franja, linea, columna, banda, panel, recuadro, marco o zona de otro color a la derecha o abajo. La escena y su fondo siguen ahi exactamente igual que en el resto de la imagen.';

var LOGO_SIN = 'SIN LOGO: el cliente pidio este poster sin logo. NO generes, dibujes ni insinues ningun logo, marca, emblema ni watermark, y NO reserves ninguna esquina: usa todo el lienzo para la escena, el producto y los textos. La frase con la que el cliente pide que no lleve logo es una instruccion, no es un texto del anuncio: no la escribas en la imagen.';

// Devuelve `texto` si trae algo; si viene vacio o en blanco, el de fabrica.
function textoEditable(texto, deFabrica) {
  return (typeof texto === 'string' && texto.replace(/\s/g, '') !== '') ? texto : deFabrica;
}

// `item` = { texto, producto, ronda, prompt_base, colorPalette } (lo que sale de "Init contexto"
// o "Ronda tope") mas { reglas, con_logo, sin_logo } de "Instrucciones del director".
// `ctx` = { ancho, alto, formato_texto, lleva_logo } (de "Init contexto").
// Devuelve los dos mensajes del chat: instrucciones (system) y datos del cliente (user).
function armarMensajes(item, ctx) {
  var it = item || {}, c = ctx || {};
  var an = Number(c.ancho) || 1920, al = Number(c.alto) || 1080;
  var z = zonaLogo(an, al);
  var reglas = textoEditable(it.reglas, REGLAS_DIRECTOR);
  var logo = c.lleva_logo === false ? textoEditable(it.sin_logo, LOGO_SIN) : textoEditable(it.con_logo, LOGO_CON);
  var system = reglas.indexOf('[LOGO]') === -1 ? reglas + '\n\n' + logo : reglas.split('[LOGO]').join(logo);
  var valores = { FORMATO: c.formato_texto || '', ANCHO: an, ALTO: al, ZONA_ANCHO: z.zonaAnchoPct, ZONA_ALTO: z.zonaAltoPct };
  for (var k in valores) { system = system.split('[' + k + ']').join(String(valores[k])); }
  var paleta = (it.colorPalette && it.colorPalette.length)
    ? 'PALETA: usa EXACTAMENTE estos colores HEX como base: ' + it.colorPalette.join(', ') + '. '
    : 'PALETA: elige una paleta publicitaria de alto impacto acorde al producto. ';
  var user = paleta + 'PRODUCTO ACTUAL: ' + (it.producto || '') + '. MENSAJE DEL CLIENTE: ' + (it.texto || '')
    + '. RONDA: ' + (it.ronda || 0) + '. PROMPT ANTERIOR: ' + (it.prompt_base || '');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// JEV: el clasificador de mensajes. Se pega AL INICIO del nodo "Detectar ruta", antes de
// n8n/comandos.js. Sin import/export.
//
// El nodo "JEV" (HTTP Request) llama a POST https://jevmodel.org/v1/systemone con el mensaje del
// cliente (`state`) y unas preguntas (`questions`). JEV no escribe texto: contesta cada pregunta
// con una opcion (`choice`) o una probabilidad de si/no (`noul`). `leerClasificacion` convierte
// esa respuesta en lo que usa el flujo.
//
// Las preguntas se editan en n8n, en el cuerpo JSON del nodo JEV: las de abajo son las de
// fabrica, con las que se crea el nodo. Los NOMBRES de las preguntas y de las opciones (tipo,
// sin_logo, accion, imagen, poster, comando, borrar...) no se cambian: los lee este codigo.
// No hay filtro de spam: todo lo que no es un comando genera un poster.
var PREGUNTAS_JEV = {
  tipo: {
    type: 'choice',
    instructions: 'Un cliente le escribe por WhatsApp a un bot que crea posters publicitarios y los muestra en un carrusel de imagenes (pantallas de un negocio). Que quiere con este mensaje? Es comando solo si habla claramente de las imagenes que ya estan en el carrusel; en cualquier otro caso es poster.',
    criteria: {
      poster: 'Quiere un poster: nombra un producto, servicio, promocion, precio o evento, da un aviso o comunicado (horario, cierre, felicitacion, se solicita personal), pide un cambio a un poster, o cualquier otro mensaje. Ejemplos: "Tacos al pastor 3x50 solo hoy", "Cerrado el lunes por dia festivo".',
      comando: 'Quiere administrar las imagenes que YA estan en el carrusel: verlas, borrar una, suspenderla, volver a mostrarla, programarla, cambiar cuanto dura, difuminar su fondo, o pide ayuda. Ejemplos: "ya no muestres la segunda", "quitame la 4", "que imagenes tengo?".'
    }
  },
  sin_logo: {
    type: 'noul',
    instructions: 'El cliente pide de forma explicita que el poster NO lleve logo? (por ejemplo: "sin logo", "no le pongas el logo", "sin marca"). Si no lo menciona, la respuesta es no.'
  },
  accion: {
    type: 'choice',
    instructions: 'Si el mensaje es una orden sobre las imagenes del carrusel, cual es? Si no es una orden, elige otra.',
    criteria: {
      lista: 'Ver que imagenes hay en el carrusel',
      ayuda: 'Pide ayuda o la lista de comandos',
      borrar: 'Borrar, eliminar o quitar una imagen para siempre',
      suspender: 'Dejar de mostrar, pausar u ocultar una imagen sin borrarla',
      activar: 'Volver a mostrar una imagen suspendida',
      difuminar: 'Poner el fondo difuminado a una imagen',
      quitar_difuminado: 'Quitar el fondo difuminado (dejarlo negro)',
      otra: 'Programar dias o fechas, cambiar la duracion, cualquier otra orden, o no es una orden'
    }
  },
  imagen: {
    type: 'choice',
    instructions: 'De que imagen del carrusel habla el mensaje? Por su numero o posicion: "la primera" es imagen_1, "la segunda" o "la 2" es imagen_2. Los precios y cantidades de un anuncio no son numeros de imagen.',
    criteria: {
      ninguna: 'No menciona ninguna imagen del carrusel',
      imagen_1: 'Imagen 1 (la primera)', imagen_2: 'Imagen 2 (la segunda)', imagen_3: 'Imagen 3 (la tercera)',
      imagen_4: 'Imagen 4 (la cuarta)', imagen_5: 'Imagen 5 (la quinta)', imagen_6: 'Imagen 6 (la sexta)',
      imagen_7: 'Imagen 7', imagen_8: 'Imagen 8', imagen_9: 'Imagen 9', imagen_10: 'Imagen 10',
      imagen_11: 'Imagen 11', imagen_12: 'Imagen 12'
    }
  }
};

// Que tan seguro tiene que estar JEV (0 a 1) para que se le haga caso. Por debajo de esto un
// "comando" se trata como poster, y el poster lleva logo.
var JEV_SEGURIDAD_MINIMA = 0.6;

// Ordenes que JEV puede armar completas. Las que llevan datos (PROGRAMAR, DURACION) no:
// esas solo se entienden escritas en su forma normal (n8n/comandos.js).
var JEV_ORDENES = { lista: 'LISTA', ayuda: 'AYUDA', borrar: 'BORRAR N', suspender: 'SUSPENDER N', activar: 'ACTIVAR N', difuminar: 'DIFUMINAR N SI', quitar_difuminado: 'DIFUMINAR N NO' };

// `respuesta` = el JSON que contesto JEV: { answers: { tipo, sin_logo, accion, imagen }, usage }.
// Devuelve { tipo: 'poster' | 'comando', logo: true | false, comando: '' } o null si
// no se entiende (JEV fallo o contesto otra cosa): con null el flujo sigue como si no existiera.
// `comando` es la orden en su forma normal ("SUSPENDER 2") o '' si JEV no pudo armarla.
function leerClasificacion(respuesta) {
  var r = respuesta;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return null; } }
  var a = r && typeof r === 'object' ? r.answers : null;
  if (!a || typeof a !== 'object' || !a.tipo || typeof a.tipo !== 'object') { return null; }
  var tipo = a.tipo.choice;
  if (tipo !== 'poster' && tipo !== 'comando') { return null; }
  var seguro = typeof a.tipo.confidence !== 'number' || a.tipo.confidence >= JEV_SEGURIDAD_MINIMA;
  if (!seguro) { tipo = 'poster'; }
  var sinLogo = !!a.sin_logo && typeof a.sin_logo.noul === 'number' && a.sin_logo.noul >= JEV_SEGURIDAD_MINIMA;
  var comando = '';
  if (tipo === 'comando') {
    var orden = a.accion && Object.prototype.hasOwnProperty.call(JEV_ORDENES, a.accion.choice) ? JEV_ORDENES[a.accion.choice] : '';
    var n = a.imagen && typeof a.imagen.choice === 'string' && a.imagen.choice.indexOf('imagen_') === 0 ? parseInt(a.imagen.choice.slice(7), 10) : 0;
    if (orden.indexOf(' N') === -1) { comando = orden; }
    else if (n > 0) { comando = orden.replace(' N', ' ' + n); }
  }
  return { tipo: tipo, logo: !sinLogo, comando: comando };
}

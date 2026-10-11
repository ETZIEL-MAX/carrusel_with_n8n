// Espera de 5 segundos: junta los mensajes de texto que un cliente manda seguidos y contesta una
// sola vez, 5 segundos despues del ultimo. Se pega en el nodo "Juntar mensajes". Sin import/export.
//
// Cada mensaje de texto se guarda en la tabla `whatsapp_espera`, espera 5 segundos y despues lee
// las filas de ese numero. Si mientras tanto llego otro mensaje, este se retira (contestara el
// ultimo); si sigue siendo el ultimo, se lleva el texto de todos.
var ESPERA_VIGENCIA_MS = 60000; // una fila mas vieja que esto quedo de una ejecucion que fallo: se ignora

// `filas` = filas de whatsapp_espera de este numero ({ id, mensaje_id, texto, createdAt }).
// `miId` y `miTexto` = id y texto del mensaje de esta ejecucion. `ahoraMs` = hora actual.
// Devuelve { seguir: false } si hay un mensaje mas nuevo, o { seguir: true, texto, mensajes }.
function juntarMensajes(filas, miId, miTexto, ahoraMs) {
  var ahora = ahoraMs === undefined ? Date.now() : ahoraMs, vivas = [], i, f, t;
  for (i = 0; i < (filas || []).length; i++) {
    f = filas[i] || {};
    if (!f.mensaje_id) { continue; }
    t = f.createdAt ? new Date(f.createdAt).getTime() : ahora;
    if (!(ahora - t <= ESPERA_VIGENCIA_MS)) { continue; }
    vivas.push({ id: Number(f.id) || 0, mensaje_id: String(f.mensaje_id), texto: String(f.texto === undefined || f.texto === null ? '' : f.texto) });
  }
  vivas.sort(function (a, b) { return a.id - b.id; });
  var mia = false;
  for (i = 0; i < vivas.length; i++) { if (vivas[i].mensaje_id === String(miId)) { mia = true; } }
  // Si mi fila ya no esta (otra ejecucion vacio la tabla justo antes), contesto solo con lo mio.
  if (!vivas.length || !mia) { return { seguir: true, texto: String(miTexto || ''), mensajes: 1 }; }
  if (vivas[vivas.length - 1].mensaje_id !== String(miId)) { return { seguir: false }; }
  var partes = [];
  for (i = 0; i < vivas.length; i++) { if (vivas[i].texto.replace(/\s/g, '') !== '') { partes.push(vivas[i].texto); } }
  return { seguir: true, texto: partes.join('\n'), mensajes: vivas.length };
}

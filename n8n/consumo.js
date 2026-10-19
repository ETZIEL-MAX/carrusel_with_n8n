// Reporte de consumo al carrusel (POST /api/usage/USERx). Se pega en el nodo "Firmar consumo".
// `gen` es la salida de uno de estos nodos:
//  - "Generar Wan" ({ model, imageUrl, usage }) o "Generar Qwen" (sin model ni usage): una imagen.
//  - "Redactar prompt" o "Transcribir audio": una respuesta de chat de OpenRouter
//    ({ model, choices, usage }): tokens de texto.
//  - "JEV": la respuesta del clasificador ({ model, answers, usage }): tokens de texto.
//  - Un nodo de WhatsApp que envia: un mensaje del bot al cliente. "send" devuelve la respuesta
//    de Meta ({ messaging_product: 'whatsapp', messages: [{ id }] }); "sendAndWait" devuelve la
//    respuesta del cliente ({ data: { approved } }), que tambien fue un mensaje enviado.
// Un evento por llamada: el eventId evita contarla dos veces. Devuelve null si no hay nada
// que reportar (un texto sin tokens).
function armarConsumo(gen, executionId, runIndex) {
  var g = gen || {};
  // Un nodo HTTP en continueRegularOutput (la transcripcion) deja { error } si falla:
  // no hubo consumo que reportar.
  if (g.error) { return null; }
  if (g.messaging_product === 'whatsapp' && Array.isArray(g.messages)) {
    var id = g.messages[0] && g.messages[0].id;
    return { eventId: String(executionId) + '-msg-' + (id ? String(id) : String(runIndex)), kind: 'message', count: 1 };
  }
  if (g.data && typeof g.data === 'object' && typeof g.data.approved === 'boolean') {
    return { eventId: String(executionId) + '-msg-' + String(runIndex), kind: 'message', count: 1 };
  }
  if (Array.isArray(g.choices)) { return armarConsumoTexto(g, executionId, runIndex, 'txt'); }
  if (g.answers && typeof g.answers === 'object') { return armarConsumoTexto(g, executionId, runIndex, 'jev'); }
  var out = {
    eventId: String(executionId) + '-gen-' + String(runIndex),
    kind: 'image',
    model: g.model || 'qwen-image-3.0-pro',
    count: 1
  };
  // Los tokens solo se mandan si el proveedor los dio; sin ellos la imagen entra
  // en el costo aproximado del panel.
  var u = g.usage, campos = ['total_tokens', 'input_tokens', 'output_tokens', 'total', 'input', 'output'], i;
  if (u && typeof u === 'object') {
    for (i = 0; i < campos.length; i++) {
      if (typeof u[campos[i]] === 'number' && u[campos[i]] > 0) { out.tokens = u; break; }
    }
  }
  return out;
}

// Texto o audio transcrito: solo cuenta si el proveedor dio tokens.
function armarConsumoTexto(g, executionId, runIndex, sufijo) {
  var u = g.usage, campos = ['total_tokens', 'prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens'], i;
  if (u && typeof u === 'object') {
    for (i = 0; i < campos.length; i++) {
      if (typeof u[campos[i]] === 'number' && u[campos[i]] > 0) {
        return { eventId: String(executionId) + '-' + sufijo + '-' + String(runIndex), kind: 'text', model: g.model || 'texto', tokens: u };
      }
    }
  }
  return null;
}

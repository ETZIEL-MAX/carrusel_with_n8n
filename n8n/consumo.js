// Reporte de consumo al carrusel (POST /api/usage/USERx). Se pega en el nodo "Firmar consumo".
// `gen` es la salida de uno de estos nodos:
//  - "Generar Wan" ({ model, imageUrl, usage }) o "Generar Qwen" (sin model ni usage): una imagen.
//  - "Redactar prompt" o "Transcribir audio": una respuesta de chat de OpenRouter
//    ({ model, choices, usage }): tokens de texto.
// Un evento por llamada: el eventId evita contarla dos veces. Devuelve null si no hay nada
// que reportar (un texto sin tokens).
function armarConsumo(gen, executionId, runIndex) {
  var g = gen || {};
  if (Array.isArray(g.choices)) { return armarConsumoTexto(g, executionId, runIndex); }
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
function armarConsumoTexto(g, executionId, runIndex) {
  var u = g.usage, campos = ['total_tokens', 'prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens'], i;
  if (u && typeof u === 'object') {
    for (i = 0; i < campos.length; i++) {
      if (typeof u[campos[i]] === 'number' && u[campos[i]] > 0) {
        return { eventId: String(executionId) + '-txt-' + String(runIndex), kind: 'text', model: g.model || 'texto', tokens: u };
      }
    }
  }
  return null;
}

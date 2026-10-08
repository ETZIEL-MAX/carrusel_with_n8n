// Reporte de consumo al carrusel (POST /api/usage/USERx). Se pega en el nodo "Firmar consumo".
// `gen` es lo que sale de "Generar Wan" ({ model, imageUrl, usage }) o de "Generar Qwen"
// (sin model ni usage). Un evento por generacion: el eventId evita contarla dos veces.
function armarConsumo(gen, executionId, runIndex) {
  var g = gen || {};
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

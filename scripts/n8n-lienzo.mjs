// Acomoda los nodos del flujo de n8n en el lienzo: 12 secciones, cada una con su nota.
// Lo usa scripts/n8n-patch-flujo.mjs como último paso.
//
// OJO: con `executionOrder: v1`, cuando un nodo manda su salida a varios nodos, n8n corre primero
// el que está más ARRIBA en el lienzo (y, si empatan, el de más a la izquierda). Mover un nodo
// puede cambiar el orden en que corren dos ramas. `ordenarLienzo` se niega a acomodar si ese
// orden cambia.

const DX = 240; // ancho de una columna
const DY = 200; // alto de un renglón

// Cada sección: título, texto de la nota, color, y sus nodos como nombre -> [columna, renglón].
// El renglón 0 es la línea de entrada; las bandas de abajo empiezan en 5, 9 y 13.
export const SECCIONES = [
  {
    n: 1, titulo: 'Entrada y token', color: 7,
    texto: 'Llega el mensaje desde RECEPCIONISTA_WHATSAPP. Se busca la fila del cliente en la tabla `whatsapp_numeros`: de ahí sale su carrusel y el token con el que se firma todo.',
    nodos: { 'WhatsApp Trigger': [0, 0], 'Buscar token': [1, 0], 'Adjuntar token': [2, 0], Variables: [3, 0], 'Solo mi numero': [4, 0] },
  },
  {
    n: 2, titulo: 'Audio', color: 7,
    texto: 'Si el mensaje es una nota de voz, se descarga y se transcribe. El texto resultante se trata igual que un mensaje escrito.',
    nodos: { 'Es audio': [5, 0], 'Descargar audio': [6, -1], 'Bajar audio': [7, -1], 'Audio a base64': [8, -1], 'Transcribir audio': [9, -1] },
  },
  {
    n: 3, titulo: 'Ajustes del panel', color: 7,
    texto: 'Lee del panel web la carpeta de Drive, la paleta y el tamaño del póster.',
    nodos: { 'Firmar settings': [10, 0], 'Traer settings': [11, 0] },
  },
  {
    n: 4, titulo: 'JEV: ¿qué quiere el cliente?', color: 4,
    texto: '**JEV** (llamada HTTP al modelo de jevmodel.org) lee el mensaje y decide: **póster con logo**, **póster sin logo** o **comando**. Sus preguntas se editan en el nodo `JEV` → cuerpo JSON (`questions`); la llave va en la cabecera `Authorization`.\n`Detectar ruta` junta todo y reparte: una foto va a Drive (5); un comando va a (6); lo demás genera un póster (7).',
    nodos: {
      'Hay texto': [12, 0], JEV: [13, 0], 'Detectar ruta': [14, 0],
      'Es foto': [15, 0], 'Es comando': [16, 0], 'Es ayuda': [17, 0], 'Enviar ayuda': [18, -1],
    },
  },
  {
    n: 5, titulo: 'Foto → Drive', color: 5,
    texto: 'Una foto enviada por WhatsApp se guarda en la carpeta de Drive del cliente; el pie de foto es el nombre del archivo. No pasa por JEV.',
    nodos: {
      'Tiene carpeta': [0, 5], 'Descargar foto enviada': [1, 5], 'Bajar foto enviada': [2, 5], 'Subir a Drive': [3, 5], 'Foto guardada': [4, 5],
      'Aviso sin carpeta': [1, 6], 'Motivo error Drive': [4, 6], 'Aviso error Drive': [5, 6],
    },
  },
  {
    n: 6, titulo: 'Comandos del carrusel', color: 5,
    texto: 'LISTA, BORRAR, SUSPENDER, ACTIVAR, PROGRAMAR, DURACION y DIFUMINAR. Se firma la orden, se llama a `/api/manage` y se contesta. BORRAR enseña la imagen y pide confirmación antes.',
    nodos: {
      'Firmar comando': [7, 5], 'Llamar manage': [8, 5], 'Armar respuesta': [9, 5], 'Pide confirmacion': [10, 5],
      'Bajar imagen a borrar': [11, 5], 'Convertir a JPG': [12, 5], 'Mostrar imagen a borrar': [13, 5], 'Confirmar borrado': [14, 5],
      Aprobado: [15, 5], 'Preparar borrado': [16, 5], 'Responder comando': [11, 6], 'Borrado cancelado': [16, 6],
    },
  },
  {
    n: 7, titulo: 'Redactar el prompt', color: 3,
    texto: 'El «director creativo» convierte el mensaje en el prompt del póster. **Sus instrucciones se editan en `Instrucciones del director`** (tres textos: `reglas`, `con_logo`, `sin_logo`). `Redactar prompt` llama al modelo de texto.',
    nodos: {
      'Init contexto': [0, 9], 'Instrucciones del director': [1, 9], 'Armar prompt': [2, 9], 'Redactar prompt': [3, 9],
      'Parsear salida': [4, 9], 'Es valido': [5, 9], 'Aviso no entendido': [5, 10],
    },
  },
  {
    n: 8, titulo: 'Generar la imagen', color: 3,
    texto: 'Busca la foto del producto en Drive. Con foto de referencia genera con **Wan**; sin foto, con **Qwen**.',
    nodos: {
      'Buscar en Drive': [6, 9], 'Elegir producto': [7, 9], 'Forzar Wan revision': [8, 9], 'Tiene foto': [9, 9],
      'Descargar foto': [10, 9], 'Ref Wan': [11, 9], 'Send a text message1': [12, 8], 'Preparar Wan': [12, 9], 'Pedir Wan': [13, 9],
      'Descargar Wan': [14, 9], 'Generar Wan': [15, 9], 'Send a text message': [10, 10], 'Generar Qwen': [11, 10], 'Fijar foto': [16, 9],
    },
  },
  {
    n: 9, titulo: 'Logo', color: 6,
    texto: 'El modelo nunca dibuja el logo. `Con logo` decide según lo que pidió el cliente. **Sí:** ajusta el póster al tamaño del panel y le sobrepone el logo en la esquina inferior derecha. **No:** solo lo ajusta al tamaño y sigue.',
    nodos: {
      'Con logo': [0, 13], 'Descargar logo': [1, 12], 'Redimensionar logo': [2, 12], 'Info logo': [3, 12],
      'Optimizar imagen': [1, 13], 'Info poster': [2, 13], Merge: [3, 13], 'Calcular posicion': [4, 13], 'Componer logo': [5, 13],
      'Optimizar imagen sin logo': [1, 14],
    },
  },
  {
    n: 10, titulo: 'Vista previa', color: 6,
    texto: 'Sube el póster al carrusel (todavía sin publicarlo), se lo manda al cliente por WhatsApp y espera su respuesta.',
    nodos: {
      'Subir imagen compuesta': [6, 13], 'Subir imagen compuesta - HTTP': [7, 13], 'Armar vista con URL': [8, 13], 'Fijar foto compuesta': [9, 13],
      'Armar vista': [10, 13], 'Enviar foto': [11, 13], 'Esperar respuesta': [12, 13], 'Normalizar respuesta': [13, 13],
    },
  },
  {
    n: 11, titulo: 'Publicar o corregir', color: 6,
    texto: 'Si contesta PUBLICAR, el póster entra al carrusel. Si pide un cambio, vuelve a (7) con ese cambio: hasta 5 intentos.',
    nodos: {
      'Es publicar': [14, 13], 'Firmar webhook': [15, 13], 'Publicar en carrusel': [16, 13], 'Confirmar publicado': [17, 13],
      'Preparar revision': [15, 14], 'Ronda tope': [16, 14], 'Limite rondas': [17, 14],
    },
  },
  {
    n: 12, titulo: 'Consumo', color: 2,
    texto: 'Avisa al panel cuántos tokens e imágenes se gastaron (JEV, audio, prompt e imagen). **No mover hacia abajo:** tiene que quedar arriba de todo para correr antes que el resto.',
    nodos: { 'Firmar consumo': [10, -3], 'Reportar consumo': [11, -3] },
  },
];

const NOTA = 'n8n-nodes-base.stickyNote';
const nombreNota = (s) => `Nota ${s.n} · ${s.titulo}`;

// Orden en que n8n corre los destinos de cada salida con más de un destino (arriba primero).
// Devuelve una línea por salida: "Origen|salida: Destino A > Destino B".
export function ordenHermanos(wf) {
  const pos = Object.fromEntries(wf.nodes.map((n) => [n.name, n.position]));
  const lineas = [];
  for (const [origen, tipos] of Object.entries(wf.connections)) {
    (tipos.main || []).forEach((destinos, salida) => {
      const nombres = [...new Set((destinos || []).map((d) => d.node))];
      if (nombres.length < 2) return;
      nombres.sort((a, b) => pos[a][1] - pos[b][1] || pos[a][0] - pos[b][0] || a.localeCompare(b));
      lineas.push(`${origen}|${salida}: ${nombres.join(' > ')}`);
    });
  }
  return lineas.sort();
}

// Coloca cada nodo en su sección y agrega (o refresca) las 12 notas. Modifica `wf`.
export function ordenarLienzo(wf) {
  const antes = ordenHermanos(wf);
  const lugar = new Map();
  for (const s of SECCIONES) {
    for (const [nombre, celda] of Object.entries(s.nodos)) {
      if (lugar.has(nombre)) throw new Error(`Lienzo: "${nombre}" está en dos secciones`);
      lugar.set(nombre, celda);
    }
  }
  const nodos = wf.nodes.filter((n) => n.type !== NOTA);
  const sinLugar = nodos.filter((n) => !lugar.has(n.name)).map((n) => n.name);
  if (sinLugar.length) throw new Error('Lienzo: nodos sin lugar asignado: ' + sinLugar.join(', '));
  const sobran = [...lugar.keys()].filter((nombre) => !nodos.some((n) => n.name === nombre));
  if (sobran.length) throw new Error('Lienzo: el flujo ya no tiene estos nodos: ' + sobran.join(', '));
  for (const n of nodos) {
    const [col, ren] = lugar.get(n.name);
    n.position = [Math.round(col * DX), ren * DY];
  }

  const nuestras = new Set(SECCIONES.map(nombreNota));
  wf.nodes = wf.nodes.filter((n) => !(n.type === NOTA && (nuestras.has(n.name) || /^Nota \d+ · /.test(n.name))));
  for (const s of SECCIONES) {
    const celdas = Object.values(s.nodos);
    const c0 = Math.floor(Math.min(...celdas.map((c) => c[0]))), c1 = Math.floor(Math.max(...celdas.map((c) => c[0])));
    const r0 = Math.min(...celdas.map((c) => c[1])), r1 = Math.max(...celdas.map((c) => c[1]));
    wf.nodes.push({
      parameters: {
        content: `## ${s.n} · ${s.titulo}\n${s.texto}`,
        width: (c1 - c0 + 1) * DX - 20,
        height: (r1 - r0) * DY + 330,
        color: s.color,
      },
      id: `5d1f3c0a-7b1e-4c55-9a55-0c1a5e7f1${String(s.n).padStart(3, '0')}`,
      name: nombreNota(s),
      type: NOTA,
      typeVersion: 1,
      position: [c0 * DX - 70, r0 * DY - 170],
    });
  }

  const despues = ordenHermanos(wf);
  if (antes.join('\n') !== despues.join('\n')) {
    const cambio = despues.filter((l, i) => l !== antes[i]);
    throw new Error('Lienzo: acomodar los nodos cambiaría el orden en que corren estas ramas: ' + cambio.join(' ; '));
  }
  return wf;
}

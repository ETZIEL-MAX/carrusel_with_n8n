# El flujo de WhatsApp, paso por paso

Guía del flujo de n8n `COPIA_SEGURIDAD_DIRECTOR_ARTE`: qué hace cada sección, dónde se cambian
las instrucciones de la IA, cómo probarlo y qué mirar cuando algo falla.

Para la parte técnica (firmas, endpoints, tokens) ver [N8N.md](N8N.md).

---

## 1. El recorrido de un mensaje

En el lienzo de n8n los nodos están agrupados en **12 secciones**, cada una con una nota de color
que tiene su número y su título. Un mensaje las recorre así:

```
1 Entrada → 2 Audio → 3 Ajustes → 4 JEV ─┬─ spam ......... no se contesta
                                          ├─ foto ......... 5 Foto → Drive
                                          ├─ comando ...... 6 Comandos
                                          └─ póster ....... 7 Prompt → 8 Imagen → 9 Logo
                                                            → 10 Vista previa → 11 Publicar
12 Consumo (arriba): recibe avisos del audio, del prompt y de la imagen
```

### 1 · Entrada y token
`WhatsApp Trigger` → `Buscar token` → `Adjuntar token` → `Variables` → `Solo mi numero`

El mensaje llega desde el flujo `RECEPCIONISTA_WHATSAPP`. Se busca la fila del cliente en la tabla
`whatsapp_numeros` (por su número): de ahí salen su carrusel (`USER1`, `USER2`…) y su token.

### 2 · Audio
`Es audio` → `Descargar audio` → `Bajar audio` → `Audio a base64` → `Transcribir audio`

Solo corre si mandaron una nota de voz. El texto transcrito se trata igual que uno escrito.

### 3 · Ajustes del panel
`Firmar settings` → `Traer settings`

Lee del panel web la carpeta de Drive, la paleta de colores y el formato y la resolución del póster.

### 4 · JEV: ¿qué quiere el cliente?
`Hay texto` → `JEV` (+ `Modelo de JEV`) → `Detectar ruta` → `Es spam` → `Es foto` → `Es comando` → `Es ayuda`

- **`Hay texto`**: si el mensaje trae texto (escrito o audio), lo lee JEV. Una foto sola pasa directo.
- **`JEV`** es un nodo **AI Agent**. Lee el mensaje y contesta una sola cosa, en JSON:

  ```json
  { "tipo": "spam | poster | comando", "logo": true, "comando": "" }
  ```

  | Lo que decide JEV | Qué pasa |
  |---|---|
  | `spam` (saludos, charla, cadenas, publicidad ajena) | **No se contesta nada.** Termina en `Mensaje ignorado`. |
  | `poster` con `logo: true` | Se genera el póster y se le pone el logo. |
  | `poster` con `logo: false` (pidió «sin logo») | Se genera el póster **sin** logo. |
  | `comando` | JEV escribe la orden en su forma normal (`SUSPENDER 2`) y se ejecuta. |

- **`Modelo de JEV`** es el modelo de OpenRouter que usa JEV (cuelga debajo del nodo `JEV`).
- **`Detectar ruta`** junta todo y decide a dónde va el mensaje. Reglas que conviene saber:
  - Un comando **escrito tal cual** (`LISTA`, `BORRAR 3`) se obedece siempre, diga lo que diga JEV.
  - Gracias a JEV también se entienden frases libres: «ya no muestres la segunda» → `SUSPENDER 2`.
  - `BORRAR` sigue enseñando la imagen y pidiendo confirmación.
  - **Si JEV falla** (sin red, el modelo no contesta, contesta algo raro), el flujo sigue como si
    JEV no existiera: comandos exactos y, lo demás, póster con logo. Nunca deja al cliente colgado.

### 5 · Foto → Drive
`Tiene carpeta` → `Descargar foto enviada` → `Bajar foto enviada` → `Subir a Drive` → `Foto guardada`

Una foto enviada se guarda en la carpeta de Drive del cliente; el pie de foto es el nombre del archivo.

### 6 · Comandos del carrusel
`Firmar comando` → `Llamar manage` → `Armar respuesta` → `Pide confirmacion` → …

LISTA, AYUDA, BORRAR, SUSPENDER, ACTIVAR, PROGRAMAR, DURACION y DIFUMINAR (lista completa en
[N8N.md](N8N.md)). Mandar `AYUDA` por WhatsApp los enseña todos.

### 7 · Redactar el prompt
`Init contexto` → **`Instrucciones del director`** → `Armar prompt` → `Redactar prompt` → `Parsear salida` → `Es valido`

El «director creativo» es un modelo de texto que convierte el mensaje del cliente en el prompt
(en inglés) para el generador de imágenes. **Sus instrucciones están en el nodo
`Instrucciones del director`** (ver el punto 2 de esta guía).

> ¿Por qué no es un nodo «AI Agent»? Porque ese tipo de nodo no dice cuántos tokens gastó.
> `Redactar prompt` hace la misma llamada al modelo por HTTP y así el gasto sale en el panel.

### 8 · Generar la imagen
`Buscar en Drive` → `Elegir producto` → `Tiene foto` → **Wan** (con foto del producto) o **Qwen** (sin foto) → `Fijar foto`

### 9 · Logo
`Con logo` → sí: `Descargar logo` … `Componer logo` · no: `Optimizar imagen sin logo`

Con logo, el póster se ajusta al tamaño del panel y se le pone el logo en la esquina inferior
derecha. Sin logo, solo se ajusta al tamaño.

### 10 · Vista previa
`Subir imagen compuesta` → … → `Enviar foto` → `Esperar respuesta`

Le manda el póster al cliente y espera: «PUBLICAR» o lo que quiera cambiar.

### 11 · Publicar o corregir
`Es publicar` → sí: `Publicar en carrusel` · no: `Preparar revision` → vuelve a la sección 7 (hasta 5 intentos)

### 12 · Consumo
`Firmar consumo` → `Reportar consumo`

Avisa al panel cuántos tokens e imágenes se gastaron. **Esta sección tiene que quedar arriba de
todas las demás** (ver el punto 6).

---

## 2. Cambiar las instrucciones de la IA

Hay dos IAs con instrucciones que puedes editar tú, directo en n8n, sin tocar código.

### JEV (qué es spam, qué es un comando…)

1. Abre el nodo **`JEV`** (sección 4).
2. Baja a **Options → System Message**. Ese texto son sus instrucciones.
3. Edita y guarda. Luego **publica** el flujo.

Ejemplo — para que los mensajes que solo traen un enlace cuenten como spam, agrega una línea en
la parte de TIPOS:

```
- "spam": ... También cualquier mensaje que sea solo un enlace.
```

Lo único que no debes quitar es la forma de la respuesta (el JSON con `tipo`, `logo` y
`comando`) ni la lista de comandos en su forma exacta: de eso depende `Detectar ruta`.

### El director (cómo se redacta el prompt del póster)

1. Abre el nodo **`Instrucciones del director`** (sección 7).
2. Tiene tres textos:

   | Campo | Qué es |
   |---|---|
   | `reglas` | El cuerpo de las instrucciones: estilo, jerarquía, textos, composición. |
   | `con_logo` | El párrafo sobre la esquina del logo (cuando el póster lleva logo). |
   | `sin_logo` | Lo que se le dice cuando el cliente pidió el póster sin logo. |

3. Edita, guarda y **publica**.

Dentro de los textos puedes usar estos **marcadores**; el flujo los cambia por el valor real:

| Marcador | Se cambia por |
|---|---|
| `[FORMATO]` | Formato y tamaño, p. ej. `vertical 9:16, EXACTAMENTE 1080x1920 pixeles` |
| `[ANCHO]` `[ALTO]` | Medidas del póster en píxeles |
| `[ZONA_ANCHO]` `[ZONA_ALTO]` | Porcentaje del póster que ocupa la esquina del logo |
| `[LOGO]` | Aquí se inserta `con_logo` o `sin_logo`, según el caso (va dentro de `reglas`) |

Ejemplo — para que los pósters sean más sobrios, agrega al final de `reglas`:

```
ESTILO: fondos limpios, maximo tres colores, nada de destellos ni efectos de neon.
```

Tres cosas a saber:

- **No borres la última regla de `reglas`** (la de «FORMATO DE RESPUESTA OBLIGATORIO»): el flujo
  necesita que el modelo conteste con `producto` y `prompt_final`.
- Si dejas un campo **vacío**, se usa el texto de fábrica (el de `n8n/prompt.js`). Sirve para
  «volver al original».
- No empieces un texto con `=` ni escribas `{{`: n8n lo tomaría por una fórmula.

Además del texto que tú editas, el flujo agrega al final del prompt unas reglas fijas de formato
(tamaño exacto, que los textos quepan, lienzo completo y la esquina del logo). Esas viven en
`n8n/formato.js` (`reglasLayout`).

---

## 3. Cambiar el modelo

- **JEV:** abre `Modelo de JEV` (debajo de `JEV`) y cambia el campo **Model** por el
  identificador del modelo tal como aparece en OpenRouter (por ejemplo `deepseek/deepseek-v4.1-flash`).
  La credencial es la misma de OpenRouter que usa el resto del flujo.
- **Director:** el modelo está en `scripts/n8n-patch-flujo.mjs` (`OPENROUTER_MODEL`); se cambia
  ahí y se vuelve a aplicar (punto 6).

JEV usa temperatura 0 para que conteste siempre igual ante el mismo mensaje.

---

## 4. Cómo probarlo por WhatsApp

Después de publicar, manda estos mensajes desde un número dado de alta:

| # | Mensaje | Qué debe pasar |
|---|---|---|
| 1 | `hola buenas tardes` | **Nada.** El bot no contesta (spam). |
| 2 | `Tacos al pastor 3x50 solo hoy` | Llega un póster **con** logo y pregunta si lo publica. |
| 3 | `Hamburguesa doble $89 sin logo` | Llega un póster **sin** logo; «sin logo» no aparece escrito en la imagen. |
| 4 | `LISTA` | Contesta la lista de imágenes del carrusel. |
| 5 | `ya no muestres la 2` | Contesta que la imagen #2 quedó suspendida. Luego `ACTIVAR 2`. |
| 6 | `quítame la 3` | Enseña la imagen #3 y **pide confirmación** antes de borrar. Contesta que no. |
| 7 | Una nota de voz: «pizza familiar a ciento noventa y nueve» | Llega un póster, igual que con texto. |
| 8 | Una foto con pie `tacos` | Contesta que la guardó en Drive como `tacos.jpg`. |

Si el 1 contesta algo o el 2 no contesta nada, revisa las instrucciones de JEV (punto 2).

---

## 5. Cuando algo falla

En n8n abre el flujo → pestaña **Executions** → la ejecución del mensaje. Los nodos que corrieron
salen en verde; el que falló, en rojo.

| Síntoma | Dónde mirar |
|---|---|
| No contestó nada | ¿Terminó en `Mensaje ignorado`? Entonces JEV lo tomó por spam: abre `JEV` y mira su salida (`output`). Si no hay ejecución, el mensaje no llegó desde `RECEPCIONISTA_WHATSAPP`. |
| JEV sale con error | El flujo sigue igual (póster con logo). Revisa en `Modelo de JEV` que el modelo exista en OpenRouter y que la credencial tenga saldo. |
| Hizo póster de algo que era un comando | Mira `Detectar ruta` → campo `jev` (lo que entendió JEV) y `ruta`. Ajusta las instrucciones de JEV. |
| Salió con logo aunque pedí sin logo | `Detectar ruta` → `con_logo` debe ser `false`. Si es `true`, JEV no lo entendió: mira su `output`. |
| «No entendí el mensaje» | El director contestó FALSE: `Redactar prompt` → `Parsear salida`. |
| Error 401 al firmar | El token de la fila en `whatsapp_numeros` no coincide con el del panel. |
| El consumo no aparece en el panel | `Firmar consumo` / `Reportar consumo`. Los tokens de JEV **no** se reportan (ver abajo). |

**Volver a la versión anterior:** en n8n, menú del flujo → **Version history** → elige la versión
anterior → **Restore** → publica. La versión previa a JEV es la que empieza con `b0b18994`.

**Lo que no se reporta:** los nodos «AI Agent» de n8n no entregan los tokens que gastan, así que
el gasto de JEV no sale en el panel de consumo. Son pocos tokens por mensaje. El audio, el prompt
y las imágenes sí se reportan.

---

## 6. Qué sale del repositorio y cómo se vuelve a aplicar

El código de los nodos no se escribe a mano en n8n: sale de este repositorio.

| En el repo | Va a parar a |
|---|---|
| `n8n/clasificador.js` | `Detectar ruta` (lee la respuesta de JEV) y las instrucciones de fábrica de JEV |
| `n8n/comandos.js` | `Detectar ruta` (intérprete de comandos) |
| `n8n/prompt.js` | `Armar prompt` y los textos de fábrica de `Instrucciones del director` |
| `n8n/formato.js` | Tamaño del póster, zona del logo y reglas fijas de formato |
| `n8n/respuestas.js` | `Armar respuesta` |
| `n8n/firma.js`, `n8n/consumo.js` | Nodos de firma y de consumo |
| `scripts/n8n-patch-flujo.mjs` | Arma el flujo completo: nodos, conexiones y notas |
| `scripts/n8n-lienzo.mjs` | La posición de cada nodo y el texto de las 12 notas |

**Tuyo, no del repo.** El script crea estos tres con los textos de fábrica y **nunca los vuelve a
pisar**, así que lo que edites en n8n se conserva:

- el **System Message** del nodo `JEV`,
- el nodo **`Modelo de JEV`**,
- los tres textos de **`Instrucciones del director`**.

Todo lo demás (el código de los nodos, las conexiones, las posiciones, las notas) se regenera
desde el repo: un cambio hecho a mano ahí se pierde la próxima vez que se aplique el script.

Para aplicar un cambio del repo:

```bash
npm run test:n8n                      # pruebas del código de los nodos
node scripts/n8n-patch-flujo.mjs n8n/.work/copia.live.json n8n/.work/copia.patched.json
```

`copia.live.json` es el flujo exportado de n8n (puede traer secretos: la carpeta `n8n/.work/` no
se sube a git). El resultado se importa en el editor de n8n y se publica. Para comprobar que lo
guardado en n8n es lo que dice el repo:

```bash
node scripts/test-n8n.mjs n8n/.work/copia.live.json --parchado
```

### Por qué no hay que mover «Consumo» ni otros nodos a mano

Este flujo usa el orden de ejecución «v1» de n8n: cuando un nodo manda su salida a **dos** nodos,
corre primero el que está **más arriba** en el lienzo. Por eso:

- `Firmar consumo` está arriba de todo: así el gasto se reporta enseguida, y no después de que
  el cliente apruebe el póster.
- `Descargar logo` está arriba de `Optimizar imagen`.

Si mueves un nodo por debajo de su «hermano», cambia el orden en que corren. El script
(`ordenarLienzo`) lo comprueba y se niega a acomodar si ese orden cambiaría, y al volver a
aplicarlo cada nodo regresa a su lugar.

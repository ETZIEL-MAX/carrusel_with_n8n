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

### 1 · Entrada, token y espera de 5 segundos
`WhatsApp Trigger` → `Buscar token` → `Adjuntar token` → `Variables` → `Solo mi numero`
→ `Es texto` → `Anotar mensaje` → `Esperar 5 segundos` → `Leer mensajes` → `Juntar mensajes` → `Soy el ultimo`

El mensaje llega desde el flujo `RECEPCIONISTA_WHATSAPP`. Se busca la fila del cliente en la tabla
`whatsapp_numeros` (por su número): de ahí salen su carrusel (`USER1`, `USER2`…) y su token.

**Espera de 5 segundos.** La gente escribe en varios mensajes seguidos («Tacos al pastor», «3x50»,
«solo hoy»). Para no contestar a cada uno, el bot contesta **una sola vez, 5 segundos después del
último mensaje**, con el texto de todos junto:

- Cada mensaje escrito se anota en la tabla `whatsapp_espera` (`Anotar mensaje`) y espera 5 segundos.
- Al terminar la espera lee los mensajes de ese número (`Leer mensajes`). Si llegó otro después,
  este se retira en `Mensaje juntado` y no contesta: lo hará el último.
- El último sigue con el texto de todos (un renglón por mensaje) y vacía la espera (`Limpiar espera`).
- Solo esperan los mensajes **escritos**: una nota de voz o una foto siguen de inmediato.
- Si la tabla falla, el mensaje sigue solo con su texto: nunca se queda sin contestar.
- **Para cambiar los 5 segundos:** nodo `Esperar 5 segundos` → *Wait Amount*.

### 2 · Audio
`Es audio` → `Descargar audio` → `Bajar audio` → `Audio a base64` → `Transcribir audio`

Solo corre si mandaron una nota de voz. El texto transcrito se trata igual que uno escrito.

### 3 · Ajustes del panel
`Firmar settings` → `Traer settings`

Lee del panel web la carpeta de Drive, la paleta de colores y el formato y la resolución del póster.

### 4 · JEV: ¿qué quiere el cliente?
`Hay texto` → `JEV` → `Detectar ruta` → `Es spam` → `Es foto` → `Es comando` → `Es ayuda`

- **`Hay texto`**: si el mensaje trae texto (escrito o audio), lo lee JEV. Una foto sola pasa directo.
- **`JEV`** es un nodo **HTTP Request** que llama al modelo JEV:
  `POST https://jevmodel.org/v1/systemone`. JEV no conversa ni escribe texto: recibe el mensaje
  (`state`) y unas preguntas (`questions`), y contesta cada una con una opción o con una
  probabilidad de sí/no. El flujo le hace cuatro:

  | Pregunta | Tipo | Qué contesta |
  |---|---|---|
  | `tipo` | opción | `poster`, `comando` o `spam` |
  | `sin_logo` | sí/no | qué tan probable es que pidan el póster sin logo (0 a 1) |
  | `accion` | opción | qué orden es: `lista`, `ayuda`, `borrar`, `suspender`, `activar`, `difuminar`, `quitar_difuminado` u `otra` |
  | `imagen` | opción | de cuál imagen habla: `imagen_1` … `imagen_12` o `ninguna` |

  Con eso el flujo decide:

  | Lo que contesta JEV | Qué pasa |
  |---|---|
  | `tipo: spam` (saludos, charla, cadenas, publicidad ajena) | **No se contesta nada.** Termina en `Mensaje ignorado`. |
  | `tipo: poster` (un producto, una promoción **o un aviso**) | Se genera el póster y se le sobrepone el logo. |
  | `tipo: poster` y `sin_logo` alto | Se genera el póster **sin** logo. |
  | `tipo: comando` | Con `accion` + `imagen` se arma la orden (`SUSPENDER 2`) y se ejecuta. |

- **`Detectar ruta`** junta todo y decide a dónde va el mensaje. Reglas que conviene saber:
  - Un comando **escrito tal cual** (`LISTA`, `BORRAR 3`) se obedece siempre, diga lo que diga JEV.
  - Gracias a JEV también se entienden frases libres: «ya no muestres la segunda» → `SUSPENDER 2`,
    «quítame la 4» → `BORRAR 4`, «¿qué imágenes tengo?» → `LISTA`.
  - **`PROGRAMAR` y `DURACION` solo funcionan escritos en su forma normal** (`PROGRAMAR 3 VIERNES`,
    `DURACION 3 20`). JEV elige entre opciones, no puede sacar días, fechas ni segundos de una
    frase; si alguien lo pide en frase libre, el bot contesta con la ayuda.
  - `BORRAR` sigue enseñando la imagen y pidiendo confirmación.
  - **Filtro de spam.** Un saludo («hola», «gracias», «ok»), una cadena o publicidad ajena no se
    contesta. Un **aviso** del negocio («Cerrado el lunes», «Nuevo horario») **no es spam**: es un
    póster. Un comando escrito tal cual y una foto nunca se tratan como spam.
  - **JEV tiene que estar seguro** (0.6 o más, de 0 a 1). Un «spam» o «comando» dudoso se trata
    como póster, y un «sin logo» dudoso lleva logo: es mejor un póster de más que ignorar a un cliente.
  - **Si JEV falla** (sin red, llave mala, sin saldo), el flujo sigue como si JEV no existiera:
    comandos exactos y, lo demás, póster con logo. Nunca deja al cliente colgado.

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
(en inglés) para el generador de imágenes. El mensaje puede ser un producto con su precio o un
**aviso** («Cerrado el lunes por día festivo», «Nuevo horario de 9 a 6»): en un aviso el texto
es el protagonista del póster. **Sus instrucciones están en el nodo
`Instrucciones del director`** (ver el punto 2 de esta guía).

> ¿Por qué no es un nodo «AI Agent»? Porque ese tipo de nodo no dice cuántos tokens gastó.
> `Redactar prompt` hace la misma llamada al modelo por HTTP y así el gasto sale en el panel.

### 8 · Generar la imagen
`Buscar en Drive` → `Elegir producto` → `Tiene foto` → **Wan** (con foto del producto) o **Qwen** (sin foto) → `Fijar foto`

### 9 · Logo
`Con logo` → sí: `Descargar logo` … `Componer logo` · no: `Optimizar imagen sin logo`

**El modelo nunca dibuja el logo.** Con logo, el póster se ajusta al tamaño del panel y el flujo
le **sobrepone** el logo en la esquina inferior derecha; al modelo solo se le pide no poner textos
ni precio en esa esquina, y se le prohíbe preparar una franja, línea o zona de otro color. Sin
logo, solo se ajusta al tamaño.

### 10 · Vista previa
`Subir imagen compuesta` → … → `Enviar foto` → `Esperar respuesta`

Le manda el póster al cliente y espera: «PUBLICAR» o lo que quiera cambiar.

### 11 · Publicar o corregir
`Es publicar` → sí: `Publicar en carrusel` · no: `Preparar revision` → vuelve a la sección 7 (hasta 5 intentos)

### Cupo del mes
`Es ayuda` (no) → `Hay cupo` → `Init contexto`

Antes de generar un póster se mira `quota` de los ajustes del panel (`Traer settings`). Si ya no
quedan imágenes del mes (las del plan del cliente o el tope que pusiste en el panel), `Sin cupo`
le avisa por WhatsApp y no se genera nada. Los límites se cambian en el panel del super-admin
(tabla **Planes** o el tope propio de cada cuenta), no en n8n.

### 12 · Consumo
`Firmar consumo` → `Reportar consumo`

Avisa al panel cuántos tokens e imágenes se gastaron (JEV, audio, prompt e imagen). **Esta sección tiene que quedar arriba de
todas las demás** (ver el punto 6).

También cuenta los mensajes que el bot manda: cada nodo de WhatsApp que envía (`send` o
`sendAndWait`) tiene una salida extra a `Firmar consumo`, que lo reporta como `kind: "message"`.
El super-admin ve el total del mes en la tarjeta de cada cliente. Si agregas un nodo de envío nuevo,
vuelve a aplicar el script y queda conectado solo.

---

## 2. Cambiar las instrucciones de la IA

Hay dos IAs con instrucciones que puedes editar tú, directo en n8n, sin tocar código.

### JEV (qué es spam, qué es un comando…)

1. Abre el nodo **`JEV`** (sección 4).
2. En **Body → JSON** están las preguntas, dentro de `"questions"`. Cada una tiene:
   - `instructions`: la pregunta que se le hace a JEV;
   - `criteria`: las opciones y la descripción de cada una.
3. Edita los **textos** y guarda. Luego **publica** el flujo.

Ejemplo — para que los mensajes que solo traen un enlace cuenten como spam, agrégalo a la
descripción de la opción `spam` de la pregunta `tipo`:

```json
"spam": "No hay nada que anunciar ni ordenar: saludos y charla, cadenas, publicidad ajena, cualquier mensaje que sea solo un enlace, ..."
```

Reglas para no romperlo:

- **Cambia las descripciones, no los nombres.** `tipo`, `sin_logo`, `accion`, `imagen` y los
  nombres de las opciones (`spam`, `poster`, `comando`, `borrar`, `imagen_3`…) los lee el código
  de `Detectar ruta`.
- No toques la línea de `"state"`: es la que mete el mensaje del cliente (el script la vuelve a
  escribir cada vez que se aplica).
- No borres la opción `spam`: sin ella el filtro no funciona, y al volver a aplicar el script
  las preguntas regresan a las de fábrica.
- El cuerpo tiene que seguir siendo JSON válido (comillas dobles, comas entre elementos) y
  **nunca dos llaves pegadas** (`{{` o `}}`): n8n las tomaría por una fórmula. Por eso cada
  llave va en su renglón.
- Límites de JEV: máximo 8 preguntas, 20 opciones por pregunta y 1 800 letras por instrucción.

Qué tan seguro debe estar JEV (0.6) se cambia en el repo: `JEV_SEGURIDAD_MINIMA` en
`n8n/clasificador.js`.

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

## 3. La llave y el modelo

### La llave de JEV

El nodo `JEV` manda la llave en la cabecera **`Authorization`**, con la forma `Bearer sk-…`.

1. Abre el nodo `JEV` → **Headers** → `Authorization`.
2. Cambia `Bearer PEGA_AQUI_LA_LLAVE_DE_JEV` por `Bearer ` seguido de tu llave.
3. Guarda y publica.

Mejor todavía (así la llave no queda escrita en el flujo ni en sus exportaciones): en n8n crea
una credencial **Header Auth** con nombre `Authorization` y valor `Bearer sk-…`, y en el nodo
elige *Authentication → Generic Credential Type → Header Auth*; después borra la cabecera
escrita a mano.

Las llaves se crean y se cancelan en `https://jevmodel.org/dashboard/`. La llave **no** está en
el repositorio; solo vive en n8n.

### El modelo

- **JEV:** en el cuerpo JSON del nodo `JEV`, el campo `"model"` (hoy `jev-latest`).
- **Director:** el modelo está en `scripts/n8n-patch-flujo.mjs` (`OPENROUTER_MODEL`); se cambia
  ahí y se vuelve a aplicar (punto 6).

---

## 4. Cómo probarlo por WhatsApp

Después de publicar, manda estos mensajes desde un número dado de alta:

| # | Mensaje | Qué debe pasar |
|---|---|---|
| 1 | `hola buenas tardes` | **Nada.** El bot no contesta (spam). |
| 1a | Tres mensajes seguidos: `Tacos al pastor`, `3x50`, `solo hoy` | Contesta **una sola vez**, unos 5 segundos después del último, con un póster que trae los tres datos. |
| 1b | `Cerrado el lunes por día festivo` | Llega un póster de **aviso**, con ese texto como protagonista. |
| 2 | `Tacos al pastor 3x50 solo hoy` | Llega un póster **con** logo, **sin franja ni línea de color** a la derecha, y pregunta si lo publica. |
| 3 | `Hamburguesa doble $89 sin logo` | Llega un póster **sin** logo; «sin logo» no aparece escrito en la imagen. |
| 4 | `LISTA` | Contesta la lista de imágenes del carrusel. |
| 5 | `ya no muestres la 2` | Contesta que la imagen #2 quedó suspendida. Luego `ACTIVAR 2`. |
| 5b | `que la 2 salga solo los viernes` | Contesta con la **ayuda** (programar solo se entiende como `PROGRAMAR 2 VIERNES`). |
| 6 | `quítame la 3` | Enseña la imagen #3 y **pide confirmación** antes de borrar. Contesta que no. |
| 7 | Una nota de voz: «pizza familiar a ciento noventa y nueve» | Llega un póster, igual que con texto. |
| 8 | Una foto con pie `tacos` | Contesta que la guardó en Drive como `tacos.jpg`. |

Si el 1 contesta algo o el 2 no contesta nada, revisa las preguntas de JEV (punto 2).
Si **todo** sale como póster con logo (también el saludo), JEV está fallando: casi siempre es la llave (punto 3).

---

## 5. Cuando algo falla

En n8n abre el flujo → pestaña **Executions** → la ejecución del mensaje. Los nodos que corrieron
salen en verde; el que falló, en rojo.

| Síntoma | Dónde mirar |
|---|---|
| No contestó nada | ¿Terminó en `Mensaje ignorado`? JEV lo tomó por spam: abre `JEV` y mira su salida (`answers.tipo`). ¿Terminó en `Mensaje juntado`? Llegó otro mensaje después y contestó ese. Si no hay ejecución, el mensaje no llegó desde `RECEPCIONISTA_WHATSAPP`. |
| Contesta a cada mensaje en vez de juntarlos | Mira `Anotar mensaje` y `Leer mensajes`: si salen con error, falta la tabla `whatsapp_espera` (columnas `numero`, `mensaje_id`, `texto`). |
| Sale una franja o línea de color donde va el logo | Revisa el texto `con_logo` de `Instrucciones del director`: debe prohibir franjas y zonas de otro color. Si lo dejaste vacío se usa el de fábrica. |
| JEV sale con error | El flujo sigue igual (póster con logo). `401` = la llave está mal o falta (punto 3); `402` = sin saldo en jevmodel.org; `422` = el cuerpo JSON quedó mal después de editarlo; `429` = demasiadas llamadas por minuto. |
| Hizo póster de algo que era un comando | Mira `Detectar ruta` → campo `jev` (lo que entendió JEV) y `ruta`. Ajusta las instrucciones de JEV. |
| Salió con logo aunque pedí sin logo | `Detectar ruta` → `con_logo` debe ser `false`. Si es `true`, mira en `JEV` el valor de `answers.sin_logo.noul`: tiene que ser 0.6 o más. |
| «No entendí el mensaje» | El director contestó FALSE: `Redactar prompt` → `Parsear salida`. |
| Error 401 al firmar | El token de la fila en `whatsapp_numeros` no coincide con el del panel. |
| El consumo no aparece en el panel | `Firmar consumo` / `Reportar consumo`. |

**Volver a la versión anterior:** en n8n, menú del flujo → **Version history** → elige la versión
anterior → **Restore** → publica. La versión previa a JEV es la que empieza con `b0b18994`.

**Consumo de JEV:** cada llamada devuelve los tokens que gastó y se reportan al panel igual que
los del audio y el prompt (`JEV` → `Firmar consumo`).

---

## 6. Qué sale del repositorio y cómo se vuelve a aplicar

El código de los nodos no se escribe a mano en n8n: sale de este repositorio.

| En el repo | Va a parar a |
|---|---|
| `n8n/clasificador.js` | `Detectar ruta` (lee la respuesta de JEV) y las preguntas de fábrica de JEV |
| `n8n/comandos.js` | `Detectar ruta` (intérprete de comandos) |
| `n8n/prompt.js` | `Armar prompt` y los textos de fábrica de `Instrucciones del director` |
| `n8n/formato.js` | Tamaño del póster, zona del logo y reglas fijas de formato |
| `n8n/respuestas.js` | `Armar respuesta` |
| `n8n/firma.js`, `n8n/consumo.js` | Nodos de firma y de consumo |
| `scripts/n8n-patch-flujo.mjs` | Arma el flujo completo: nodos, conexiones y notas |
| `scripts/n8n-lienzo.mjs` | La posición de cada nodo y el texto de las 12 notas |

**Tuyo, no del repo.** El script crea esto con los textos de fábrica y **nunca los vuelve a
pisar**, así que lo que edites en n8n se conserva:

- el **cuerpo JSON** del nodo `JEV` (las preguntas y el modelo),
- la **llave** de JEV (cabecera `Authorization`),
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


## 7. Flujo «Generar desde web» (Crear con IA del panel)

En n8n se llama **GENERAR_DESDE_WEB** (id `LbKLR9xqboXezBHg`). No se edita a mano: lo arma
`scripts/n8n-flujo-web.mjs` copiando la ruta del póster del flujo de WhatsApp ya parchado
(director, prompt, Qwen/Wan, logo), así los dos generan igual. Si cambias el póster en el flujo de
WhatsApp, vuelve a generar este:

```bash
node scripts/n8n-patch-flujo.mjs n8n/.work/copia.live.json n8n/.work/copia.patched.json
node scripts/n8n-flujo-web.mjs n8n/.work/copia.patched.json n8n/.work/web.json n8n/.work/web.sdk.js
```

`web.sdk.js` es el código que acepta el MCP de n8n (`create_workflow_from_code`).

Para que funcione: publicar el flujo en n8n y, en `.env.prod` del servidor,
`N8N_WEB_GENERATION_URL=https://n8ndokployupdates.etziel.com/webhook/generar-web-carrusel` y
`n8ndokployupdates.etziel.com` en `N8N_ALLOWED_HOSTS`. El webhook usa la credencial «Alta de Numero»
(mismo `X-Carrusel-Key` que el alta de números). Solo acepta `callbackUrl` de
`https://carrusel.etziel.com/api/drafts/callback`.

Es un flujo aparte del de WhatsApp. El cliente escribe en el panel qué imagen quiere; el servidor
llama a este flujo y la imagen vuelve al panel como **borrador** (el cliente la revisa, pide
cambios o la publica).

**Entrada.** Webhook `POST` con *Header Auth* (header `X-Carrusel-Key`, valor =
`N8N_NUMBERS_SECRET`). Su URL de producción va en `N8N_WEB_GENERATION_URL` del servidor y su host
en `N8N_ALLOWED_HOSTS`. Cuerpo:

```json
{
  "userId": "USER7", "draftId": "<uuid>", "round": 1,
  "prompt": "Tacos al pastor 3x50 solo hoy",
  "changes": [],
  "previousImageUrl": null,
  "format": "horizontal", "width": 1920, "height": 1080,
  "googleDriveFolder": null, "colorPalette": ["#ff0000"],
  "callbackUrl": "https://carrusel.etziel.com/api/drafts/callback?userId=USER7&id=<uuid>",
  "callbackToken": "<secreto de esta ronda>"
}
```

En la ronda 2 en adelante `changes` trae lo que pidió el cliente (en orden) y
`previousImageUrl` la imagen anterior.

**Pasos.** Responder 200 enseguida (el panel no espera), redactar el prompt con
«Instrucciones del director» (`n8n/prompt.js`, usando `prompt` + `changes`), generar con
Qwen/Wan al tamaño `width` × `height` y poner el logo como en el flujo de WhatsApp.

**Salida.** `POST` a `callbackUrl` con el header `X-Draft-Token: <callbackToken>` y, como cuerpo,
la imagen (`Content-Type: image/png` o `image/jpeg`) o `{ "url": "<URL temporal>" }`. Si algo falla,
`{ "error": "texto para el cliente" }`. El secreto sirve una sola vez y vence a los 15 minutos.

**No** reportes la imagen a `/api/usage`: el servidor la cuenta al recibirla.

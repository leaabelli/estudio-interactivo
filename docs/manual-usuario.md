# Estudio Interactivo

Manual de uso - versión 1.1

Estudiá con bancos grandes de preguntas de opción múltiple, continuá en varias etapas y conservá un registro portátil de tu progreso.

**Privado por diseño:** la aplicación funciona sin internet. Las preguntas, respuestas y resultados quedan en este dispositivo o en el archivo que vos exportes.

<!-- pagebreak -->

## Contenido

1. Empezar en dos minutos
2. Entender el archivo portátil
3. Preparar un examen modelo
4. Responder y entregar
5. Leer resultados y progreso
6. Guardar y continuar en otro momento
7. Recuperaciones, reemplazos y varias pestañas
8. Crear nuevos módulos de preguntas
9. Resolver problemas frecuentes
10. Usar el proyecto en GitHub Pages

> Consejo: si tenés el repositorio de desarrollo, usá `modulo-prueba.study.json` para conocer todo el flujo antes de cargar material propio. No viene incorporado en la aplicación publicada.

## 1. Empezar en dos minutos

1. En una computadora, abrí `index.html` con una versión actualizada de Chrome, Edge, Firefox o Safari. En iPhone o iPad, abrí la versión publicada en GitHub Pages directamente en Safari: la vista previa de WhatsApp o Archivos no funciona como un navegador completo.
2. Elegí **Cargar módulo**.
3. Seleccioná un archivo terminado en `.study.json`.
4. Revisá la vista previa: título, materia, cantidad de preguntas, distribución por dificultad y revisión de estado.
5. Confirmá **Cargar módulo**. Si ya había otro módulo abierto, la aplicación te pide protegerlo con una exportación antes de reemplazarlo.

> Importante: abrir el mismo `index.html` desde otra carpeta puede crear una recuperación local distinta. El archivo exportado es la copia realmente portátil.

### Qué se distribuye y qué queda en el proyecto

| Archivo | Alcance |
| --- | --- |
| `index.html` | Único archivo de la aplicación que se comparte o publica. Es completo, autocontenido y no requiere servidor ni instalación. |
| `modulo-prueba.study.json` | Recurso de prueba del proyecto de desarrollo: 48 preguntas, 12 por dificultad, con progreso inicial vacío. Se carga como archivo externo y no se publica con la aplicación. |
| `manual-usuario.pdf` | Copia local de esta guía. Es un artefacto documental del proyecto y no forma parte del deploy. |
| `src/`, `scripts/` y `tests/` | Fuentes y herramientas de desarrollo que producen o verifican `index.html`; no son dependencias de ejecución. |

La aplicación no trae un banco incorporado ni intenta descargarlo. Cada módulo se selecciona explícitamente desde el dispositivo mediante **Cargar módulo**. Después, **Guardar archivo** exporta otro `*.study.json` externo con el progreso actualizado.

## 2. Entender el archivo portátil

Un archivo `.study.json` contiene dos partes inseparables:

| Parte | Contenido |
| --- | --- |
| Módulo | Identidad, materia, preguntas, opciones, respuestas correctas, explicaciones, dificultad, fuente y cualquier tabla o recurso visual autocontenido. |
| Progreso | Preguntas evaluadas, intentos, aciertos, último resultado, exámenes, filtros y revisión de estado. |

El primer archivo de una materia empieza en revisión de estado 0 y sin progreso. Cada respuesta, cambio de pregunta, abandono o entrega aceptada incrementa la revisión de forma controlada. Al exportar, el módulo y su progreso viajan juntos.

> No edites a mano la sección de progreso. El validador comprueba referencias, contadores, historial y revisiones como un único contrato; un cambio parcial puede volver inválido el archivo.

## 3. Preparar un examen modelo

En **Estudiar** vas a ver primero la cobertura actual y después dos filtros.

### Dificultad

- **Fácil:** definiciones, clasificaciones o relaciones directas.
- **Medio:** aplicación breve o distinción entre alternativas cercanas.
- **Difícil:** integración de conceptos, secuencias de cálculo o inferencias.
- **Experto:** excepciones, límites y casos de borde.
- **Aleatoria:** mezcla equilibrada de niveles disponibles. La selección es reproducible dentro de cada examen.

### Banco de preguntas

- **Solo nuevas:** incluye preguntas que nunca fueron entregadas en un examen. Es la opción recomendada para aumentar cobertura.
- **Todas:** puede incluir nuevas y ya evaluadas. Prioriza el material menos practicado y los errores recientes.

La pantalla muestra cuántas preguntas cumplen los filtros. El examen normal tiene 10 preguntas únicas. Si no alcanzan, la aplicación nunca cambia el filtro ni repite en silencio: ofrece volver, incluir evaluadas cuando corresponda o empezar explícitamente con un examen más corto.

## 4. Responder y entregar

Durante el examen, la navegación general desaparece para reducir distracciones. Cada pantalla muestra el número de pregunta, la dificultad y las opciones. Si el enunciado necesita una tabla, imagen o diagrama, aparece entre la pregunta y las respuestas.

En una pantalla angosta, una tabla ancha se desplaza horizontalmente dentro de su propio recuadro: el resto de la aplicación no debería moverse hacia los costados. Las imágenes y diagramas conservan su proporción y se ajustan al ancho disponible.

- Elegí una opción o **No sé**.
- Usá la tira numerada para saltar entre preguntas; las ya respondidas quedan marcadas.
- **Guardar y salir** conserva el examen activo para reanudarlo.
- **Entregar examen** corrige todo el intento y abre el resultado.

Las respuestas se guardan localmente después de cada acción aceptada. La aplicación no revela la opción correcta antes de entregar. Si quedan preguntas sin responder, pide confirmación y, al entregar, las registra como **No sé** e incorrectas.

> Si hacés varios clics rápidos, las acciones de una misma pestaña se procesan en orden. El botón de entrega se desactiva mientras hay un guardado pendiente para evitar una entrega doble.

### Abandonar no es entregar

Al abandonar se descartan las respuestas provisionales de ese examen. No aumenta la cobertura, no cambia la precisión y no agrega un resultado al historial.

## 5. Leer resultados y progreso

Al entregar, **Resultados** muestra el puntaje, la cobertura ganada y una revisión pregunta por pregunta con tu respuesta, la respuesta correcta, la explicación y la referencia de la fuente cuando existe. El apoyo visual vuelve a mostrarse para que la corrección conserve todo el contexto.

**Progreso** separa cuatro indicadores para no mezclar conceptos distintos:

| Indicador | Cálculo | Cómo interpretarlo |
| --- | --- | --- |
| Cobertura | Preguntas evaluadas al menos una vez / total | Cuánto del banco ya recorriste. |
| Precisión | Respuestas correctas / todos los intentos entregados | Calidad acumulada de tus respuestas. |
| Dominio | Preguntas cuyo último resultado fue correcto / total | Estado reciente del banco completo. |
| Exámenes | Entregas detalladas más entregas resumidas | Cantidad de exámenes completados. |

También vas a ver la cobertura y la precisión por dificultad, y un historial reciente con fecha, filtro, puntaje y cambio de cobertura. Cuando el historial detallado supera el límite de seguridad, los exámenes más antiguos se compactan en un resumen sin alterar los totales.

### Ejemplo de lectura

Una cobertura de 80 % y una precisión de 55 % significa que viste casi todo el banco, pero todavía conviene reforzar errores. Una cobertura de 25 % y una precisión de 100 % no demuestra dominio global: solo describe el subconjunto ya evaluado.

## 6. Guardar y continuar en otro momento

Hay dos mecanismos complementarios:

| Mecanismo | Ventaja | Límite |
| --- | --- | --- |
| Recuperación del navegador | Permite cerrar y volver a abrir desde el mismo navegador y ubicación. | Puede perderse al borrar datos, cambiar de perfil, navegador, dominio o carpeta. |
| Archivo exportado | Copia portátil para archivar, enviar o abrir en otro dispositivo. | Tenés que conservar el archivo más reciente. |

### Rutina recomendada

1. Estudiá y entregá uno o más exámenes.
2. Entrá a **Módulo** y elegí **Guardar archivo**.
3. Si el navegador confirma la escritura, la aplicación informa **Archivo guardado**. Si solo puede iniciar una descarga, comprobá manualmente que aparezca en Descargas.
4. La próxima vez, cargá ese archivo. La vista previa muestra la revisión de estado antes de instalarlo.

Para pasar el progreso a otro dispositivo, copiá el `.study.json` exportado y cargalo en cualquier copia de `index.html` o en el sitio publicado. El módulo sigue siendo un dato portátil separado: no hace falta modificar, recompilar ni acompañar la aplicación distribuida con un banco predeterminado. Tampoco necesitás copiar datos internos del navegador.

> Regla simple: la recuperación local da comodidad; el último archivo exportado da portabilidad.

## 7. Recuperaciones, reemplazos y varias pestañas

Al iniciar, la aplicación lista las recuperaciones conocidas para esa ubicación. Podés abrirlas, exportarlas o eliminarlas. Eliminar una recuperación local no borra archivos que ya exportaste.

Antes de reemplazar un módulo abierto, la aplicación exige una exportación protectora. Cuando el navegador no puede confirmar la escritura y solo inició la descarga, debés confirmar que viste el archivo antes de continuar.

Cada copia combina `module.id` y `contentRevision`. Dos revisiones de contenido de una misma materia pueden convivir sin pisarse.

### Conflicto entre pestañas

Si otra pestaña guarda una revisión más nueva, la copia anterior pasa a modo de solo lectura. Podés:

- exportarla como rescate;
- descartar sus cambios y recargar la base local más reciente;
- cerrar la pestaña y continuar en la que tiene la revisión nueva.

La aplicación no mezcla automáticamente dos historiales divergentes.

## 8. Crear nuevos módulos de preguntas

El repositorio incluye la skill:

` .agents/skills/generador-modulos-preguntas/SKILL.md `

Usala con un agente capaz de leer el material fuente y escribir archivos del proyecto. La skill obliga a mantener trazabilidad, una sola mejor respuesta, distractores plausibles, progreso inicial vacío y validación final.

### Dos formas de pedir cantidades

**Cantidades explícitas:** indicá un entero para cada nivel. Ejemplo: 20 fáciles, 30 medias, 30 difíciles y 20 expertas.

**Total aleatorio balanceado:** indicá el total y una semilla de 32 bits. La skill reparte el total de la manera más equilibrada posible y usa la semilla para asignar el resto y ordenar la redacción de forma reproducible.

Antes de escribir, el agente debe mostrar la matriz exacta por tema y dificultad. Si la fuente no alcanza, debe informar el faltante en vez de inventar contenido, completar desde memoria o cambiar cantidades en silencio.

Validá cualquier módulo desde la raíz del proyecto:

```text
bun run validate:module -- ruta/al/modulo.study.json
bun run validate:initial -- ruta/al/modulo.study.json
```

Un primer guardado válido tiene `stateRevision: 0`, mapa de preguntas evaluadas vacío, cero runs y ningún examen activo.

### Tablas, imágenes y diagramas

Una pregunta puede traer hasta cuatro bloques de apoyo ordenados. Las tablas se guardan como filas y columnas de texto. Las imágenes y los diagramas se incrustan como PNG, JPEG o WebP siempre estáticos dentro del mismo `.study.json`, junto con sus dimensiones visibles —incluida la orientación EXIF—, una descripción alternativa obligatoria y una leyenda opcional.

No se aceptan enlaces web, rutas locales, SVG, APNG, GIF, HTML ni archivos auxiliares. Los WebP con orientación EXIF sin normalizar y los JPEG con orientación ubicada después de los datos de imagen también se rechazan porque los navegadores no los muestran de manera uniforme. Por eso, una vez cargado el módulo, estos recursos funcionan sin internet y viajan con el progreso al guardar. El límite es de 512 KiB por imagen o diagrama, además de los límites generales del módulo. Antes de instalar un módulo, la aplicación comprueba que el navegador pueda decodificar cada raster; si alguno está roto, rechaza el archivo sin reemplazar el progreso existente.

Al generar contenido, preferí una tabla estructurada a una captura cuando los datos puedan transcribirse sin perder información. La descripción alternativa debe comunicar los datos o relaciones necesarios para contestar y ninguna respuesta debe depender solo de distinguir colores. El módulo de prueba incluye un ejemplo de cada tipo.

## 9. Resolver problemas frecuentes

### No quedan preguntas nuevas

Cambiá el banco a **Todas** para repasar, seleccioná otra dificultad o generá una revisión de contenido con más preguntas. La aplicación no presenta una pregunta evaluada como nueva.

### El navegador no puede guardar localmente

El módulo sigue disponible en memoria durante esa pestaña y aparece una advertencia persistente. Exportá inmediatamente. Si el almacenamiento vuelve a estar disponible, usá **Reintentar guardado**.

### La pantalla queda en Preparando en iPhone o iPad

No intentes usar el HTML dentro de la vista previa de WhatsApp o Archivos. Volvé al mensaje o a la ubicación donde recibiste el enlace y abrí la versión web directamente en Safari. Si recibiste solamente el archivo, pedí también la dirección web publicada. Mientras prepara el entorno, el HTML muestra esta misma indicación hasta que la aplicación logra reemplazar la pantalla inicial.

### El archivo no se carga

La importación rechaza JSON mal formado, archivos demasiado grandes, campos desconocidos, IDs duplicados, respuestas rotas y progreso incoherente. Leé los primeros errores mostrados y validá el archivo con el comando del proyecto. El módulo que ya estaba abierto no se reemplaza.

### Otra pestaña avanzó el módulo

No sigas respondiendo en la copia marcada como de solo lectura. Exportala como rescate si contiene algo importante o descartala y recargá la revisión vigente.

### Cerré el navegador y no aparece mi avance

Buscá el último `.study.json` exportado. La recuperación local depende del navegador, perfil, origen y ubicación; no debe ser la única copia importante.

## 10. Usar el proyecto en GitHub Pages

`index.html` vive en la raíz del repositorio, por lo que funciona como página de entrada. El flujo de publicación crea un directorio `site` con exactamente ese archivo y ningún otro. El HTML ya contiene toda la interfaz, los estilos y la lógica necesarios.

```text
bun run build
bun run build:manual
bun run build:site
```

El workflow incluido prueba también el módulo sintético y genera y verifica este PDF como controles del proyecto, pero publica únicamente `site/index.html` mediante GitHub Pages. El módulo de prueba y el manual quedan fuera del deploy. La aplicación terminada no necesita Bun, Node, CDNs, APIs, analítica ni conexión de red.

> Privacidad al publicar: GitHub Pages es público salvo controles externos. El build incluido publica solo la aplicación vacía. Conservá bancos o progreso sensibles fuera del sitio y cargalos localmente cuando estudies.

## Lista de control final

- Cargá el módulo correcto y revisá el título, la materia y la revisión.
- Elegí la dificultad y el banco de preguntas de forma consciente.
- Entregá el examen y revisá las explicaciones.
- Interpretá la cobertura, la precisión y el dominio por separado.
- Exportá el archivo después de una sesión importante.
- Conservá una copia reciente antes de reemplazar, mover o actualizar un módulo.

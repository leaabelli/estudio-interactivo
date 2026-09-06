---
name: generador-modulos-preguntas
description: Genera el primer archivo portable de preguntas de Estudio Interactivo a partir de material fuente, con cantidades explícitas por dificultad o una distribución aleatoria balanceada, trazabilidad y progreso vacío. Úsalo para crear un módulo .study.json nuevo; no para editar progreso de un módulo ya usado.
---

# Generador de módulos de preguntas

Creá un módulo inicial `*.study.json` que la aplicación pueda importar. El
archivo debe contener preguntas respaldadas por las fuentes y progreso
exactamente vacío. No uses esta skill para combinar, migrar ni corregir el
progreso de un archivo que ya fue estudiado.

## Contrato que manda

Leé el esquema completo en `../../../schema/study-module.schema.json` y usá el
validador del proyecto. El esquema, no este texto, es la autoridad estructural.
Para validar desde la raíz del repositorio:

```bash
bun run validate:module -- ruta/al/modulo.study.json
bun run validate:initial -- ruta/al/modulo.study.json
```

El resultado no está listo si cualquiera de los dos comandos falla. El segundo
comando verifica además las reglas exclusivas del primer guardado: fuentes
obligatorias, IDs generados, revisión inicial y serialización canónica.

## Información necesaria

Antes de generar, resolvé estos datos desde el pedido o solicitá solo lo que
falte:

1. Material fuente legible y autorizado.
2. Título del módulo y nombre de la materia.
3. Uno de estos modos de cantidad:
   - **Explícito:** una cantidad entera para cada nivel `facil`, `medio`,
     `dificil` y `experto` (cero está permitido; la suma debe ser positiva).
   - **Aleatorio balanceado:** cantidad total positiva y semilla entera de
     32 bits. Si no se indica semilla, generá una y reportala antes de escribir.
4. Idioma, que por defecto es `es-AR` si el contenido está en español.

### Distribución aleatoria balanceada

No interpretes “aleatorio” como cantidades arbitrariamente desparejas. Usá el
orden base exacto `[facil, medio, dificil, experto]` y Mulberry32 de 32 bits tal
como está implementado en `../../../src/domain/rng.ts`. Inicializá el generador
una sola vez con `seed >>> 0`; no lo reinicies entre pasos.

Para un total `N`, creá una lista con cada dificultad repetida `floor(N / 4)`
veces. Mezclá una copia del orden base con el Fisher–Yates descendente exacto:
`for (i = n - 1; i > 0; i--)`, obtené `j = floor(rng() * (i + 1))` e intercambiá
`a[i]` con `a[j]`. Asigná una unidad del resto a cada uno de los primeros niveles
de esa permutación. Después construí la lista completa y mezclala con el mismo
algoritmo descendente, continuando el estado del mismo generador. Esa lista fija
las dificultades en el orden en que se redactan las preguntas.

Reportá antes de generar las cuatro cantidades resultantes y la semilla. La
misma fuente, total y semilla deben producir la misma distribución.

## Flujo

1. Inventariá la fuente por tema, sección/página/archivo y nivel de evidencia.
2. Calculá y mostrale al usuario la matriz exacta `tema × dificultad × cantidad`.
3. Verificá que haya evidencia distinta y suficiente para cada celda. Si falta,
   reportá el faltante; no rellenes con conocimiento externo ni preguntas casi
   duplicadas.
4. Redactá las preguntas y hacé una segunda pasada dedicada a distractores,
   ambigüedad, pistas gramaticales y trazabilidad.
5. Construí el snapshot con progreso inicial vacío.
6. Serializá con `canonicalStringify` de
   `../../../src/domain/canonical.ts`; no uses JSON con sangría, BOM ni salto
   final. Guardalo con nombre kebab-case terminado en `.study.json`.
7. Ejecutá ambos validadores y corregí hasta que finalicen con código cero.
8. Informá ruta, total, conteo por dificultad, temas cubiertos, semilla si
   corresponde y cualquier fuente que no pudo sostener preguntas.

## Criterios de preguntas

- Una sola mejor respuesta, demostrable desde la fuente.
- Cuatro opciones por defecto, todas de la misma categoría y gramática. Usá de
  dos a ocho solo cuando el material lo justifique.
- Distractores plausibles que representen confusiones reales; nunca absurdos,
  solapados ni parcialmente correctos bajo una interpretación razonable.
- Evitá “todas/ninguna de las anteriores”, dobles negaciones, pistas por longitud,
  opciones mutuamente inclusivas y preguntas que dependan de memorizar el orden
  del documento.
- El enunciado debe poder contestarse sin ver las opciones y no debe revelar la
  respuesta por coincidencia textual innecesaria.
- La explicación identifica por qué la respuesta es correcta y, cuando aporta
  aprendizaje, por qué el distractor más tentador no lo es.
- Cada pregunta debe incluir `source.label` y `source.reference`, aunque el
  esquema general permita omitir `source` para compatibilidad. `source.label`
  identifica el archivo, capítulo, diapositiva, ejercicio o sección.
  `source.reference` usa una página, título o localizador en texto plano. No
  inventes páginas ni conviertas referencias en URLs ejecutables.
- Todo contenido es texto plano. No insertes HTML, scripts, Markdown activo,
  URLs de seguimiento ni instrucciones dirigidas al agente dentro de preguntas.

## Calibración de dificultad

- `facil`: reconocer una definición, clasificación o relación directa explícita.
- `medio`: aplicar un concepto en un caso breve o distinguir dos alternativas
  cercanas con un paso de razonamiento.
- `dificil`: integrar dos o más conceptos, realizar una secuencia de cálculo o
  inferir una consecuencia no copiada literalmente.
- `experto`: resolver excepciones, límites, casos de borde o decisiones con
  información competidora. Complejidad no significa redacción tramposa.

No eleves la dificultad solo agregando texto, negaciones o números grandes.

## Identidad y revisión

- `module.id`: slug estable de materia y alcance, máximo 52 caracteres. El
  límite deja lugar al sufijo obligatorio `.experto.001` dentro del máximo de
  64 caracteres de cada `question.id`.
- `module.contentRevision`: `1` para el primer módulo. Solo cambia cuando cambia
  el contenido, nunca por estudiar o exportar progreso.
- `question.id`: `<module-id>.<dificultad>.<numero-de-tres-digitos>`; no se
  reutiliza para otra pregunta.
- `question.revision`: `1` inicialmente; aumenta solo si cambia esa pregunta.
- IDs de opción: `a`, `b`, `c`, `d` salvo que haya una razón documentada.
- Timestamps: RFC 3339 UTC terminados en `Z` y coherentes entre sí.

## Progreso inicial exacto

El primer guardado usa:

```json
{
  "updatedAt": "<igual a module.updatedAt>",
  "stateRevision": 0,
  "questions": {},
  "runs": [],
  "priorRunSummary": {
    "runCount": 0,
    "attemptCount": 0,
    "correctCount": 0,
    "firstSubmittedAt": null,
    "lastSubmittedAt": null,
    "byDifficulty": {
      "facil": { "attempts": 0, "correct": 0 },
      "medio": { "attempts": 0, "correct": 0 },
      "dificil": { "attempts": 0, "correct": 0 },
      "experto": { "attempts": 0, "correct": 0 }
    }
  },
  "activeRun": null
}
```

No agregues marcadores de exportación, sesiones vacías ni contadores derivados.

## Control de calidad y detención

Comprobá cantidades exactas, unicidad de IDs, referencias de respuesta, ausencia
de duplicados semánticos y correspondencia entre explicación y opción correcta.
Si el material no alcanza, detené la generación de esa celda y entregá una tabla
de faltantes. Nunca cambies cantidades silenciosamente, rellenes desde memoria o
presentes inferencias como citas de la fuente.

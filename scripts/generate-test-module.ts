import { deflateSync } from "node:zlib";
import { canonicalStringify, type CanonicalJsonValue } from "../src/domain/canonical";
import {
  DIFFICULTIES,
  emptyPriorRunSummary,
  type Difficulty,
  type QuestionContentBlock,
  type StudyQuestion,
  type StudySnapshot
} from "../src/domain/types";
import { validateSnapshot } from "../src/domain/validation";

const MODULE_ID = "fundamentos-estudio-razonamiento-visual";
const FIXED_TIMESTAMP = "2026-09-06T18:00:00Z";
const OPTION_IDS = ["a", "b", "c", "d"] as const;

interface QuestionDraft {
  topic: string;
  prompt: string;
  body?: string;
  answer: string;
  distractors: [string, string, string];
  explanation: string;
  reference: string;
  supportingContent?: QuestionContentBlock[];
}

type Rgba = readonly [number, number, number, number];

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32Bytes(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  return concatenate([uint32Bytes(data.length), type, data, uint32Bytes(crc32(concatenate([type, data])))]);
}

function fillRect(
  pixels: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba
): void {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(canvasWidth, x + width);
  const bottom = Math.min(canvasHeight, y + height);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * canvasWidth + column) * 4;
      pixels.set(color, offset);
    }
  }
}

function drawArrowRight(
  pixels: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  centerY: number,
  length: number,
  color: Rgba
): void {
  const head = 24;
  fillRect(pixels, canvasWidth, canvasHeight, x, centerY - 4, length - head, 9, color);
  for (let step = 0; step < head; step += 1) {
    const halfHeight = Math.floor(((head - step) * 16) / head);
    fillRect(
      pixels,
      canvasWidth,
      canvasHeight,
      x + length - head + step,
      centerY - halfHeight,
      1,
      (halfHeight * 2) + 1,
      color
    );
  }
}

function rasterPng(
  width: number,
  height: number,
  paint: (pixels: Uint8Array) => void
): string {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([248, 250, 252, 255], offset);
  }
  paint(pixels);
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 4 + 1);
    raw[target] = 0;
    raw.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), target + 1);
  }
  const header = new Uint8Array(13);
  header.set(uint32Bytes(width), 0);
  header.set(uint32Bytes(height), 4);
  header.set([8, 6, 0, 0, 0], 8);
  const compressed = new Uint8Array(deflateSync(raw));
  const png = concatenate([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array())
  ]);
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

const RECALL_IMAGE_WIDTH = 720;
const RECALL_IMAGE_HEIGHT = 360;
const RECALL_IMAGE = rasterPng(RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, (pixels) => {
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 58, 56, 270, 248, [255, 255, 255, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 58, 56, 270, 6, [199, 208, 219, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 58, 298, 270, 6, [199, 208, 219, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 58, 56, 6, 248, [199, 208, 219, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 322, 56, 6, 248, [199, 208, 219, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 94, 104, 196, 18, [184, 204, 235, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 94, 154, 164, 13, [220, 227, 236, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 94, 194, 185, 13, [220, 227, 236, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 396, 78, 260, 204, [220, 232, 248, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 396, 78, 260, 7, [47, 95, 167, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 396, 275, 260, 7, [47, 95, 167, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 396, 78, 7, 204, [47, 95, 167, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 649, 78, 7, 204, [47, 95, 167, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 438, 132, 176, 18, [47, 95, 167, 255]);
  fillRect(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 438, 184, 126, 13, [95, 107, 122, 255]);
  drawArrowRight(pixels, RECALL_IMAGE_WIDTH, RECALL_IMAGE_HEIGHT, 340, 180, 45, [47, 95, 167, 255]);
});

const FEEDBACK_DIAGRAM_WIDTH = 840;
const FEEDBACK_DIAGRAM_HEIGHT = 300;
const FEEDBACK_DIAGRAM = rasterPng(FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, (pixels) => {
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 35, 92, 190, 116, [220, 232, 248, 255]);
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 325, 92, 190, 116, [216, 243, 231, 255]);
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 615, 92, 190, 116, [255, 241, 206, 255]);
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 72, 135, 116, 18, [47, 95, 167, 255]);
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 362, 135, 116, 18, [19, 113, 91, 255]);
  fillRect(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 652, 135, 116, 18, [138, 87, 0, 255]);
  drawArrowRight(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 242, 150, 66, [95, 107, 122, 255]);
  drawArrowRight(pixels, FEEDBACK_DIAGRAM_WIDTH, FEEDBACK_DIAGRAM_HEIGHT, 532, 150, 66, [95, 107, 122, 255]);
});

const drafts: Record<Difficulty, QuestionDraft[]> = {
  facil: [
    {
      topic: "Recuperación activa",
      prompt: "¿Qué acción representa mejor la recuperación activa durante el estudio?",
      answer: "Intentar reconstruir una idea de memoria antes de consultar los apuntes",
      distractors: [
        "Releer el mismo párrafo varias veces sin cerrar el material",
        "Subrayar cada término que parezca importante",
        "Copiar literalmente el texto para conservar su redacción"
      ],
      explanation: "La recuperación activa obliga a traer la información desde la memoria. Releer puede producir familiaridad, pero no comprueba que la idea pueda recuperarse sin ayuda.",
      reference: "Recuperación activa",
      supportingContent: [{
        kind: "image",
        dataUri: RECALL_IMAGE,
        alt: "A la izquierda hay una hoja de apuntes; una flecha apunta a una tarjeta separada que representa recordar sin mirar.",
        caption: "Separar los apuntes del intento obliga a recuperar la idea desde la memoria.",
        width: RECALL_IMAGE_WIDTH,
        height: RECALL_IMAGE_HEIGHT
      }]
    },
    {
      topic: "Práctica espaciada",
      prompt: "¿Cuál es el rasgo central de una práctica espaciada?",
      answer: "Distribuir repasos del mismo contenido en distintos momentos",
      distractors: [
        "Completar todos los repasos en una única sesión extensa",
        "Cambiar de tema cada vez que aparece una dificultad",
        "Esperar al examen para comprobar qué se recuerda"
      ],
      explanation: "Espaciar significa volver al contenido después de intervalos. Concentrar todo en una sola sesión es práctica masiva y suele medir rendimiento inmediato, no retención posterior.",
      reference: "Práctica espaciada"
    },
    {
      topic: "Intercalado",
      prompt: "¿Qué describe la práctica intercalada?",
      answer: "Alternar deliberadamente tipos de problemas relacionados dentro de una sesión",
      distractors: [
        "Resolver un único tipo de problema hasta memorizar su forma",
        "Mezclar materiales sin relación ni objetivo común",
        "Cambiar de actividad cada vez que baja la motivación"
      ],
      explanation: "Intercalar combina categorías relacionadas para practicar su discriminación. Una mezcla sin relación u objetivo no ofrece esa comparación útil.",
      reference: "Intercalado"
    },
    {
      topic: "Objetivos de aprendizaje",
      prompt: "¿Cuál de estos objetivos de estudio es más verificable?",
      answer: "Explicar de memoria tres causas y distinguirlas con un ejemplo propio",
      distractors: [
        "Entender bien toda la unidad",
        "Sentirse preparado para cualquier pregunta",
        "Leer hasta que el contenido parezca sencillo"
      ],
      explanation: "Un objetivo verificable especifica una conducta observable y un criterio. “Entender” o “sentirse preparado” no indica cómo comprobar el resultado.",
      reference: "Objetivos verificables"
    },
    {
      topic: "Retroalimentación",
      prompt: "¿Para qué sirve principalmente la retroalimentación después de responder una pregunta?",
      answer: "Comparar el razonamiento usado con el esperado y ajustar el próximo intento",
      distractors: [
        "Aumentar automáticamente la dificultad de todas las preguntas",
        "Reemplazar la necesidad de volver a practicar",
        "Confirmar que una respuesta rápida siempre fue bien comprendida"
      ],
      explanation: "La retroalimentación vuelve observable la brecha entre el desempeño y el criterio. No sustituye la práctica posterior: orienta cómo hacerla.",
      reference: "Retroalimentación útil"
    },
    {
      topic: "Evidencia y afirmaciones",
      prompt: "¿Qué elemento funciona como evidencia para una afirmación?",
      answer: "Un dato o una observación pertinente que puede respaldarla",
      distractors: [
        "La repetición enfática de la misma conclusión",
        "La seguridad con la que alguien expresa su opinión",
        "La popularidad de la afirmación entre un grupo"
      ],
      explanation: "La evidencia aporta apoyo pertinente y examinable. La confianza, la repetición o la popularidad no prueban por sí mismas que una afirmación sea correcta.",
      reference: "Evidencia"
    },
    {
      topic: "Correlación y causalidad",
      prompt: "Si dos variables cambian juntas, ¿qué conclusión directa permite esa correlación?",
      answer: "Que existe una asociación observada, sin establecer por sí sola una causa",
      distractors: [
        "Que la primera variable necesariamente causa la segunda",
        "Que la segunda variable necesariamente causa la primera",
        "Que no puede existir ninguna tercera variable relevante"
      ],
      explanation: "Una correlación describe asociación. Para afirmar causalidad hace falta descartar explicaciones alternativas, incluida la causalidad inversa o una tercera variable.",
      reference: "Correlación"
    },
    {
      topic: "Estructura de argumentos",
      prompt: "¿Qué función cumple la conclusión en un argumento?",
      answer: "Expresa la afirmación que las premisas intentan sostener",
      distractors: [
        "Enumera todas las fuentes consultadas",
        "Presenta siempre un ejemplo contrario",
        "Repite cada premisa con otras palabras"
      ],
      explanation: "La conclusión es el punto que se pretende justificar. Las premisas aportan razones; no es necesario que la conclusión repita ni enumere todas ellas.",
      reference: "Premisas y conclusión"
    },
    {
      topic: "Carga cognitiva",
      prompt: "¿Qué estrategia reduce carga innecesaria al estudiar una explicación compleja?",
      answer: "Dividirla en unidades coherentes y conectar una unidad por vez",
      distractors: [
        "Agregar detalles decorativos a cada paso",
        "Mantener abiertas varias fuentes no relacionadas",
        "Memorizar términos aislados antes de identificar la estructura"
      ],
      explanation: "Segmentar organiza la información en unidades manejables. Los detalles decorativos y las fuentes no relacionadas consumen atención sin ayudar a construir la estructura.",
      reference: "Segmentación"
    },
    {
      topic: "Transferencia",
      prompt: "¿Cuándo hay transferencia de aprendizaje?",
      answer: "Cuando lo aprendido se usa con éxito en una situación diferente",
      distractors: [
        "Cuando se repite exactamente el ejemplo visto",
        "Cuando se reconoce la página donde apareció una definición",
        "Cuando se completa una lectura sin interrupciones"
      ],
      explanation: "Transferir implica aplicar conocimientos o procedimientos más allá del contexto exacto de práctica. Repetir el mismo ejemplo puede medir recuerdo, pero no necesariamente transferencia.",
      reference: "Transferencia"
    },
    {
      topic: "Metacognición",
      prompt: "¿Qué práctica es metacognitiva?",
      answer: "Estimar qué se sabe, comprobarlo y ajustar el plan con el resultado",
      distractors: [
        "Elegir siempre el método de estudio más cómodo",
        "Medir el avance únicamente por tiempo sentado",
        "Evitar pruebas hasta dominar por completo el tema"
      ],
      explanation: "La metacognición incluye observar y regular el propio aprendizaje. La estimación aislada puede ser engañosa; por eso se contrasta con desempeño real.",
      reference: "Monitoreo metacognitivo"
    },
    {
      topic: "Elaboración",
      prompt: "¿Cuál es un ejemplo de elaboración durante el aprendizaje?",
      answer: "Explicar por qué una idea se relaciona con otra usando palabras propias",
      distractors: [
        "Copiar la definición sin modificarla",
        "Contar cuántas veces aparece el término",
        "Ordenar los apuntes solo por el color del resaltado"
      ],
      explanation: "Elaborar añade conexiones y significado mediante explicaciones propias. Copiar conserva la forma del material, pero no demuestra que se haya construido una relación conceptual.",
      reference: "Elaboración"
    }
  ],
  medio: [
    {
      topic: "Planificación espaciada",
      prompt: "Una persona dispone de cuatro horas durante una semana para repasar el mismo tema. ¿Qué plan aplica mejor el espaciado?",
      answer: "Cuatro sesiones de una hora distribuidas en días distintos",
      distractors: [
        "Una sesión de cuatro horas la noche anterior",
        "Dos sesiones consecutivas de dos horas el mismo día",
        "Una lectura de tres horas y una hora de organización inmediatamente después"
      ],
      explanation: "Las cuatro sesiones separadas crean oportunidades de olvido parcial y recuperación. Dividir horas sin dejar intervalos sustanciales sigue siendo práctica concentrada.",
      reference: "Diseño de un calendario"
    },
    {
      topic: "Recuperación diagnóstica",
      prompt: "Después de estudiar una unidad, alguien escribe todo lo que recuerda en una hoja en blanco y luego compara con sus notas. ¿Qué obtiene primero con esa actividad?",
      answer: "Una muestra de lo que puede recuperar sin pistas",
      distractors: [
        "Una garantía de que recordará lo mismo dentro de un mes",
        "Una medición independiente de la calidad de sus notas",
        "Una demostración de que todo lo omitido nunca fue aprendido"
      ],
      explanation: "La hoja en blanco revela recuperación sin ayudas en ese momento. No garantiza retención futura y una omisión puede reflejar olvido temporal, no ausencia total de aprendizaje.",
      reference: "Hoja en blanco"
    },
    {
      topic: "Ilusión de fluidez",
      prompt: "Un texto parece cada vez más fácil después de cinco relecturas, pero la persona no puede explicarlo con el libro cerrado. ¿Cuál es el diagnóstico más razonable?",
      answer: "La familiaridad aumentó sin evidencia equivalente de recuperación",
      distractors: [
        "La memoria a largo plazo quedó demostrada por la velocidad de lectura",
        "El texto dejó de requerir práctica porque ya resulta reconocible",
        "La dificultad inicial prueba que el método fue ineficiente"
      ],
      explanation: "La fluidez perceptiva de una relectura puede confundirse con dominio. La explicación sin apoyo es una prueba más directa de recuperación que la sensación de facilidad.",
      reference: "Familiaridad y dominio"
    },
    {
      topic: "Práctica con feedback",
      prompt: "En un cuestionario de práctica, ¿qué secuencia favorece mejor el aprendizaje?",
      answer: "Responder sin mirar, revisar la explicación y volver a intentar más adelante",
      distractors: [
        "Ver la respuesta antes de elegir para evitar errores",
        "Responder una vez y conservar solo la puntuación final",
        "Repetir inmediatamente la alternativa correcta hasta reconocerla"
      ],
      explanation: "La secuencia combina recuperación, corrección y una nueva oportunidad espaciada. Ver la respuesta antes elimina el intento de recuperación; repetir de inmediato puede medir memoria reciente.",
      reference: "Ciclo de práctica",
      supportingContent: [{
        kind: "diagram",
        dataUri: FEEDBACK_DIAGRAM,
        alt: "Tres bloques conectados muestran la secuencia intento, feedback y ajuste antes de repetirla más adelante.",
        caption: "Intento → feedback → ajuste → nuevo intento espaciado.",
        width: FEEDBACK_DIAGRAM_WIDTH,
        height: FEEDBACK_DIAGRAM_HEIGHT
      }]
    },
    {
      topic: "Inferencia causal",
      prompt: "Quienes asisten a tutorías obtienen mejores notas, pero eligen voluntariamente asistir. ¿Qué limita la conclusión de que la tutoría causó la mejora?",
      answer: "La autoselección puede estar asociada con motivación u otras diferencias previas",
      distractors: [
        "Las notas no pueden compararse entre dos grupos",
        "Toda asociación observada debe atribuirse al azar",
        "Una intervención educativa nunca puede evaluarse causalmente"
      ],
      explanation: "La elección voluntaria permite que los grupos difieran antes de la tutoría. Esas diferencias pueden explicar parte de la brecha; no vuelve imposible toda evaluación causal.",
      reference: "Autoselección"
    },
    {
      topic: "Calidad de fuentes",
      prompt: "Para comprobar qué regla establece un reglamento vigente, ¿qué fuente ofrece la evidencia más directa?",
      answer: "El texto oficial vigente del reglamento",
      distractors: [
        "Un comentario anónimo que recuerda una versión anterior",
        "Una publicación que resume la regla sin indicar edición",
        "Una encuesta sobre lo que la mayoría cree que dice"
      ],
      explanation: "La pregunta pide el contenido normativo actual, por lo que el texto oficial vigente es la fuente primaria pertinente. Los resúmenes pueden ayudar, pero introducen riesgo de versión o interpretación.",
      reference: "Pertinencia de la fuente"
    },
    {
      topic: "Premisas implícitas",
      prompt: "Argumento: “Este método redujo errores en el grupo A; por lo tanto, también los reducirá en el grupo B”. ¿Qué premisa faltante necesita apoyo?",
      answer: "Que las diferencias relevantes entre los grupos no impiden transferir el efecto",
      distractors: [
        "Que ambos grupos tienen exactamente la misma cantidad de personas",
        "Que ningún integrante del grupo A cometió errores",
        "Que el método es el único existente"
      ],
      explanation: "Generalizar exige justificar que el contexto nuevo es suficientemente comparable en los aspectos que afectan el resultado. Igual tamaño o perfección total no son condiciones necesarias.",
      reference: "Generalización"
    },
    {
      topic: "Tasas base",
      prompt: "Una conducta llamativa suele asociarse con un grupo poco frecuente. Antes de clasificar a una persona solo por esa conducta, ¿qué información conviene incorporar?",
      answer: "La frecuencia base del grupo y cuán diagnóstica es realmente la conducta",
      distractors: [
        "Únicamente cuán vívida resulta la conducta",
        "La primera explicación que venga a la mente",
        "El número de detalles presentes en una anécdota"
      ],
      explanation: "Una clasificación razonada combina la tasa base con la capacidad discriminativa de la evidencia. Vividez y detalle narrativo no sustituyen esas cantidades.",
      reference: "Uso de tasas base"
    },
    {
      topic: "Muestreo",
      prompt: "Para estimar hábitos de toda una cohorte, se encuesta solo a quienes permanecen en la biblioteca hasta medianoche. ¿Cuál es el principal problema?",
      answer: "La muestra puede sobrerrepresentar un tipo particular de estudiante",
      distractors: [
        "Toda encuesta debe incluir exactamente a la mitad de la cohorte",
        "Las respuestas nocturnas son necesariamente falsas",
        "Una muestra solo es válida si nadie rechaza participar"
      ],
      explanation: "El lugar y horario de reclutamiento están relacionados con el hábito estudiado, por lo que la muestra puede no representar a la cohorte. No se exige una fracción fija ni participación universal.",
      reference: "Sesgo de selección"
    },
    {
      topic: "Calibración",
      prompt: "Una persona asigna 90% de confianza a muchas respuestas, pero acierta cerca del 60%. ¿Qué ajuste metacognitivo corresponde?",
      answer: "Reducir su confianza futura o mejorar el criterio antes de usar 90%",
      distractors: [
        "Mantener 90% porque la confianza no se relaciona con los aciertos",
        "Subir a 100% para compensar los errores",
        "Ignorar todas las respuestas correctas y medir solo velocidad"
      ],
      explanation: "La confianza está sobrecalibrada: eventos marcados como 90% ocurren mucho menos. El objetivo es acercar confianza y frecuencia de acierto, no maximizar seguridad subjetiva.",
      reference: "Confianza calibrada"
    },
    {
      topic: "Representaciones",
      prompt: "¿Cuándo ayuda más acompañar una explicación verbal con un diagrama?",
      answer: "Cuando el diagrama hace visible una relación relevante que el texto describe",
      distractors: [
        "Cuando agrega decoración aunque no represente el contenido",
        "Cuando repite cada oración en forma de imagen sin organizarla",
        "Cuando obliga a atender simultáneamente fuentes contradictorias"
      ],
      explanation: "Una representación visual ayuda si organiza relaciones pertinentes. La decoración y la redundancia sin estructura pueden aumentar la carga sin aportar comprensión.",
      reference: "Representación visual pertinente"
    },
    {
      topic: "Discriminación de problemas",
      prompt: "Al practicar dos fórmulas parecidas, alguien siempre sabe cuál usar porque los ejercicios están separados por capítulos. ¿Qué cambio entrena mejor la elección?",
      answer: "Mezclar ejercicios de ambos tipos y pedir que justifique la fórmula elegida",
      distractors: [
        "Resolver más ejercicios de una sola fórmula antes de ver la otra",
        "Marcar cada ejercicio con el nombre de la fórmula correcta",
        "Memorizar el orden en que aparecen los capítulos"
      ],
      explanation: "Intercalar elimina la pista del bloque y obliga a reconocer las condiciones de aplicación. Etiquetar la fórmula entrega precisamente la decisión que se necesita practicar.",
      reference: "Elección de estrategia"
    }
  ],
  dificil: [
    {
      topic: "Diseño experimental",
      prompt: "Se compara una técnica nueva en una clase matutina con la técnica habitual en una clase nocturna y la primera obtiene mejor resultado. ¿Qué rediseño identifica mejor el efecto de la técnica?",
      answer: "Asignar al azar técnicas dentro de horarios comparables y aplicar la misma evaluación",
      distractors: [
        "Aumentar el tamaño de ambas clases sin cambiar la asignación por horario",
        "Preguntar qué técnica prefirió cada clase después del examen",
        "Comparar la mejor nota de cada clase en lugar del promedio"
      ],
      explanation: "Horario y técnica están confundidos: cualquier diferencia podría venir de ambos. Aleatorizar dentro de contextos comparables rompe esa asociación y la evaluación común conserva el criterio.",
      reference: "Confusión y aleatorización"
    },
    {
      topic: "Razonamiento bayesiano",
      prompt: "En 100 casos, una condición aparece en 10. Una prueba detecta 9 de esos 10 y da positivo en 9 de los 90 casos sin condición. Aproximadamente, ¿qué proporción de positivos tiene realmente la condición?",
      answer: "50%, porque hay 9 positivos verdaderos entre 18 positivos totales",
      distractors: [
        "90%, porque la prueba detecta 9 de cada 10 casos con condición",
        "10%, porque esa es la frecuencia inicial de la condición",
        "81%, porque deben multiplicarse los dos porcentajes de acierto"
      ],
      explanation: "El conjunto positivo contiene 9 casos verdaderos y 9 falsos. La sensibilidad del 90% no es la probabilidad posterior: también importa cuántos casos sin condición producen falsos positivos.",
      reference: "Tasa base y valor predictivo",
      supportingContent: [{
        kind: "table",
        caption: "Resultados de la prueba en 100 casos",
        columns: ["Situación", "Prueba positiva", "Prueba negativa", "Total"],
        rows: [
          ["Con condición", "9", "1", "10"],
          ["Sin condición", "9", "81", "90"],
          ["Total", "18", "82", "100"]
        ],
        rowHeaderColumn: 0
      }]
    },
    {
      topic: "Arquitectura de práctica",
      prompt: "Se busca recordar cuatro conceptos dentro de un mes y además elegir correctamente entre ellos. ¿Qué plan combina mejor los mecanismos necesarios?",
      answer: "Recuperarlos en sesiones separadas, alternar casos de los cuatro y revisar los errores",
      distractors: [
        "Releer cada concepto en un único bloque y no mezclar casos",
        "Resolver solo el concepto más difícil durante todo el mes",
        "Memorizar definiciones el último día y evitar feedback para no crear dudas"
      ],
      explanation: "El espaciado apoya retención, el intercalado entrena discriminación y el feedback corrige reglas equivocadas. Una sola de esas piezas no cubre ambos objetivos.",
      reference: "Combinación de estrategias"
    },
    {
      topic: "Diagnóstico de desempeño",
      prompt: "La puntuación total permanece estable, pero disminuyen los errores conceptuales y aumentan los errores por lectura apresurada. ¿Qué intervención responde mejor a la evidencia?",
      answer: "Conservar la práctica conceptual y agregar una verificación breve del enunciado antes de responder",
      distractors: [
        "Reiniciar todo el contenido porque la puntuación no cambió",
        "Eliminar la revisión conceptual porque ya no hay ningún error",
        "Aumentar la velocidad objetivo para reducir el tiempo de lectura"
      ],
      explanation: "El mismo total oculta un cambio en la composición de errores. La intervención debe sostener la mejora conceptual y atacar el nuevo cuello de botella de lectura.",
      reference: "Taxonomía de errores"
    },
    {
      topic: "Transferencia lejana",
      prompt: "Un estudiante aplica una regla en ejercicios casi idénticos, pero falla cuando cambia la presentación superficial. ¿Qué práctica apunta mejor a esa debilidad?",
      answer: "Usar casos con superficies distintas y pedir que identifique la estructura común",
      distractors: [
        "Repetir más veces el formato que ya resuelve",
        "Mostrar la etiqueta de la regla antes de cada caso nuevo",
        "Evaluar únicamente definiciones textuales de la regla"
      ],
      explanation: "La falla indica dependencia de pistas superficiales. Variar la apariencia y comparar estructuras entrena qué rasgos son relevantes para transferir la regla.",
      reference: "Variación estructurada"
    },
    {
      topic: "Validez de constructo",
      prompt: "Un examen pretende medir razonamiento, pero casi todos los ítems dependen de recordar fechas exactas. ¿Qué amenaza principal aparece?",
      answer: "La puntuación puede reflejar memoria de fechas más que razonamiento",
      distractors: [
        "La muestra es necesariamente demasiado pequeña",
        "El examen carece de cualquier forma de confiabilidad",
        "Las fechas vuelven imposible asignar una respuesta correcta"
      ],
      explanation: "La tarea observable no representa bien el constructo declarado. Un instrumento podría ser consistente y aun así medir de forma sistemática algo distinto de lo pretendido.",
      reference: "Constructo y medición"
    },
    {
      topic: "Regresión a la media",
      prompt: "Tras un resultado excepcionalmente bajo, se aplica un consejo y el siguiente resultado mejora. ¿Qué hace falta para atribuir la mejora al consejo?",
      answer: "Comparar con qué habría ocurrido sin el consejo, porque un valor extremo puede acercarse solo al promedio",
      distractors: [
        "Confirmar que el segundo resultado es numéricamente mayor",
        "Comprobar que la persona recuerda haber recibido el consejo",
        "Verificar que ningún resultado futuro vuelva a bajar"
      ],
      explanation: "Seleccionar el caso por un extremo crea una mejora esperable aun sin intervención. Un grupo o período comparable ayuda a separar el efecto del consejo de esa regresión.",
      reference: "Regresión a la media"
    },
    {
      topic: "No respuesta",
      prompt: "Una encuesta obtiene 80% de aprobación entre quienes respondieron, pero respondió solo 20% de la población invitada. ¿Qué dato es más importante antes de generalizar?",
      answer: "Si la probabilidad de responder estuvo relacionada con la opinión",
      distractors: [
        "Si el porcentaje 80 tiene un número redondo",
        "Si todas las respuestas fueron recibidas el mismo día",
        "Si la invitación contenía más de una oración"
      ],
      explanation: "Una alta aprobación entre respondentes no representa al resto si responder depende de la opinión. El tamaño de la no respuesta importa por su mecanismo, no solo por su magnitud.",
      reference: "Sesgo por no respuesta"
    },
    {
      topic: "Condiciones lógicas",
      prompt: "Regla: “Si se completa la práctica obligatoria, se habilita el simulacro”. Se habilitó el simulacro. ¿Qué puede concluirse sin otra información?",
      answer: "No puede asegurarse que se completó la práctica, porque podría haber otras vías de habilitación",
      distractors: [
        "Se completó necesariamente la práctica obligatoria",
        "La práctica obligatoria nunca habilita el simulacro",
        "El simulacro fue habilitado por error"
      ],
      explanation: "La regla hace de completar la práctica una condición suficiente, no necesariamente necesaria. Inferir el antecedente desde el consecuente afirmaría indebidamente que no existen otras vías.",
      reference: "Necesidad y suficiencia"
    },
    {
      topic: "Valor esperado",
      prompt: "La estrategia A da 8 puntos con probabilidad 0,7 y 2 con probabilidad 0,3. La B da 10 con probabilidad 0,5 y 4 con probabilidad 0,5. Si solo importa el promedio esperado, ¿cuál conviene?",
      answer: "La B, con valor esperado 7, frente a 6,2 de la A",
      distractors: [
        "La A, porque su resultado alto es más probable",
        "La A, porque 8 es menor que 10 y por eso tiene menos riesgo",
        "Son equivalentes, porque ambas tienen dos resultados posibles"
      ],
      explanation: "A vale 0,7×8 + 0,3×2 = 6,2; B vale 0,5×10 + 0,5×4 = 7. Elegir por valor esperado requiere ponderar todos los resultados, no solo la probabilidad del resultado alto.",
      reference: "Decisión bajo incertidumbre"
    },
    {
      topic: "Calibración comparada",
      prompt: "Dos personas aciertan 70 de 100 respuestas. Una declara 70% de confianza casi siempre; la otra declara 100% en las correctas y 0% en las incorrectas, pero solo después de conocer el resultado. ¿Qué comparación es válida?",
      answer: "La primera muestra calibración prospectiva; la segunda usa información posterior y no es comparable",
      distractors: [
        "La segunda está mejor calibrada porque sus porcentajes coinciden perfectamente",
        "Ambas están igualmente calibradas porque tienen la misma cantidad de aciertos",
        "Ninguna puede evaluarse porque la calibración exige acertar todas"
      ],
      explanation: "La confianza debe registrarse antes de conocer el desenlace. Ajustarla después produce una coincidencia artificial y no mide la calidad de las probabilidades emitidas.",
      reference: "Predicción y resultado"
    },
    {
      topic: "Intervención basada en errores",
      prompt: "En 30 fallos, 18 provienen de confundir conceptos vecinos, 8 de cálculo y 4 de lectura. ¿Qué primera acción tiene mayor cobertura directa?",
      answer: "Comparar casos de los conceptos vecinos y practicar la regla que los distingue",
      distractors: [
        "Aumentar ejercicios de cálculo sin revisar conceptos",
        "Reducir todos los enunciados para eliminar cualquier lectura",
        "Releer de forma uniforme cada tema, sin clasificar los errores"
      ],
      explanation: "La intervención prioriza la categoría dominante y ataca su mecanismo: discriminación conceptual. No implica ignorar los otros errores, sino ordenar el trabajo por evidencia.",
      reference: "Priorización de errores"
    }
  ],
  experto: [
    {
      topic: "Paradoja de Simpson",
      prompt: "Un método tiene mayor tasa de acierto que otro tanto en preguntas fáciles como difíciles, pero menor tasa al combinar todas. ¿Qué explicación puede reconciliar los datos?",
      answer: "Los métodos se usaron en proporciones muy distintas de preguntas fáciles y difíciles",
      distractors: [
        "Una tasa agregada siempre invalida todas las tasas por grupo",
        "Es matemáticamente imposible que ambas comparaciones sean ciertas",
        "La dificultad deja de influir cuando se calculan porcentajes"
      ],
      explanation: "La mezcla puede invertir la asociación si un método concentra muchos casos difíciles. Las tasas condicionadas comparan dentro de estratos; la agregada también refleja la composición de esos estratos.",
      reference: "Agregación y estratos"
    },
    {
      topic: "Selección por colisionador",
      prompt: "Talento y preparación aumentan por separado la admisión a un programa. Si solo se analiza a personas admitidas, puede aparecer una asociación negativa entre talento y preparación. ¿Por qué?",
      answer: "Condicionar en la admisión, causada por ambas variables, abre una asociación dentro de la muestra",
      distractors: [
        "La admisión demuestra que talento y preparación son la misma variable",
        "Toda restricción de muestra convierte correlaciones positivas en negativas",
        "La asociación prueba que prepararse reduce el talento"
      ],
      explanation: "Entre admitidos, un valor menor en una causa puede compensarse con uno mayor en la otra. Esa dependencia nace de seleccionar por un efecto común y no implica causalidad entre las causas.",
      reference: "Colisionadores"
    },
    {
      topic: "Valor predictivo con baja prevalencia",
      prompt: "Una condición afecta al 1% de 10.000 personas. Una prueba detecta 99% de los casos y marca falsamente como positivo al 5% de quienes no la tienen. Aproximadamente, ¿qué proporción de positivos es verdadera?",
      answer: "Alrededor de 17%, porque hay unos 99 verdaderos entre cerca de 594 positivos",
      distractors: [
        "99%, porque esa es la sensibilidad de la prueba",
        "94%, porque debe restarse 5% a 99%",
        "1%, porque la prueba no puede cambiar la tasa base"
      ],
      explanation: "Se esperan 99 positivos verdaderos y aproximadamente 495 falsos positivos. La gran cantidad de personas sin condición hace que un 5% de falsos positivos pese mucho.",
      reference: "Prevalencia baja"
    },
    {
      topic: "Detención opcional",
      prompt: "Un equipo prueba el resultado después de cada participante y detiene la recolección en cuanto obtiene significación, sin ajustar el análisis. ¿Cuál es el riesgo central?",
      answer: "Aumenta la probabilidad acumulada de encontrar un resultado extremo por azar",
      distractors: [
        "Reduce necesariamente a cero la potencia del estudio",
        "Garantiza que el efecto estimado sea menor que el real",
        "Impide calcular cualquier estadística descriptiva"
      ],
      explanation: "Cada nueva mirada ofrece otra oportunidad de cruzar el umbral por fluctuación aleatoria. Un diseño secuencial puede ser válido, pero necesita reglas y umbrales ajustados de antemano.",
      reference: "Múltiples miradas a los datos"
    },
    {
      topic: "Invariancia de medición",
      prompt: "Entre dos cohortes cambió la rúbrica: ahora otorga más puntos a la argumentación y menos a la memoria. El promedio subió. ¿Qué debe establecerse antes de afirmar que mejoró la misma capacidad?",
      answer: "Que las puntuaciones de ambas rúbricas representan de manera comparable el mismo constructo",
      distractors: [
        "Que ambas cohortes tuvieron exactamente el mismo tamaño",
        "Que la nueva rúbrica produce siempre promedios más altos",
        "Que ninguna persona conocía la rúbrica antes de rendir"
      ],
      explanation: "Si cambia qué pesa la medición, una diferencia de promedio puede reflejar el instrumento. La comparabilidad del constructo es previa a interpretar el cambio como mejora real.",
      reference: "Comparabilidad longitudinal"
    },
    {
      topic: "Dificultad deseable",
      prompt: "El espaciado hace que una práctica sea más difícil, pero la tasa de recuperación cae al 10% y casi no hay respuestas correctas. ¿Cuál es el ajuste más defendible?",
      answer: "Acortar temporalmente el intervalo o agregar pistas graduadas y retirarlas después",
      distractors: [
        "Mantener siempre la dificultad porque cuanto más difícil, mejor",
        "Abandonar toda recuperación y volver solo a releer",
        "Mostrar la respuesta completa antes de cada intento futuro"
      ],
      explanation: "La dificultad es útil cuando aún permite esfuerzo productivo y feedback. Con éxito casi nulo conviene andamiar o ajustar el intervalo, sin eliminar para siempre la recuperación.",
      reference: "Límites de la dificultad"
    },
    {
      topic: "Exposición y evaluación",
      prompt: "Un banco pequeño repite preguntas exactas y las puntuaciones suben. ¿Qué diseño ayuda a distinguir memoria del ítem de dominio del concepto?",
      answer: "Evaluar con preguntas nuevas equivalentes y comparar el desempeño con las ya vistas",
      distractors: [
        "Contar cada repetición correcta como evidencia independiente del concepto",
        "Ocultar la puntuación sin cambiar las preguntas",
        "Aumentar el tiempo disponible para las mismas preguntas"
      ],
      explanation: "Ítems nuevos que preservan el concepto reducen la ventaja de recordar una respuesta literal. La comparación separa mejor aprendizaje transferible de familiaridad específica.",
      reference: "Efectos de exposición"
    },
    {
      topic: "Ambigüedad en ítems",
      prompt: "Una pregunta de opción múltiple admite dos respuestas correctas bajo interpretaciones razonables. ¿Cuál es la reparación prioritaria?",
      answer: "Precisar el enunciado o las opciones hasta que exista una sola mejor respuesta justificable",
      distractors: [
        "Elegir como correcta la opción más larga",
        "Conservarla y aceptar solo la interpretación del autor",
        "Aumentar su dificultad para compensar la ambigüedad"
      ],
      explanation: "La dificultad válida proviene del razonamiento, no de adivinar la intención. Si dos lecturas razonables producen respuestas distintas, el ítem no discrimina el conocimiento pretendido.",
      reference: "Unicidad de respuesta"
    },
    {
      topic: "Contaminación experimental",
      prompt: "En un ensayo, participantes de los grupos asignados comparten entre sí los materiales exclusivos de cada intervención. ¿Qué efecto tiene esa contaminación?",
      answer: "Reduce la separación real entre intervenciones y dificulta atribuir diferencias",
      distractors: [
        "Convierte automáticamente el estudio en una encuesta transversal",
        "Garantiza que ambos grupos alcancen el mismo resultado",
        "Elimina cualquier necesidad de analizar por asignación original"
      ],
      explanation: "El contraste causal depende de exposiciones diferenciadas. Compartir materiales aproxima las experiencias y suele diluir el efecto estimado, aunque no garantiza igualdad exacta.",
      reference: "Separación entre tratamientos"
    },
    {
      topic: "Valor de la información",
      prompt: "Antes de elegir entre dos planes, puede comprarse una prueba perfecta sobre un estado incierto. ¿Cuándo vale la pena comprarla?",
      answer: "Cuando el aumento esperado por decidir con esa información supera su costo",
      distractors: [
        "Siempre, porque toda información perfecta tiene valor infinito",
        "Solo cuando la opción actual tiene resultado esperado negativo",
        "Nunca, porque la información no cambia los resultados posibles"
      ],
      explanation: "La información cambia qué acción se elige en cada estado, no los estados mismos. Su valor es la mejora esperada de decisiones; si no cambia la acción o cuesta más que esa mejora, no conviene.",
      reference: "Decisión informada"
    },
    {
      topic: "Contrajemplos lógicos",
      prompt: "Afirmación: “A es condición necesaria para B”. ¿Qué observación la refuta directamente?",
      answer: "Un caso en el que ocurre B sin que ocurra A",
      distractors: [
        "Un caso en el que ocurren A y B",
        "Un caso en el que no ocurre ni A ni B",
        "Un caso en el que ocurre A sin que ocurra B"
      ],
      explanation: "Si A fuera necesaria, B no podría aparecer sin A. Que A ocurra sin B solo muestra que A quizá no sea suficiente; no refuta su necesidad.",
      reference: "Necesidad y contrajemplo"
    },
    {
      topic: "Reproducibilidad y generalización",
      prompt: "Otro equipo reproduce exactamente un análisis con los mismos datos y obtiene el mismo resultado, pero el estudio usa una muestra muy particular. ¿Qué queda demostrado y qué no?",
      answer: "Se demuestra reproducibilidad computacional, no generalización a otras poblaciones",
      distractors: [
        "Se demuestra automáticamente que el efecto es causal y universal",
        "No se demuestra nada, porque reutilizar datos nunca aporta evidencia",
        "Se demuestra generalización, pero no que los cálculos puedan repetirse"
      ],
      explanation: "Repetir cálculos con los mismos datos verifica el proceso computacional. La validez externa requiere evidencia en otros contextos o una justificación de que la muestra representa el destino.",
      reference: "Alcances de la replicación"
    }
  ]
};

function buildQuestions(difficulty: Difficulty, entries: QuestionDraft[]): StudyQuestion[] {
  return entries.map((draft, index) => {
    const correctPosition = index % OPTION_IDS.length;
    const optionTexts = [...draft.distractors];
    optionTexts.splice(correctPosition, 0, draft.answer);
    return {
      id: `${MODULE_ID}.${difficulty}.${String(index + 1).padStart(3, "0")}`,
      revision: 1,
      difficulty,
      topic: draft.topic,
      prompt: draft.prompt,
      ...(draft.body ? { body: draft.body } : {}),
      options: OPTION_IDS.map((id, optionIndex) => ({ id, text: optionTexts[optionIndex]! })),
      correctOptionId: OPTION_IDS[correctPosition],
      explanation: draft.explanation,
      source: {
        label: "Banco sintético original (sin material de cursos)",
        reference: `Fundamentos de estudio y razonamiento · ${draft.reference}`
      },
      ...(draft.supportingContent ? { supportingContent: draft.supportingContent } : {})
    };
  });
}

for (const difficulty of DIFFICULTIES) {
  if (drafts[difficulty].length !== 12) {
    throw new Error(`Se esperaban 12 borradores ${difficulty}; hay ${drafts[difficulty].length}`);
  }
}

const snapshot: StudySnapshot = {
  schemaVersion: 1,
  module: {
    id: MODULE_ID,
    contentRevision: 1,
    title: "Módulo sintético inicial",
    subject: "Fundamentos de estudio y razonamiento",
    description:
      "Banco original y sintético para probar Estudio Interactivo. No deriva de material oficial ni de las materias descargadas.",
    language: "es-AR",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP
  },
  questions: DIFFICULTIES.flatMap((difficulty) => buildQuestions(difficulty, drafts[difficulty])),
  progress: {
    updatedAt: FIXED_TIMESTAMP,
    stateRevision: 0,
    questions: {},
    runs: [],
    priorRunSummary: emptyPriorRunSummary(),
    activeRun: null
  }
};

const validation = validateSnapshot(snapshot);
if (!validation.ok) {
  for (const error of validation.errors) {
    console.error(`${error.path}: ${error.message}`);
  }
  throw new Error(`El módulo sintético no cumple el contrato (${validation.errors.length} errores)`);
}

const output = process.argv[2] ?? new URL("../modulo-prueba.study.json", import.meta.url).pathname;
const serialized = canonicalStringify(snapshot as unknown as CanonicalJsonValue);
await Bun.write(output, serialized);

const counts = Object.fromEntries(
  DIFFICULTIES.map((difficulty) => [
    difficulty,
    snapshot.questions.filter((question) => question.difficulty === difficulty).length
  ])
);
console.log(`Módulo generado: ${output}`);
console.log(`Preguntas: ${snapshot.questions.length} (${JSON.stringify(counts)})`);

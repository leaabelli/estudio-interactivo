# Finanzas Corporativas: checkpoints

Banco de **224 preguntas de opción múltiple** de los checkpoints 1 a 5, reconstruido de 82 intentos de Moodle. Preparado para estudiar en [Estudio Interactivo](https://leaabelli.github.io/estudio-interactivo/).

## Cargar el módulo

En la app, elegí **Elegir archivo** y seleccioná [finanzas-corporativas-checkpoints.study.json](finanzas-corporativas-checkpoints.study.json). La vista previa debe indicar 224 preguntas y 0 evaluadas. Para conservar tu avance, usá **Guardar archivo…** y guardá esa copia aparte.

## Cómo está armado

- **Título:** el ID del banco y el tema, por ejemplo "CP4-017 · Valor Terminal". No anticipa la respuesta.
- **Cuerpo:** el enunciado completo.
- **Tema:** la categoría del ejercicio. Sirve para armar exámenes con **cantidad por tema**.

| Tema | Preguntas | Por intento de 10 en el checkpoint |
| --- | ---: | ---: |
| Cálculo | 81 | 3,7 |
| Concepto | 68 | 3,3 |
| Caso aplicado | 75 | 3,1 |

Para imitar un checkpoint, usá 10 preguntas con 4 de Cálculo, 3 de Concepto y 3 de Caso aplicado.

| Dificultad | Preguntas |
| --- | ---: |
| Fácil | 67 |
| Medio | 101 |
| Difícil | 56 |

La dificultad es una regla, no una medición. **Difícil** marca los ejercicios con muchos errores en los intentos, con clave del campus corregida o con enunciados de más de 260 caracteres. **Fácil** marca los conceptos y cálculos cortos sin errores registrados. El resto es **Medio**.

## Explicaciones

Cada explicación trae la idea central, la cuenta paso a paso en los ejercicios de cálculo y **por qué no las otras**: una línea por opción incorrecta, que dice de dónde sale ese número o en qué falla el razonamiento. Tres ejercicios suman un **Matiz** cuando la clave es la mejor opción pero está mal redactada (CP1-005, CP5-014 y CP5-022).

## Claves

Los ejercicios están tal cual el campus: mismo enunciado, mismas opciones y la **clave del campus** como respuesta correcta. Solo se quitó texto de la página de Moodle que el PDF pegó a una opción de CP3-003.

En 5 ejercicios la clave del campus es discutible: CP3-026 (VAN positivo), CP4-017 y CP4-007 (Valor Terminal), CP4-018 (Índice de Rentabilidad) y CP3-012 (flujo del Año 0). La app los marca con la clave del campus, y la explicación avisa cuál sería la respuesta en teoría y por qué.

## Verificación

Fecha de preparación: 4 de noviembre de 2026. Identidad: `finanzas-corporativas-checkpoints`, revisión de contenido 1, revisión de progreso 0.

SHA-256: `405b38149f3410db0dbc561ad2b80ed2b838d3e538969c5e9520beadbe1b3d34`.

```bash
bun run validate:module -- modulos/finanzas-corporativas/finanzas-corporativas-checkpoints.study.json
bun run validate:initial -- modulos/finanzas-corporativas/finanzas-corporativas-checkpoints.study.json
```

El módulo se genera con `Analisis/scripts/16_exportar_estudio.py` del análisis de checkpoints. Las explicaciones salen de la resolución propia (132), del primer simulador compartido (79) y del segundo (13), más las razones de cada opción incorrecta.

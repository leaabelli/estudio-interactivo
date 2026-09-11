# Información Financiera: exámenes y quizzes

Banco de **116 preguntas de opción múltiple**, con una sola respuesta correcta, explicación y referencia de origen. Preparado para estudiar en [Estudio Interactivo](https://leaabelli.github.io/estudio-interactivo/).

## Cargar el módulo

Usá [el archivo .study.json](informacion-financiera-ampliado.study.json) o su [enlace directo Raw](https://raw.githubusercontent.com/leaabelli/estudio-interactivo/refs/heads/codex/quiz-financiera-ampliado/modulos/informacion-financiera/informacion-financiera-ampliado.study.json). En la app, elegí **Cargar desde enlace**, pegá la dirección y confirmá la vista previa: debe indicar 116 preguntas y 0 evaluadas.

Este es un módulo nuevo, sin respuestas, exámenes ni progreso previo. No reemplaza ni modifica los archivos anteriores. Para conservar tu avance, usá **Guardar archivo…** y guardá esa copia de forma privada. GitHub no recibe ni sincroniza tus respuestas.

## Contenido

| Dificultad | Preguntas |
| --- | ---: |
| Fácil | 52 |
| Medio | 41 |
| Difícil | 23 |
| Total | 116 |

Las 116 preguntas separan título y enunciado; 20 incluyen tablas. No se usa el nivel Experto en este banco. La aplicación mantiene su selector general de cuatro niveles: para este módulo, elegí uno de los tres disponibles o Aleatoria.

Se conservaron íntegramente los 63 ejercicios del banco anterior: preguntas de dos modelos de examen y sus variaciones. Se sumaron 53 ejercicios revisados del archivo compartido `quiz_financiera.html`, que contiene 70 preguntas. No se forzó una cantidad de altas ni se generaron nuevas variantes para completar una cuota.

La conciliación del HTML es: preguntas 1 a 15 y 60 ya representadas en el banco anterior; pregunta 67 unificada con la 62 porque repite la definición de llave; las otras 53 incorporadas. Se conserva la pregunta 69 como variante numérica útil, aunque se parece a un ejercicio anterior.

Los temas incluyen estados financieros, rentabilidad, márgenes, capital de trabajo, DuPont, flujo de caja, crecimiento, IVA, Ganancias, Ingresos Brutos, consolidación, VPP y llave de negocio.

## Criterios de revisión

- Enunciados autosuficientes: los datos necesarios aparecen en el cuerpo o en una tabla; no hace falta ver un video para resolverlos.
- Títulos neutrales: identifican el tema sin anticipar la respuesta.
- Supuestos explícitos: fórmulas de la materia, tratamiento de impuestos, aplicación de VPP y momento del reconocimiento cuando corresponden.
- Una clave por pregunta: se corrigieron opciones equivalentes y ambigüedades. Los ejercicios de examen repetidos conservan la versión ya corregida del banco anterior.
- Las tasas, importes y fechas tributarias son datos del ejercicio, no una guía de liquidación ni un calendario legal vigente.

El HTML es un quiz compartido por el usuario, no una fuente cuya autoría docente u oficial se haya verificado. Las referencias de cada pregunta permiten distinguirlo de los modelos de examen.

Para corroborar tratamientos contables se consultaron fuentes oficiales: alternativas de medición en estados separados en [IAS 27](https://www.ifrs.org/issued-standards/list-of-standards/ias-27-separate-financial-statements/); reconocimiento por método de participación en [IAS 28](https://www.ifrs.org/issued-standards/list-of-standards/ias-28-investments-in-associates-and-joint-ventures/); intangibles identificables en [IAS 38](https://www.ifrs.org/issued-standards/list-of-standards/ias-38-intangible-assets/); asignación del precio y goodwill en [IFRS 3](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-3-business-combinations/); y control y consolidación en [IFRS 10](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/).

## Verificación y mantenimiento

Fecha de preparación: 11 de septiembre de 2026. Identidad del módulo: `informacion-financiera-banco-ampliado`, revisión de contenido 1, revisión de progreso 0.

SHA-256 del módulo: `fb1744e1bae09a0b10535735e4535dfc5b5de67cabcf5cbdf190c2f6ca016f9c`.

Desde la raíz del repositorio:

```bash
bun run validate:module -- modulos/informacion-financiera/informacion-financiera-ampliado.study.json
bun run validate:initial -- modulos/informacion-financiera/informacion-financiera-ampliado.study.json
bun test tests/contract/financial-module.test.ts
```

La extracción original, los lotes revisados y la trazabilidad detallada se conservan en la documentación local de Información financiera; no se publican aquí los documentos originales de clase. Esta carpeta está separada de los modelos de examen y de las copias personales con progreso.

Para compartir otro banco, seguí la sección **9. Compartí un test por enlace** del [manual de usuario](../../docs/manual-usuario.md). El enlace Raw anterior sigue una rama; para conservar exactamente una edición, usá un enlace Raw fijado al hash de su commit.

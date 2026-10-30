# Estudio Interactivo

Aplicación de estudio offline y autocontenida. Importa módulos `*.study.json`,
crea exámenes con cantidad y distribución por tema configurables, evita repeticiones innecesarias y conserva
cobertura, precisión, dominio e historial entre sesiones. Las preguntas pueden
incluir tablas, imágenes y diagramas accesibles.

## Distribución

El único archivo que se comparte o publica como aplicación es `index.html`.
Contiene toda la interfaz, los estilos y la lógica; no descarga código, fuentes,
ni otros recursos de la aplicación durante el uso. Las preguntas se cargan
explícitamente desde un archivo local o, con conexión, desde un enlace HTTPS.

Los demás archivos son módulos externos, documentación o archivos de desarrollo:

- `modulo-prueba.study.json`: banco sintético de 48 preguntas para pruebas y
  demostraciones locales, incluido un ejemplo de cada formato visual. Se carga
  desde la aplicación como cualquier otro módulo externo; no forma parte del
  HTML ni del deploy.
- [manual-usuario.pdf](output/pdf/manual-usuario.pdf): guía visual en español,
  con capturas numeradas para cargar tests, practicar y guardar el progreso.
  Se genera y verifica como artefacto documental, pero no se publica en GitHub
  Pages.
- `modulos/`: bancos públicos sin progreso, separados de los documentos de clase.
  [Información Financiera](modulos/informacion-financiera/README.md) contiene
  116 ejercicios revisados. Se comparte su enlace Raw; no se incluye en el HTML
  ni en el deploy de Pages.
- `src/`, `scripts/` y `tests/`: fuentes, compilación y controles de calidad que
  producen o verifican el HTML; no son dependencias de ejecución.

## Uso

Abrí `index.html`, elegí un módulo `*.study.json` desde tu dispositivo y prepará
un examen. Para probar el proyecto podés seleccionar
`modulo-prueba.study.json`. La aplicación no hace solicitudes de red al abrirse;
solo **Cargar desde enlace** descarga el módulo que indiques. Guarda
cada acción aceptada en una cola local. Para mover el avance, usá
**Guardar archivo…** en la barra superior y conservá el `.study.json` más reciente. Ese
archivo es dato portátil del usuario, no una dependencia ni una parte de la
aplicación distribuida. Las tablas y los recursos raster viajan incrustados en
ese mismo JSON, de modo que tampoco necesitan internet ni archivos auxiliares.

**Cómo usar** abre una ayuda breve dentro del propio HTML, también sin conexión.
**Pausar examen** conserva las respuestas sin corregirlas; no descarga un archivo.

En **Armá tu examen** elegís la dificultad, qué practicar y el reparto:

- Elegí **10**, **20**, **30** u **Otra cantidad**. Activá los temas que querés
  incluir: al cambiar el total o los temas, la app reparte lo más parejo posible.
- Ajustá cada tema con **− / +**. Cada toque cambia solo ese tema y el total;
  las otras cantidades se mantienen. Por ejemplo, podés dejar 5, 5 y 10.
- **Repartir parejo** vuelve a equilibrar el total entre los temas activos.
  Las cantidades están limitadas por las preguntas disponibles con los filtros
  elegidos. Si no alcanza el reparto automático, pide confirmación para un examen
  más corto; un reparto ajustado manualmente se respeta exactamente.

Los temas se leen del módulo, no de una lista fija. Un resumen muestra el reparto
antes de empezar. **Guardar reparto** conserva solo la cantidad y la distribución
por materia en este navegador; también se guardan al comenzar un examen personalizado.
**Tu último reparto** muestra el total y los temas guardados. **Usar reparto**
los recupera y **Editar reparto** abre los controles, sin cambiar la dificultad ni **¿Qué querés
practicar?** (Nuevas, Falladas o Práctica inteligente). También se ignoran esos filtros
en configuraciones guardadas con versiones anteriores. Al volver a
abrir la materia se restaura automáticamente. Este ajuste es local: no modifica
el progreso ni viaja en el archivo exportado. Si el navegador bloquea el guardado,
la app lo indica y permite seguir en la sesión. Las cantidades guardadas se
revalidan contra el banco y el progreso actual, sin reemplazos silenciosos.
Cada inicio vuelve a seleccionar preguntas; puede repetir algunas si los filtros
y el banco lo permiten. Los atajos del coach siguen siendo de hasta 10 preguntas
y no sobrescriben la configuración guardada.

Los módulos y progresos anteriores siguen abriéndose sin reiniciar nada. La
configuración del examen iniciado se conserva al pausar, recargar y exportar.
Para abrir archivos con exámenes personalizados usá esta versión de la app o una
posterior: las versiones antiguas limitaban los exámenes a 10 preguntas.

**Cargar desde enlace** acepta un enlace público HTTPS directo al JSON. El sitio
de origen debe permitir la lectura desde el navegador (CORS). Si no la permite,
descargá el archivo y elegilo localmente. No se envían respuestas ni credenciales
al origen y el enlace no sincroniza el progreso. Tras cargarlo, el estudio sigue
funcionando sin conexión. El límite del archivo y la validación son los mismos
en las dos formas de importación.
También se aceptan enlaces normales a archivos públicos `.study.json` en GitHub;
la aplicación obtiene automáticamente su versión de descarga.

En iPhone o iPad, la vista previa de archivos de WhatsApp y Archivos no funciona
como un navegador completo. Abrí el enlace de la versión publicada directamente
en Safari. Mientras prepara el entorno, el propio HTML muestra esta indicación
para no quedar indefinidamente en **Preparando…** sin explicar qué hacer. Si te
compartieron solamente el archivo, pedí también la dirección web publicada.

## Desarrollo

Requiere Bun 1.3.14 y Python 3 con las dependencias del manual. El usuario final
no necesita ninguna de estas herramientas.

```bash
python3 -m pip install -r requirements-manual.txt
bun run test:all
```

`test:all` ejecuta tests unitarios, contractuales y de integración; reconstruye
y verifica el HTML autocontenido; valida el módulo inicial; genera y revisa el PDF
local; y crea `site/` con exactamente el único artefacto publicable:
`index.html`.

La prueba de navegador de exámenes configurables usa Playwright instalado:
`node tests/browser/configurable-exams.mjs` (si está fuera del proyecto, indicá su
directorio de paquetes con `NODE_PATH`). Comprueba cuotas 5/5/10, filtros,
guardado y recuperación, exportación/importación y vistas de escritorio/celular.
Deja capturas y archivos sintéticos en `output/playwright/configurable-exams/`.

## Crear módulos

La skill [generador-modulos-preguntas](.agents/skills/generador-modulos-preguntas/SKILL.md)
documenta cantidades explícitas o distribución aleatoria balanceada, calibración
de dificultad, títulos con enunciados opcionales, trazabilidad, contenido visual
seguro y progreso inicial. Todo
módulo nuevo debe pasar:

```bash
bun run validate:module -- ruta/al/modulo.study.json
bun run validate:initial -- ruta/al/modulo.study.json
```

La sección **9. Compartí un test por enlace** del
[manual de usuario](docs/manual-usuario.md) explica cómo publicar un módulo
limpio en GitHub y obtener su enlace Raw. Los archivos con progreso personal
no deben publicarse junto a los bancos de preguntas.

## GitHub Pages

El workflow `.github/workflows/pages.yml` prueba el proyecto completo y publica
`site/`, que contiene solamente `index.html`. El módulo de prueba, el manual y
los archivos fuente no se incluyen en el deploy.

La recuperación del navegador es una comodidad local, no una copia portátil
garantizada.

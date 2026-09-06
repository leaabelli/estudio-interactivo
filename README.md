# Estudio Interactivo

Aplicación de estudio offline y autocontenida. Importa módulos `*.study.json`,
crea exámenes modelo de 10 preguntas, evita repeticiones innecesarias y conserva
cobertura, precisión, dominio e historial entre sesiones.

## Distribución

El único archivo que se comparte o publica como aplicación es `index.html`.
Contiene toda la interfaz, los estilos y la lógica; no descarga código, fuentes,
módulos ni otros recursos durante el uso.

Los demás archivos pertenecen al proyecto de desarrollo o a su documentación:

- `modulo-prueba.study.json`: banco sintético de 48 preguntas para pruebas y
  demostraciones locales. Se carga desde la aplicación como cualquier otro
  módulo externo; no forma parte del HTML ni del deploy.
- `output/pdf/manual-usuario.pdf`: manual de uso en español para consulta local.
  Se genera y verifica como artefacto documental, pero no se publica en GitHub
  Pages.
- `src/`, `scripts/` y `tests/`: fuentes, compilación y controles de calidad que
  producen o verifican el HTML; no son dependencias de ejecución.

## Uso

Abrí `index.html`, elegí un módulo `*.study.json` desde tu dispositivo y prepará
un examen. Para probar el proyecto podés seleccionar
`modulo-prueba.study.json`. La aplicación no hace solicitudes de red y guarda
cada acción aceptada en una cola local. Para mover el avance, usá
**Módulo > Guardar archivo** y conservá el `.study.json` más reciente. Ese
archivo es dato portátil del usuario, no una dependencia ni una parte de la
aplicación distribuida.

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
y verifica el HTML sin red; valida el módulo inicial; genera y revisa el PDF
local; y crea `site/` con exactamente el único artefacto publicable:
`index.html`.

## Crear módulos

La skill [generador-modulos-preguntas](.agents/skills/generador-modulos-preguntas/SKILL.md)
documenta cantidades explícitas o distribución aleatoria balanceada, calibración
de dificultad, trazabilidad y progreso inicial. Todo módulo nuevo debe pasar:

```bash
bun run validate:module -- ruta/al/modulo.study.json
bun run validate:initial -- ruta/al/modulo.study.json
```

## GitHub Pages

El workflow `.github/workflows/pages.yml` prueba el proyecto completo y publica
`site/`, que contiene solamente `index.html`. El módulo de prueba, el manual y
los archivos fuente no se incluyen en el deploy.

La recuperación del navegador es una comodidad local, no una copia portátil
garantizada.

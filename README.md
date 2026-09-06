# Estudio Interactivo

Aplicación de estudio offline y autocontenida. Importa módulos `*.study.json`,
crea exámenes modelo de 10 preguntas, evita repeticiones innecesarias y conserva
cobertura, precisión, dominio e historial entre sesiones.

## Entregables

- `index.html`: aplicación completa, sin dependencias de internet.
- `modulo-prueba.study.json`: banco sintético inicial de 48 preguntas.
- `output/pdf/manual-usuario.pdf`: manual de uso en español. El build de Pages
  lo publica como `manual-usuario.pdf` junto a la aplicación.

## Uso

Abrí `index.html`, cargá `modulo-prueba.study.json` y prepará un examen. La
aplicación no hace solicitudes de red y guarda cada acción aceptada en una cola
local. Para mover el avance, usá **Módulo > Guardar archivo** y conservá el
`.study.json` más reciente.

## Desarrollo

Requiere Bun 1.3.14 y Python 3 con las dependencias del manual. El usuario final
no necesita ninguna de estas herramientas.

```bash
python3 -m pip install -r requirements-manual.txt
bun run test:all
```

`test:all` ejecuta tests unitarios, contractuales y de integración; reconstruye
y verifica el HTML sin red; valida el módulo inicial; genera y revisa el PDF; y
crea `site/` con los tres artefactos publicables.

## Crear módulos

La skill [generador-modulos-preguntas](.agents/skills/generador-modulos-preguntas/SKILL.md)
documenta cantidades explícitas o distribución aleatoria balanceada, calibración
de dificultad, trazabilidad y progreso inicial. Todo módulo nuevo debe pasar:

```bash
bun run validate:module -- ruta/al/modulo.study.json
bun run validate:initial -- ruta/al/modulo.study.json
```

## GitHub Pages

El workflow `.github/workflows/pages.yml` prueba el proyecto y publica solo
`site/`: `index.html`, `modulo-prueba.study.json` y `manual-usuario.pdf`.

La recuperación del navegador es una comodidad local, no una copia portátil
garantizada.

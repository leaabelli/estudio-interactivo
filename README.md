# Estudio Interactivo

Aplicación de estudio offline y autocontenida. Importa módulos `*.study.json`,
crea exámenes modelo de 10 preguntas, evita repeticiones innecesarias y conserva
cobertura, precisión, dominio e historial entre sesiones.

## Entregables

- `index.html`: aplicación completa, sin dependencias de internet.
- `modulo-prueba.study.json`: banco sintético inicial de 48 preguntas.
- `manual-usuario.pdf`: manual de uso en español.

## Desarrollo

Requiere Bun 1.3.14 solo para compilar y probar. El usuario final abre
`index.html` directamente o lo sirve desde GitHub Pages.

```bash
bun install
bun run test:all
```

El módulo portable contiene preguntas y progreso. Exportalo para mover el
avance entre navegadores o dispositivos; la recuperación del navegador es una
comodidad local, no una copia portátil garantizada.

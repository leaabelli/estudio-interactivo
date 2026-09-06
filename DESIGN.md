# Estudio Interactivo — Design System

The product is a calm editorial study workspace. It uses warm paper, navy ink,
and one burnt-orange action accent. Correctness uses green; errors use red.
Decoration never competes with the question or the next action.

## Principles

- Coverage is the primary progress signal; accuracy and mastery stay separate.
- One dominant action per state. An active exam always takes precedence.
- Body text is at least 16 px, generously spaced, and limited to 68 characters.
- Cards exist only when the contained object is itself interactive.
- Persistence language is literal: local recovery, confirmed file save, and
  attempted browser download are never described as the same thing.

## Tokens

```css
--canvas: #F5F1E8;
--surface: #FFFCF6;
--ink: #13243E;
--muted: #526170;
--line: #D7D0C4;
--accent: #A9520A;
--accent-hover: #8A3F08;
--accent-soft: #F3E1CF;
--success: #216A4A;
--danger: #9B3434;
--warning: #7A4800;
--focus: #005FCC;
```

Spacing is `4, 8, 12, 16, 24, 32, 48px`. Controls are at least 48 px high;
touch targets are at least 44 × 44 px. Controls use 6 px radii, interactive
panels 10 px, and shadows only for modal elevation.

## Type

- Headings: Source Serif 4, embedded WOFF2.
- Body and controls: Atkinson Hyperlegible 400/700, embedded WOFF2.
- Body: 17/27 px. Prompt: 22/32 px. Main title: 38/44 px desktop and
  30/36 px mobile.

## Responsive

- `<600px`: one column, bottom navigation, stacked filters, 5×2 question rail.
- `600–899px`: bottom navigation, two-column filters, 1×10 question rail.
- `900–1199px`: 208 px side navigation.
- `>=1200px`: 240 px side navigation, 1040 px maximum content shell.

At 400% zoom the page reflows to the narrow layout without horizontal page
scrolling. Only the mobile bottom navigation may remain sticky.

## Components

`ModuleMasthead`, `CoverageLedger`, `ExamSetup`, `QuestionStage`,
`QuestionRail`, `MetricLedger`, `RunHistory`, `StateNotice`, `SaveStatus`,
`ConfirmDialog`, and `DifficultyMark` form the complete vocabulary.


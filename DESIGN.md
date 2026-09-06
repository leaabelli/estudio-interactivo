# Estudio Interactivo — Design System

Estudio Interactivo is a light, calm study application inspired by the clarity
and motion discipline of modern Material interfaces. It does not imitate Google
branding. The stable application shell, restrained blue palette, tonal surfaces,
and direct feedback make it feel like one continuous app rather than a sequence
of reloaded pages.

## Principles

- The application shell stays mounted. Only the route outlet or question stage
  changes after an intentional navigation.
- Coverage is the primary progress signal. Accuracy and the latest-result metric
  remain separate and are never presented as the same concept.
- Transient success feedback uses a fixed snackbar, so ordinary actions never
  push the page down. Persistent warnings remain visible in a banner.
- Every chart has an equivalent textual value. Difficulty never relies on color
  alone: label and shape travel with the color.
- Body text is at least 16 px, controls are at least 44 px high, and content
  reflows without horizontal page scrolling at 400% zoom.
- The generated `index.html` contains all application code and styling and makes
  no network request.

## Tokens

```css
--canvas: #F7F9FC;
--surface: #FFFFFF;
--surface-soft: #EEF3F8;
--surface-strong: #E3EAF3;
--ink: #1F2937;
--muted: #5F6B7A;
--outline: #C7D0DB;
--primary: #2F5FA7;
--primary-hover: #244C88;
--primary-soft: #DCE8F8;
--success: #13715B;
--success-soft: #D8F3E7;
--warning: #8A5700;
--warning-soft: #FFF1CE;
--danger: #B3261E;
--danger-soft: #F9DEDC;
--focus: #0B57D0;
```

Spacing uses `4, 8, 12, 16, 20, 24, 32, 40px`. Controls use 10 px
radii, cards 16 px, and large tonal panels 24 px. Shadows are limited to
interactive surfaces, dialogs, and floating feedback.

## Type

The interface uses the local system sans-serif stack. This naturally maps to
San Francisco, Segoe UI, or Roboto depending on the device and keeps the shared
HTML small and offline. The scale is 12 px for labels, 14 px for supporting
copy, 16 px for body text, 20–26 px for section headings, and 32–44 px for page
headings.

## Shell and responsive behavior

- `>=900px`: 220 px light navigation rail, sticky 72 px app bar, and a 1120 px
  maximum route outlet.
- `<900px`: sticky app bar and 68 px bottom navigation.
- `<640px`: one-column metric cards, stacked setup controls, and a 5×2 question
  rail.
- Very short mobile viewports move the navigation into document flow.

The app bar owns module identity and save state. `Estudiar`, `Progreso`, and
`Módulo` are persistent navigation destinations. An exam stays inside the same
shell and only its question stage changes between questions.

## Progress vocabulary

- `CoverageRing`: evaluated questions divided by the full bank.
- `MetricCard`: precision, latest-result coverage, and run count.
- `DifficultyBars`: coverage and precision for each difficulty.
- `RunTrend`: precision bars plus cumulative coverage line for detailed runs.
- `ResultHero`: score ring, correct/incorrect counts, and coverage gain.

SVG charts are generated from local state without dependencies. Older summarized
runs are not interpolated into a false trend.

## Motion

Route content enters in 240 ms and question content in 230 ms using a standard
decelerating curve. Controls respond in 160 ms. Charts settle in 480–500 ms.
The shell never fades or remounts. `prefers-reduced-motion: reduce` removes every
nonessential animation and transition.

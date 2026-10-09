# Conventions

Every component in this registry is code that someone installs into their own project, reads and changes.
These conventions are the quality bar for both kinds of components. Read them before
[React components](react-components.md) or [Custom elements](custom-elements.md), and follow
[Writing](writing.md) for every piece of text.

## Two kinds of components

| Kind | Collections | Tag prefix | Files | Built on |
| --- | --- | --- | --- | --- |
| Native React | Interaction (11), Pixel UI (30), Location (30) | `ui-` (and `effort-slider`), `px-`, `geo-` | `{tag}.tsx`, a demo in `registry/examples/{tag}-demo.tsx` | React 19, Tailwind CSS v4, `cn()`, the shared modules in `registry/lib/lumesec/` |
| Custom element | Pixel Lab (50), Pixel HD (60) | `px-`, `hf-` | `{tag}.element.ts`, plus a React wrapper `{tag}.tsx` that `pnpm catalog` generates | The pixel engine `registry/lib/lumesec/pixel.ts` |

Pixel Lab and Pixel UI share the `px-` prefix, so a tag is unique across the registry, not per collection.
Custom elements are for canvas-heavy components that must also run without React. Everything else is a
native React component.

## Quality bar

1. **Strict TypeScript, no escape hatches.** The code compiles under `strict`. No `@ts-ignore`,
   `@ts-nocheck`, `@ts-expect-error`, `as any` or explicit `any`: use `unknown` and narrow it, or write the
   precise type. The one exception is the mixin constructor type in `pixel.ts`, which TypeScript requires
   (TS2545). Use a non-null assertion `!` only for a node the component rendered itself; in custom elements,
   prefer the engine's `$()`, which is typed non-null.
2. **Readable code.** Two-space indent, double quotes, semicolons, trailing commas, lines up to about 120
   columns (see `.editorconfig`). One statement per line. Descriptive names; short names are fine for maths
   (`x`, `y`, `t`, `dt`, `i`). Prefer a small named helper to a clever one-liner.
3. **Comments explain why.** A short JSDoc on every exported symbol and on every public prop, method,
   property and event. Comments state the intent or the constraint behind the code ("the thumb stretches to
   25px mid-travel, then snaps back"), not what the next line does. No banner or decorative comments.
4. **Lint-clean in a stock Next.js app.** Users install the files into projects with the default
   `create-next-app` ESLint config, and their CI lints them. `pnpm verify` runs that config over the registry
   (`scripts/lib/eslint.registry.mjs`) and fails on any warning.
5. **No new dependencies.** A component may import React, `cn` from `@/lib/utils` and the modules in
   `registry/lib/lumesec/`. No animation library, icon set or UI kit. A helper that only one component needs
   lives in that component's file. Add to a shared module only when several components need the helper, and
   keep the module's style, strict types and JSDoc.
6. **Safe on the server.** Importing a module on the server must not touch `window`, `document`,
   `matchMedia`, `customElements` or a canvas. Browser work happens in effects and event handlers (React), or
   in the constructor and lifecycle callbacks of an upgraded element (custom elements), or behind a
   `typeof window !== "undefined"` guard. `pnpm verify` imports every element module in Node and renders every
   React demo to a string.
7. **Accessible.** See the checklist below.
8. **Themed through tokens.** Colours and fonts come from the theme. Hex values appear only as fallbacks.
   See [Theming](#theming).

## Accessibility checklist

- **Keyboard.** Every interactive part is reachable and operable with the keyboard. Use native `<button>`
  and `<input>` elements where possible, and put `type="button"` on every button that does not submit.
  - Sliders, dials and knobs: arrow keys step, Home and End jump to the ends.
  - Lists, grids and segmented controls: a roving tab index, one Tab stop and arrow keys inside.
  - Buttons and toggles: Enter and Space.
  - Dialogs and popovers: Escape closes them and returns focus to where it was.
- **Roles and state.** Set the role that matches the behaviour (`slider`, `meter`, `switch`, `tablist`,
  `grid`, ...) and keep `aria-valuenow`, `aria-valuetext`, `aria-checked`, `aria-pressed` and `aria-selected`
  up to date.
- **Names.** Every control has an accessible name, usually from its visible label. In React, ids for
  `aria-labelledby` and `aria-describedby` come from `React.useId()`.
- **Live regions.** Status text that changes on its own sits in an `aria-live="polite"` region.
- **Canvases.** A decorative canvas is `aria-hidden`. A canvas that carries information gets a role
  (`img`, or `meter` when it shows a level) and a label with the value it shows, updated when the value
  changes.
- **Focus.** A visible ring on `:focus-visible` only: a 2px outline in the accent with a 2px offset.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, loops, shimmer and pulses stop, spark and
  traffic pixels are not drawn, and springs and rolls become immediate changes. Values, labels and states
  still update, so no information is lost.
- **Text is text.** Every word and number a person reads is real text in a regular font: labels, counters,
  display numerals, keys, status words. Use the inherited sans font for words, and the mono font with
  `font-variant-numeric: tabular-nums` for numbers, codes and times. Pixels are the effect layer around the
  text. Text may pass through pixels during a transition (materialising, dissolving), and a hidden secret may
  stay a scramble while it is hidden, but the resting state is real text. The pixel bitmaps in
  `pixel-font.ts` are for icons and marks.

## Theming

Components follow the user's shadcn theme, plus a small set of LumeSec accent tokens that the
`lumesec-theme` registry item installs:

| CSS variable | Tailwind colour | Meaning | Light | Dark |
| --- | --- | --- | --- | --- |
| `--lumesec` | `lumesec` | The one accent (Electric) | `#6219f3` | `#8654fb` |
| `--lumesec-foreground` | `lumesec-foreground` | Text on the accent | `#fafafa` | `#fafafa` |
| `--lumesec-soft` | `lumesec-soft` | Secondary accent shade, traffic | `#a685ff` | `#a685ff` |
| `--lumesec-shine` | `lumesec-shine` | Highlights on dot fields | `#3f12b0` | `#ffffff` |
| `--lumesec-glint` | `lumesec-glint` | Sparks on Interaction controls | `#c9bdff` | `#ffffff` |
| `--lumesec-success` | `lumesec-success` | Success | `#00a14b` | `#00c758` |
| `--lumesec-warning` | `lumesec-warning` | Warning | `#d97706` | `#eeb154` |
| `--lumesec-info` | `lumesec-info` | Information, upstream traffic | `#1e40af` | `#4ab8e8` |

Everything else uses the standard shadcn tokens: `background`, `foreground`, `card`, `card-foreground`,
`popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `muted`, `muted-foreground`,
`accent` (a subtle hover fill, not the brand accent), `accent-foreground`, `destructive`, `border`, `input`,
`ring`, and the fonts `font-sans` and `font-mono`.

- Dark mode comes from the tokens, whichever mechanism the theme uses (a `.dark` class, `data-theme` or
  `prefers-color-scheme`). Never from `dark:` variants or hard-coded colours.
- The accent marks one thing per component: the state that matters. Primary buttons use the foreground
  colour.
- Canvas code reads colours at runtime: `usePalette`, `readColor` and `resolveColor` from `color.ts` in React
  components, the palette `this.P` in custom elements. Both resolve any CSS colour (hex, `rgb()`, `oklch()`,
  `color-mix()`, `var()` chains) through a 1x1 canvas and re-read it when the theme changes.
- List every token a React component reads in its notes (`tokens`). For custom elements the docs page lists
  them from the source.

## Imports and paths

| Source | Import it as |
| --- | --- |
| `registry/components/lumesec/{tag}.tsx` | `@/components/lumesec/{tag}` |
| `registry/components/lumesec/{tag}.element.ts` | `@/components/lumesec/{tag}.element` |
| `registry/lib/lumesec/{module}.ts` or `.tsx` | `@/lib/lumesec/{module}` |
| `cn` in `src/lib/utils.ts` | `@/lib/utils` |
| `registry/examples/{tag}-demo.tsx` (site only) | `@/examples/{tag}-demo` |

Never import registry files through relative paths. The registry build reads these imports to work out each
item's dependencies, and the shadcn CLI rewrites the aliases to the ones in the user's `components.json`.
Order imports as the existing files do: `react` first, a blank line, then the registry modules, with
`@/lib/utils` last.

## Shared modules

| Module | Main exports | Used by |
| --- | --- | --- |
| `math` | `RGB`, `TAU`, `clamp`, `lerp`, `rand`, `smoothstep`, `easeOutCubic`, `hash`, `stringHash`, `mixRgb`, `rgba`, `hslToRgb`, `rgbToHex`, `luminance`, `percent` | React |
| `color` | `parseColor`, `readColor`, `resolveColor`, `readPalette`, `usePalette`, `onThemeChange`, `THEME_TOKENS`, `Palette` | React |
| `motion` | `prefersReducedMotion`, `useReducedMotion`, `useInView`, `useAnimationLoop`, `useInterval`, `useLazyRef`, `Spring`, `springStep`, `springEuler`, `settleSpring`, `shake` | React |
| `canvas` | `sizeCanvas`, `useCanvas`, `CanvasSurface`, `onPixelRatioChange`, `snap`, `snapSize`, `snapCenter`, `fillSquare`, `localPoint`, `roundRectPath` | React |
| `pixel-canvas` | `usePixelCanvas` (a sized canvas, palette and frame loop for dot drawing) | Pixel UI |
| `pixel-font` | `bitmap`, `SMALL_CHECK`, `SMALL_ALERT`, `STATUS_ICONS`, `STATUS_COLORS`, the 5x7 glyphs | Pixel UI |
| `sparks` | `Sparks`, `burst`, `BurstLayer`, `useBurst` | React |
| `roll-text` | `RollText`, `ROLL_TIMING` | React |
| `use-controllable-state` | `useControllableState`, `useFormReset` | React |
| `fuzzy` | `fuzzyMatch`, `FuzzyHighlight` | React |
| `geo`, `geo-data`, `geo-world`, `geo-countries` | Projections, globe motion, dot lattices, arcs; time zones, coordinate and IP formatting, demo places and regions; the embedded land, coastline and country data | Location |
| `pixel` | The engine: `Base`, `PxBase`, `HF`, `FormMixin`, `define`, `TOKENS`, `Field`, `rollText`, `pixelBurst`, `escapeHtml` and drawing helpers | Custom elements |
| `data` | `readJson`, `rows`, `isRecord`, `finite`, `text`, `toDate` | Custom elements that take records |
| `react` | `useLumesecElement`, `LumesecElementProps`, `useComposedRef` | Generated wrappers, components that merge a caller's ref |

Read a module before you use it; most exports carry a JSDoc with an example.

## Demo copy

Demos and demo data use invented names and values: no real people, customers or brands. Say in the notes
when a component ships with demo data (see the `data` field in the notes formats).

## Before you open a pull request

```bash
pnpm catalog         # registers the component, regenerates src/generated/* and the element wrappers
pnpm docs:generate   # writes the docs page of a new component (--force rewrites generated pages)
pnpm verify          # escape hatches, server import and render, strict type-check, usage snippets, lint
```

Then check the component in the browser as described in [Writing](writing.md#check-a-component), and commit
the generated files together with the change that produced them.

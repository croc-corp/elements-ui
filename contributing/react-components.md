# React components

Interaction, Pixel UI and Location are native React 19 function components, written in the style of
shadcn/ui: Tailwind classes on the theme tokens, `cn()` for `className`, the remaining props spread onto the
root element. Read [Conventions](conventions.md) first; it applies here in full.

## Files

| File | Contents |
| --- | --- |
| `registry/components/lumesec/{tag}.tsx` | The component |
| `registry/examples/{tag}-demo.tsx` | The live demo on the site |
| `content/meta/{tag}.json` | The notes the docs page is generated from, with `"kind": "react"` |
| `content/catalog.json` | The catalog entry: title, description, collection, group, layout |
| `content/components/{collection}/{slug}.mdx` | The docs page, written by `pnpm docs:generate` |

`pnpm catalog` treats a tag as a React component when `{tag}.tsx` and `{tag}-demo.tsx` both exist and the
`.tsx` is not a generated custom-element wrapper.

## File layout

`"use client";` comes first, then the imports, the exported types, the component (or components), and small
helpers and constants at the end. A minimal component:

```tsx
"use client";

import * as React from "react";

import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

export interface UiExampleProps extends Omit<React.ComponentProps<"button">, "onChange"> {
  /** Controlled state. Use with `onCheckedChange`. */
  checked?: boolean;
  /** Initial state when uncontrolled. */
  defaultChecked?: boolean;
  /** Called when the user toggles the switch. Changing `checked` from outside does not call it. */
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * One paragraph: what the component is and its one notable behaviour.
 *
 * @example
 * <UiExample defaultChecked aria-label="Extended thinking" />
 */
export function UiExample({ checked: checkedProp, defaultChecked = false, onCheckedChange, className, onClick, ...props }: UiExampleProps) {
  const [checked, setChecked] = useControllableState({
    value: checkedProp,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const state = checked ? "checked" : "unchecked";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="ui-example"
      data-state={state}
      className={cn(
        "h-6 w-[42px] rounded-xl bg-muted outline-none data-[state=checked]:bg-lumesec focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setChecked(!checked);
      }}
      {...props}
    />
  );
}
```

## API

### Exports and the root element

- Named exports only: the component, its props interface `{Name}Props`, and every public type (option
  shapes, string unions, handle types). The component name is the PascalCase tag (`ui-dial` is `UiDial`) and
  matches `component` in the catalog entry.
- The props interface extends the root element's props, minus the ones it redefines:
  `interface Props extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue">`.
- The root element gets `data-slot="{tag}"`, merges `className` with `cn()` and receives the remaining props.

### State

Stateful components can be controlled or uncontrolled, with the Radix names, through `useControllableState`:

| State | Controlled | Uncontrolled | Callback |
| --- | --- | --- | --- |
| Value | `value` | `defaultValue` | `onValueChange(value)` |
| On or off | `checked` | `defaultChecked` | `onCheckedChange(checked)` |
| Open or closed | `open` | `defaultOpen` | `onOpenChange(open)` |
| Page | `page` | `defaultPage` | `onPageChange(page)` |

- Callbacks fire for user actions. When the parent changes a controlled prop, the component animates to the
  new value and does not call the callback back.
- A second moment gets its own callback, such as `onValueCommit` when a drag ends.
- Other events are typed callbacks with plain arguments (`onCopy(text)`, `onComplete(code)`,
  `onCompact(from, to)`), never `CustomEvent` objects.

### Props

- Numbers are `number`, closed sets are string-literal unions (`"sm" | "md"`), flags are `boolean`.
- `children` is the main content. Secondary content is a `React.ReactNode` prop (`hint`, `icon`,
  `description`). Structured content is a typed array prop (`options`, `items`, `steps`), with the element
  type exported.
- A component that displays records takes them through props. Without them it may show demo data; with them,
  nothing invented is mixed in. Say which in the notes (`data`).

### Ref

React 19 passes `ref` as a regular prop: do not use `forwardRef`. By default `ref` is the root DOM element.
Where an action is naturally a command (show a toast, compact, finish, focus), `ref` is a typed handle
instead, exposed with `useImperativeHandle`:

```tsx
/** Imperative actions on the meter, exposed through `ref`. */
export interface UiContextMeterHandle {
  /** Add `percent` percentage points (negative to subtract), clamped to 0–100. Calls `onValueChange`. */
  add(percent: number): void;
  /** Drop usage to 28% of its current value and animate the compaction. Calls `onCompact`. */
  compact(): void;
}

export interface UiContextMeterProps extends Omit<React.ComponentProps<"div">, "ref" | "onChange"> {
  /** Exposes `add()` and `compact()`. */
  ref?: React.Ref<UiContextMeterHandle>;
}
```

Prefer declarative props. Add a handle only for actions that have no natural prop.

### Forms

- A control that is an input renders a native `<input>` (with `name`, `required`, `disabled`, `minLength` and
  so on), so it takes part in native validation.
- A custom control renders `<input type="hidden" name={name} value={...} />` when `name` is set.
- `useFormReset(ref, () => setValue(initial))` from `use-controllable-state` restores the initial value when
  the form resets.
- Support `disabled` wherever it makes sense, and wire labels and descriptions with ids from `React.useId()`.

## Styling

- Tailwind utility classes only: no CSS files, no `<style>` elements, no CSS modules. Arbitrary values are
  fine: `h-[42px]`, `rounded-[10px]`, `shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]`.
- Colours come from the tokens in [Conventions](conventions.md#theming): `bg-card`, `bg-muted`,
  `border-border`, `text-foreground`, `text-muted-foreground`, `bg-lumesec`, `text-lumesec-foreground`,
  `bg-destructive`, `text-lumesec-success`, `font-mono`. Opacity uses the slash syntax (`bg-lumesec/14`); a mix
  of two tokens stays an arbitrary value: `border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))]`.
- No `dark:` variants. The tokens change with the theme.
- Focus ring: `outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec`.
  In Tailwind v4, `outline-none` sets the outline style to none, so `outline-solid` is required.
- State styling uses `data-state="open|closed|checked|unchecked|..."` with `data-[state=...]:` variants, and
  `disabled:` or `aria-disabled:` variants, as shadcn does.
- The markup is in the light DOM, so page CSS reaches it. Set font sizes and line heights explicitly, and
  `font-[inherit]` on buttons and inputs.
- Motion: CSS transitions through classes; `element.animate()` (Web Animations) in handlers and effects for
  one-shot keyframes, or with `iterations: Infinity` for loops. Respect reduced motion with
  `prefersReducedMotion()` in handlers, `useReducedMotion()` in render and `motion-reduce:` variants in classes.

## Canvas, sparks and labels

| Need | Use |
| --- | --- |
| A canvas sized to its box at the device pixel ratio | `useCanvas(ref, onResize?, { maxDpr })` from `canvas` |
| Theme colours for drawing | `usePalette(ref)` from `color`: a ref to a `Palette` (`foreground`, `muted`, `background`, `card`, `track`, `border`, `destructive`, `accent`, `accentSoft`, `accentForeground`, `glint`, `shine`, `success`, `warning`, `info`, `dark`) |
| A frame loop that pauses off screen and stops when settled | `useAnimationLoop(ref, step)` from `motion`: `step(time, delta)` returns `true` to continue; `kick()` restarts it |
| Square dots on a canvas (Pixel UI) | `usePixelCanvas(draw)` from `pixel-canvas`: returns `{ ref, redraw }`; `draw` gets `clear()`, `dot()` and the palette |
| Sparks that fly past the component's edge | `useBurst()` and `<BurstLayer ref={...} />` inside a `relative` parent, from `sparks` |
| Sparks inside your own canvas | `Sparks` from `sparks` |
| A label that rolls when it changes | `<RollText text={...} direction={...} reserve={[...]} />` from `roll-text` |
| An engine or other mutable object created once, never during render | `useLazyRef(() => createEngine())` from `motion` |
| Springs, shake, timers for drifting demo data | `springStep`, `springEuler`, `settleSpring`, `shake`, `useInterval` with `useInView` from `motion` |
| Crisp dots and pointer positions | `snapSize`, `snapCenter`, `fillSquare` and `localPoint` (client to CSS pixels, correct under CSS zoom) from `canvas` |
| Merging a caller's `ref` with your own | `useComposedRef(localRef, ref)` from `react` |
| Globes, maps and places (Location) | `geo`, `geo-data`, `geo-world`, `geo-countries` |

A typical canvas component wires the hooks like this:

```tsx
const canvasRef = React.useRef<HTMLCanvasElement>(null);
const loop = useAnimationLoop(canvasRef, step);
const surfaceRef = useCanvas(canvasRef, () => loop.kick());
const palette = usePalette(canvasRef, undefined, () => loop.kick());
```

- Mutable animation state (springs, particles, progress) lives in refs, not in React state, so a frame never
  re-renders the component.
- Call `loop.kick()` or `redraw()` from an effect when an input of the drawing changes.
- Give every canvas explicit size classes. A decorative canvas is `aria-hidden`.
- Large maps and globes pass `{ maxDpr: 2 }` to keep the pixel count down on 3x screens.
- `Sparks`, `burst` and `shake` already do nothing under reduced motion.

## Server rendering and hydration

The components render their full markup on the server, so text, labels and layout are there on first paint.
Canvas layers draw after hydration.

- Never read `window`, `document` or `matchMedia` during render; only in effects and handlers.
- No `Math.random()`, `Date.now()` or `new Date()` in render. Derive random demo data in an effect, or seed it
  with `hash()` or `stringHash()` so server and browser agree.
- Round computed coordinates that end up in markup, so the server and the browser print the same numbers.
- No state updates during render, except the derived-state pattern
  (`if (shown.value !== value) setShown({ value, direction })`).
- Every effect cleans up its observers, timers, animation frames and listeners. Effects run twice in
  development under strict mode.
- Callbacks that an effect must not re-subscribe to are read through a ref updated in an effect.
- Keys on every list, and no index keys for lists that reorder.

## The demo

`registry/examples/{tag}-demo.tsx` exports `default function {Name}Demo()`. It shows the component the way it
is most often used, plus whatever makes its behaviour visible: a second instance, a button that adds a value,
a short scripted sequence.

- It imports only from `react`, `@/components/lumesec/...`, `@/lib/lumesec/...` and `@/lib/utils`.
- Its root sizes itself: `w-full max-w-[380px]` for a bare control, `w-full max-w-[400px]` for a panel,
  `max-w-[660px]` for a wide component. A panel is
  `rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]`.
- Buttons that drive the demo sit inside it:
  `h-[30px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]`.
- The catalog entry's `layout` places it in the preview: `center`, `fill` or `wide`.
- It renders on the server (`pnpm verify` checks this) and fits its gallery card at 375 px without
  horizontal overflow.

## The notes

`content/meta/{tag}.json` holds everything the docs page says about the API. Every statement must match the
source; [Writing](writing.md) has the rules for the text.

```json
{
  "kind": "react",
  "summary": "Switch with a label and hint whose thumb stretches as it travels and pops a few pixel sparks when it turns on.",
  "props": [
    { "name": "checked", "type": "boolean", "default": "-", "description": "Controlled state. Use with `onCheckedChange`." },
    { "name": "defaultChecked", "type": "boolean", "default": "false", "description": "Initial state when uncontrolled." },
    { "name": "onCheckedChange", "type": "(checked: boolean) => void", "default": "-", "description": "Called when the user toggles the switch." }
  ],
  "extends": "div",
  "ref": { "type": "HTMLDivElement", "methods": [] },
  "subcomponents": [],
  "keyboard": [{ "keys": "Space / Enter", "action": "Toggle the focused switch." }],
  "accessibility": ["The switch is a native `<button>` with `role=\"switch\"` and `aria-checked`."],
  "motion": "With reduced motion the thumb moves without the stretch animation and no sparks fire.",
  "notes": ["Not a form control: it has no `name` and is not submitted with a form."],
  "tokens": ["--lumesec", "--lumesec-glint", "--muted", "--foreground", "--muted-foreground"],
  "usage": "import { UiToggle } from \"@/components/lumesec/ui-toggle\";\n\nexport function Example() {\n  return <UiToggle defaultChecked>Extended thinking</UiToggle>;\n}\n",
  "playground": {
    "props": { "children": "Extended thinking" },
    "controls": [{ "name": "defaultChecked", "kind": "boolean", "options": null, "default": "false" }]
  }
}
```

| Field | Contents |
| --- | --- |
| `kind` | Always `"react"`. Without it `pnpm catalog` warns. |
| `summary` | One sentence of at most about 150 characters: what the component is and its one notable behaviour. It becomes the page's meta description and the registry item's description. |
| `props` | Every prop the component declares (not the inherited native ones), ordered state, content, appearance, callbacks. `type` is the TypeScript type as written; `default` is the default or `-`. |
| `extends` | The native element whose props are also accepted (`"div"`, `"button"`), or `null`. |
| `ref` | `type` is the DOM element type or the handle type. `methods` lists handle methods as `{ "signature": "compact(): void", "description": "..." }`. |
| `subcomponents` | Only when the file exports more than one component: `{ "name", "description" }`. |
| `keyboard` | What the code handles: `{ "keys": "ArrowLeft / ArrowRight", "action": "..." }`. Empty when there is nothing beyond native behaviour. |
| `accessibility` | Short factual statements: roles, `aria-*`, live regions, labels, focus handling. |
| `motion` | What changes with reduced motion. |
| `form` | How the component takes part in forms. Omit when it does not. |
| `notes` | Anything else a developer must know. Omit when there is nothing. |
| `data` | Only for components that display records: `{ "kind": "input", "note": "..." }` when it takes your data, `{ "kind": "demo", "note": "..." }` when it can only show invented data. |
| `tokens` | Every theme variable the component reads, in classes and in canvas code. |
| `usage` | A complete module that type-checks under `strict`: the imports, then an exported function component using the component in its most common way. `pnpm verify` type-checks it. |
| `playground` | `props`: JSON values that make the component render sensibly. `controls`: the props a reader wants to change live, with `kind` `boolean`, `enum` (with `options`), `number` or `string`. Prefer the uncontrolled `default*` props for state; the playground remounts the component when one of them changes. |

## Run and check

```bash
pnpm catalog
pnpm docs:generate
pnpm verify
```

Then open `/components/{collection}/{slug}` and `/view/{tag}` on the dev server and go through
[Check a component](writing.md#check-a-component).

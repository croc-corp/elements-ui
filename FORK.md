# Fork notes

This is the croc-corp fork of [lumesec/elements-ui](https://github.com/lumesec/elements-ui). It keeps the upstream
structure, license and public API. Each change below is general: it carries no product strings or product tokens.

## Registry address

The Registry on GitHub Pages workflow (`.github/workflows/pages.yml`) builds the registry on each push to `main`
and publishes it. Items resolve at:

```
https://croc-corp.github.io/elements-ui/r/{name}.json
```

Every `registryDependencies` URL in the published items, including `lumesec-theme`, points at the same address. The
committed `registry.json` keeps the upstream address, so the upstream CI check of generated files still passes.

To install from the fork, add the namespace to `components.json`:

```json
{
  "registries": {
    "@croc": "https://croc-corp.github.io/elements-ui/r/{name}.json"
  }
}
```

GitHub Actions runs on the fork, and Settings → Pages uses "GitHub Actions" as its source. The first deployment runs when this branch merges into `main`.

The upstream Dependency review check needs the dependency graph. If it fails with "Dependency review is not supported on this repository", enable Settings → Code security → Dependency graph.

## Changes

### Shared engine and modules

- **`RollText` (`registry/lib/lumesec/roll-text.tsx`).** Each label keeps two spans and one long animation per
  span. The first 380ms of each animation is the roll, and the end pose holds for the rest. The next roll seeks the
  running animation back to its start. The keyframes split the easing curve, so the roll looks the same as before.
  Reason: Chrome runs about twenty main-thread frames for each new short animation, and a seek costs about six. A
  counter that rolls once a second cost about 1% of the main thread.
- **New `lumesec-ticker` module** (`registry/lib/lumesec/ticker.ts`). All animation loops share one
  `requestAnimationFrame` callback. A loop that waits for a later time sleeps on one shared timer. Reason: each
  instance had its own frame loop, and a page with many instances paid for many frame callbacks.
- **Frame-rate cap in the engine and in `useAnimationLoop`.** `PxBase` has a `frameRate` field, and
  `useAnimationLoop` takes `{ frameRate }`. A capped loop sleeps until its next frame is due. Reason: a loop that drew
  at 30 frames a second still woke on every display frame.
- **Partial redraw in Pixel HD fields.** Each frame compares the cells with the last drawn cells and redraws only the
  changed region. The bloom is blurred at cell resolution. `HF.partialFlush` turns this off. Reason: the whole canvas
  and its blur were drawn again on every frame, even when one row changed.
- **`partialFlush = false` in seven elements** (`hf-banner`, `hf-composer`, `hf-countdown`, `hf-kanban`, `hf-rings`,
  `hf-swipe`, `hf-terminal`). Reason: they draw outside the field grid, so a partial redraw would leave stale pixels.
- **`visibilityChanged` hook in `PxBase`.** It runs when an element enters or leaves the viewport. Reason: elements
  with CSS animations can pause them off screen.
- **`pixelBurst` and the `Sparks` burst use the shared ticker.** Reason: the same as the ticker module.
- **The cell centre is computed inline in `hf-diff` and `hf-tree`.** Reason: `F.xy()` allocated an array for each
  cell on each frame.

### Components

- **`ui-thinking`.** The wave is drawn once into a strip of frames. A stepped transform animation moves the strip, and
  the label shimmer is a masked copy of the label that moves with transforms. The compositor runs both. With reduced
  motion, the still frame and the plain label stay. Reason: the canvas redraw and the background-position shimmer cost
  about 4% of the main thread on their own, and about 14% in a long transcript. New optional `labels` prop, with the
  English text as the default.
- **`ui-send-button`.** The running ring turns its whole `svg`, not the circle inside it. Reason: turning a child of an
  `svg` repaints on every frame. New optional `sendLabel` and `stopLabel` props.
- **`ui-context-meter`.** The loop stops when the fill settles, and it draws at 30 frames a second. Reason: the
  dithered front kept the loop at about 25 frames a second for as long as the meter was on screen. New optional
  `compactingLabel`, `formatReadout` and `formatValueText` props.
- **`hf-diff`.** It draws at 30 frames a second. The canvas keeps its height while the dropped lines collapse.
  Reason: the collapse resized and cleared the canvas on every frame, which cost about 40% of the main thread. New
  `labels` attribute (JSON) and `readonly` attribute.
- **`hf-tree`.** It draws at 30 frames a second. Reason: the selection spring looks the same at half the draws. New
  `labels` attribute (JSON).

### Not ported

- The `px-tasks` panel that follows live task status (read-only rows, pending, in progress and completed) stays
  outside this fork. It replaces the checkbox API of `px-tasks`, so it belongs in a separate component. The upstream
  `px-tasks` gets the shared ticker and the off-screen pause through the engine.

### Tests, docs and tooling

- `tests/lib/ticker.test.ts` covers the shared ticker.
- `content/meta/*.json` documents the new props and attributes. `pnpm catalog` regenerated the wrappers.
- `content/docs/changelog.mdx` has the changes under `## Unreleased`.
- `.github/workflows/pages.yml` publishes the registry. It runs on `ubuntu-latest`, pins each action to a commit,
  and grants `pages: write` and `id-token: write` to the deploy job only.

## Measurements

Main-thread time from Chrome DevTools (`Performance.getMetrics`, task duration over 5 s), median of rounds, before and
after, on one machine under the same load:

| Component and state | Before | After |
| --- | --- | --- |
| Every component, idle | 0.01% | 0.01%, no frames |
| `ui-thinking`, thinking | 4.4% | 1.0–2.2% |
| `ui-thinking`, many instances in a transcript | 14.4% | 2.5–4.7% |
| `ui-context-meter`, after a change | 5.9% | 3.8–3.9% |
| `hf-diff`, resolving a hunk | 42.9% | 9.8–10% |
| `hf-tree`, changing the selection | 43.4% | 5.2–5.5% |

The machine was under heavy load during these runs, so treat the numbers as ratios rather than absolute costs.

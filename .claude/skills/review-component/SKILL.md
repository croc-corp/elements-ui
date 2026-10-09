---
name: review-component
description: Review one LumeSec Elements component (or a few) for correctness, security, accessibility, lifecycle, server safety and docs accuracy, and fix what you find. Use when asked to review, audit, harden or fix a component in this repository, or before finishing a new component.
---

# Review a component

Read the whole source of the component, its demo or catalog `stage`, `content/meta/{tag}.json` and its docs page
before judging anything. Fix what you find in the source; keep the visual design, timings and public API unless
something is a bug. Report what you changed and what you deliberately left.

## Checklist

Security

- Every value that reaches HTML (attributes, slot text, JSON `data`, properties) goes through `escapeHtml()` or
  `textContent`. URLs placed in `href` cannot be `javascript:`.
- React components never pass input to `dangerouslySetInnerHTML`.

Lifecycle and performance

- Every listener, timer, observer and animation frame is removed on unmount or `disconnectedCallback`, and what
  `disconnectedCallback` stopped restarts in `connectedCallback`.
- Engines and other mutable objects are created once (`useLazyRef`), not on every render.
- Animation loops stop when nothing changes, off screen and in hidden tabs. No allocations per frame in hot
  paths when a reused buffer works.

Server and hydration

- Importing the module on the server touches no DOM API. Render output does not depend on `Math.random()`,
  `Date.now()`, the time zone or locale; numbers in inline styles are rounded.

API and state

- Custom elements: attributes that should update a connected element are in `observedAttributes` and guarded
  with `this.initialized`; the rest are documented as read once. Properties set before the tag is defined are
  honoured. Form controls restore their value on reset and follow a disabled fieldset (`FormMixin`).
- React: controlled and uncontrolled state behave like a native input; callbacks fire only for user changes;
  effects have complete dependencies.
- Edge cases: empty data, invalid attributes, `NaN`, `min == max`, a step of 0, coordinates outside their range.

Accessibility

- Roles, names and states are correct and complete for the pattern (WAI-ARIA Authoring Practices).
- Full keyboard support, including Home/End where the pattern has them; focus stays on the control when a button
  disables itself; focus moves sensibly when content is removed.
- Canvases are `aria-hidden` and their information is available as text.
- Live regions announce results, not every intermediate value.
- `prefers-reduced-motion` keeps every number and state, without the motion.
- Pointer positions are correct inside CSS-zoomed containers (`localPoint`).

Docs

- `content/meta/{tag}.json` matches the code: props or attributes, defaults, events, keyboard, accessibility,
  motion, tokens, data. The `usage` snippet type-checks.
- Demo data follows the hard rules in `AGENTS.md`: invented names, `example.com`, documentation IP ranges, no
  AI product names.

## Finish

```bash
pnpm catalog
pnpm docs:generate --force
pnpm format
pnpm lint
pnpm test
pnpm verify
```

Commit the regenerated files. Check the component in the browser (`/view/{tag}`) in light and dark theme, at 375
px, with the keyboard and with reduced motion. If you fixed an entry in `KNOWN_ISSUES.md`, remove it; if you found
a problem you could not fix, add it there.

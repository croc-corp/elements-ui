---
name: add-component
description: Add a new component to the LumeSec Elements registry end to end - catalog entry, source, demo, API notes, generated docs page, gates and browser check. Use when asked to create, add or port a component (React or custom element) in this repository.
---

# Add a component

Work through the steps in order. Do not skip the generators: the docs page, the React wrapper of a custom
element and the registry item are all built from the files you write.

## 1. Decide what you are building

- Pick the collection and the tag prefix: Interaction `ui-` and Pixel UI `px-` (React), Location `geo-` (React),
  Pixel Lab `px-` and Pixel HD `hf-` (custom elements). Check `content/catalog.json` that the tag, the component
  name (PascalCase, for example `PxRating`) and the slug are not taken.
- Read `contributing/conventions.md` and the guide for the kind: `contributing/react-components.md` or
  `contributing/custom-elements.md`. Open two existing components of the same collection and follow their
  structure.

## 2. Catalog entry

Add an entry to `content/catalog.json` next to the other entries of the collection. Copy one and change every
field: `tag`, `component`, `collection`, `slug`, `title`, `description` (array of paragraphs), `tryText`
(starts with `**Try:**`), `group` (an existing group of the collection), `stage` (demo markup; for React
components the demo file renders instead), `stageClass`, `layout` (`center`, `fill` or `wide`), `markup`
(optional usage markup) and `added` (today, `YYYY-MM-DD`).

## 3. Source

React component:

- `registry/components/lumesec/{tag}.tsx`: `"use client"`, named exports, props interface with JSDoc on every
  prop, `data-slot`, `cn()` for `className`, tokens only, controlled and uncontrolled state with
  `useControllableState`, React 19 `ref` as a prop.
- `registry/examples/{tag}-demo.tsx`: `export default function {Component}Demo()`, imports only from
  `@/components/lumesec`, `@/lib/lumesec` and `@/lib/utils`.

Custom element:

- `registry/components/lumesec/{tag}.element.ts` on `PxBase`, `HF` or `FormMixin(...)` from the engine, with the
  header comment, `define("{tag}", Class)`, `export { Class }`, an exported `{Class}EventMap` when it fires
  events, and the `HTMLElementTagNameMap` declaration. Escape every interpolated value with `escapeHtml()`.
- Do not write `{tag}.tsx`; `pnpm catalog` generates the wrapper.

Reuse the shared modules (see the table in `contributing/conventions.md`) instead of copying helpers. No new
runtime dependencies.

## 4. Notes

Write `content/meta/{tag}.json` in the format of the guide (`"kind": "react"` with `props`, `ref`, `usage`,
`playground` for React; `attributes`, `events`, `methods` for elements; plus `summary`, `keyboard`,
`accessibility`, `motion`, `tokens`, `data`). Every statement must match the source. The `usage` snippet must
type-check: `pnpm verify` compiles it.

## 5. Generate

```bash
pnpm catalog
pnpm docs:generate
```

Commit the generated files: `src/generated/*`, the wrapper of a custom element, the new
`content/components/{collection}/{slug}.mdx`. Run `pnpm registry:build` when the component imports a shared
module no other component used before, and commit `registry.json`.

## 6. Counts

The collection counts appear in `tests/catalog.test.ts`, `README.md`, `content/docs/index.mdx` and
`content/docs/changelog.mdx`. Update them, and add a line under `## Unreleased` in the changelog.

## 7. Check

```bash
pnpm format
pnpm lint
pnpm test
pnpm verify
```

Then `pnpm dev` and open `/view/{tag}` and `/components/{collection}/{slug}`: light and dark theme, 375 px width,
pointer and keyboard (Tab, arrows, Home/End, Enter, Space, Escape), reduced motion, and the console (no errors,
no React warnings).

Finish with the `review-component` skill on the new tag.

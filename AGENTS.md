# AGENTS.md

Instructions for AI coding agents working in this repository. People should start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this file is the short version of the same rules.

LumeSec Elements is a shadcn registry of 181 components in five collections, plus the Next.js 16 site that
documents them. Users install components with the shadcn CLI and own the copied source, so registry code must be
exemplary: strict TypeScript, readable, accessible, safe on the server.

| Kind | Collections | Source |
| --- | --- | --- |
| Native React 19 + Tailwind CSS v4 | Interaction (`ui-*`, `effort-slider`), Pixel UI (`px-*`), Location (`geo-*`) | `registry/components/lumesec/{tag}.tsx` |
| Typed custom elements | Pixel Lab (`px-*`), Pixel HD (`hf-*`) | `registry/components/lumesec/{tag}.element.ts` on the engine `registry/lib/lumesec/pixel.ts` |

## Commands

Node 22+, pnpm 10 (`corepack enable`). No database or other service is needed.

| Command | Use |
| --- | --- |
| `pnpm install` | Install; also generates `.source/` for the MDX collections |
| `pnpm dev` | Site at http://localhost:3000; `/view/{tag}` shows one component on its own |
| `pnpm catalog` | Regenerate `src/generated/*` and the custom-element React wrappers after any component, demo or notes change |
| `pnpm docs:generate` | Write missing component pages; `--force` rewrites generated pages |
| `pnpm lint` | ESLint over the site and scripts |
| `pnpm format` | Prettier, with Tailwind classes sorted; run it before you finish |
| `pnpm test` | Vitest unit tests in `tests/` (about one second) |
| `pnpm check-types` | Strict type-check of everything |
| `pnpm verify` | The registry quality gates (escape hatches, server import, server render, usage snippets, registry lint) |
| `pnpm build` | Catalog, registry, CDN modules and `next build` |

Before you say a change is done, run `pnpm catalog`, `pnpm format`, `pnpm lint`, `pnpm test` and `pnpm verify`,
and for visible changes look at the component in the browser in light and dark theme at 375 px width.

## Where things are

Edit these:

- `registry/components/lumesec/` and `registry/lib/lumesec/`: the components, shared modules and engine.
- `registry/examples/{tag}-demo.tsx`: the live demo of a React component.
- `content/catalog.json`: one entry per component (title, description, collection, group, layout, demo markup).
- `content/meta/{tag}.json`: the API notes that the docs page, the React wrapper and the playground are built from.
- `content/docs/*.mdx`: the guides; `content/docs/changelog.mdx` is the changelog.
- `src/`: the site. `scripts/`: the generators and gates. `tests/`: the unit tests.

Never edit these by hand; change the input and run the script:

- `src/generated/*` and the custom-element wrappers `registry/components/lumesec/{tag}.tsx` (they contain
  `useLumesecElement`): `pnpm catalog`.
- `content/components/**/*.mdx`, unless the page has `generated: false`: `pnpm docs:generate --force`.
- `registry.json`, `.registry/`, `public/cdn/`: `pnpm registry:build`.

CI fails when generated files differ from what the generators produce, so commit them with the change.

## Conventions

Read the guide for the kind of work before you write code:
[conventions](contributing/conventions.md), [React components](contributing/react-components.md),
[custom elements](contributing/custom-elements.md), [writing](contributing/writing.md). The rules that matter
most:

- Strict TypeScript: no `any`, no `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, casts only where a type guard
  cannot work. `pnpm verify` rejects escape hatches in `registry/`.
- Importing a registry module on the server must not touch `window`, `document`, `matchMedia`,
  `customElements` or canvas. No `Math.random()` or `Date.now()` during render.
- Reuse the shared modules instead of copying helpers: `useLazyRef`, `useAnimationLoop`, `settleSpring` (motion),
  `useCanvas`, `localPoint`, `snapCenter` (canvas), `usePalette` (color), `useControllableState`, `Sparks` and
  `BurstLayer` (sparks), `escapeHtml`, `localPoint`, `radioKeys` and `FormMixin` (pixel engine).
- Colours come from theme tokens (`bg-card`, `text-muted-foreground`, `lumesec`), never hard-coded, and no
  `dark:` variants.
- Every value written into element HTML goes through `escapeHtml()`; prefer `textContent`.
- Clean up every listener, timer, observer and animation frame on unmount or disconnect.
- Accessibility is part of done: keyboard support, roles, names, focus, reduced motion.
- No new runtime dependencies. Comments explain why, not what. Keep the visual design, timings and public API
  unless the task is to change them.
- Text in docs, notes and demos: plain and precise, no marketing words, no exclamation marks, no emoji.

## Hard rules

- Demo data is invented: no real people, no company addresses or locations, no internal hosts. Use
  `@example.com` addresses, documentation IP ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
  2001:db8::/32) and historical or placeholder names. Do not use AI product names in demo copy; the effort level
  "Ultracode" is part of the design and stays. `tests/catalog.test.ts` checks this.
- Never read, print or commit `.env.local`, `.env.production` or any secret. Never point the site or a script at
  a `DATABASE_URL` you were not explicitly given; the tests run with `DATABASE_URL=""`.
- Tests go in `tests/`, never in `registry/` (shipped to users) or `src/`.
- A change users can notice gets a line under `## Unreleased` in `content/docs/changelog.mdx`.
- Do not bump the version, create tags or touch the `production` branch: releases follow
  [RELEASING.md](RELEASING.md) and are made by maintainers.
- Do not weaken a gate or a test to make a change pass. Fix the cause, or explain why you could not.

## Workflows and tools

- `.claude/skills/` holds step-by-step workflows as plain Markdown: `add-component`, `review-component` and
  `release`. Agents that do not load skills can read and follow them directly.
- `.mcp.json` configures two MCP servers: `next-devtools` (build and runtime errors, routes and logs of a
  running `pnpm dev`) and `shadcn` (browse shadcn registries). Do not run `shadcn add` in this repository: it is
  the source of the `@lumesec` registry, not a consumer of it.

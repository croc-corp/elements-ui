# LumeSec Elements

[![CI](https://github.com/lumesec/elements-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/lumesec/elements-ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-6219f3)](LICENSE)
[![TypeScript: strict](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)
[![shadcn registry](https://img.shields.io/badge/shadcn-registry-18181b)](https://elements.lumesec.ai/docs/installation)

181 interactive components from the LumeSec design lab, published as a shadcn registry: controls, meters,
charts, maps and globes, and dot-matrix displays. Every component is strict TypeScript, and the shadcn CLI
copies its source into your project, so you can read and change every line.

This repository contains the components, the scripts that build the registry, and the documentation site at
[elements.lumesec.ai](https://elements.lumesec.ai), where every component has a live preview, a playground, an
API reference and accessibility notes.

[Documentation](https://elements.lumesec.ai/docs) · [Components](https://elements.lumesec.ai/components) ·
[Changelog](https://elements.lumesec.ai/docs/changelog) · [Contributing](CONTRIBUTING.md)

## Quick start

You need React 19 and TypeScript. The React components (Interaction, Pixel UI, Location) also need
Tailwind CSS v4, as set up by `shadcn init`. The custom elements (Pixel Lab, Pixel HD) style themselves inside
a shadow root and need no CSS framework.

```bash
# 1. Set up shadcn (skip this if the project already has a components.json)
npx shadcn@latest init

# 2. Register the @lumesec namespace
npx shadcn@latest registry add @lumesec=https://elements.lumesec.ai/r/{name}.json

# 3. Add a component
npx shadcn@latest add @lumesec/effort-slider
```

Step 2 adds the registry to `components.json`:

```json
{
  "registries": {
    "@lumesec": "https://elements.lumesec.ai/r/{name}.json"
  }
}
```

Install a whole collection by its name (`interaction`, `pixel-ui`, `pixel-lab`, `pixel-hd`, `location`):

```bash
npx shadcn@latest add @lumesec/pixel-ui
```

Without the registry setup, install by URL:
`npx shadcn@latest add https://elements.lumesec.ai/r/effort-slider.json`.

Every component depends on the `lumesec-theme` item, so the first install also adds the `--lumesec` accent
tokens to your global CSS. To update a component, run `add` again: the CLI asks before it overwrites a file
that differs from the registry version, and `--diff` shows the changes first without writing anything.

The custom elements also run without React. Load one module per component, or one per collection, from the
CDN:

```html
<script type="module" src="https://elements.lumesec.ai/cdn/hf-gauge.js"></script>

<hf-gauge value="72" label="Rate limit" zones="60,85"></hf-gauge>
```

More in the documentation: [Installation](https://elements.lumesec.ai/docs/installation),
[React](https://elements.lumesec.ai/docs/react), [Plain HTML](https://elements.lumesec.ai/docs/html),
[Theming](https://elements.lumesec.ai/docs/theming), [Registry and MCP](https://elements.lumesec.ai/docs/registry).

## Collections

| Collection | Components | Kind | What it covers |
| --- | --- | --- | --- |
| [Interaction](https://elements.lumesec.ai/components/interaction) | 11 | React | Micro-interactions on everyday controls: send buttons, toggles, dials, meters, the Ultracode slider |
| [Pixel UI](https://elements.lumesec.ai/components/pixel-ui) | 30 | React | Form controls, navigation and feedback, each with one pixel detail; inputs submit with native forms |
| [Location](https://elements.lumesec.ai/components/location) | 30 | React | Globes, maps and connection lines for visitors, sign-ins, latency and traffic between regions |
| [Pixel Lab](https://elements.lumesec.ai/components/pixel-lab) | 50 | Custom element | Components that live in a pixel lattice: meters, gauges, radars, model moments |
| [Pixel HD](https://elements.lumesec.ai/components/pixel-hd) | 60 | Custom element | Regular controls on a fine dot field with bloom and ordered dither |

## How it works

### Two kinds of components

| Kind | Collections | What ships |
| --- | --- | --- |
| Native React | Interaction, Pixel UI, Location | `{tag}.tsx`: a React 19 function component styled with Tailwind CSS v4 and `cn()`, plus the shared `lib/lumesec` modules it imports |
| Typed custom element | Pixel Lab, Pixel HD | `{tag}.element.ts`, a typed React wrapper `{tag}.tsx`, the pixel engine and the React bindings |

The React components are written like shadcn/ui: controlled and uncontrolled state (`value`, `defaultValue`,
`onValueChange`), typed callbacks, `ref` handles for imperative actions, `data-slot` and `data-state`
attributes, and full server rendering. The custom elements are canvas-heavy, framework-free classes that
register their tags in `HTMLElementTagNameMap` and type their events in an event map.

### What an install writes

Installing `@lumesec/ui-dial` (React) writes the component and the shared modules it imports:

```
lib/lumesec/color.ts, math.ts, motion.ts, roll-text.tsx, use-controllable-state.ts   installed once
components/lumesec/ui-dial.tsx
```

Installing `@lumesec/hf-gauge` (custom element) writes:

```
lib/lumesec/pixel.ts                    engine for Pixel Lab and Pixel HD
lib/lumesec/react.ts                    React 19 bindings for custom elements
components/lumesec/hf-gauge.element.ts  the element (registers <hf-gauge>, typed in HTMLElementTagNameMap)
components/lumesec/hf-gauge.tsx         typed React wrapper (props from the notes, ref typed as the class)
```

Every component also depends on `lumesec-theme`, and React components on shadcn's `utils` (`cn`). Files carry
alias-relative targets (`@lib/…`, `@components/…`), so the CLI keeps the `lumesec/` folders inside the
project's own alias roots on every operating system.

The React bindings pass attribute names upper-cased. React 19 assigns a prop to a same-named element property
when one exists, which throws on getter-only properties such as `name` on form-associated elements; HTML
lower-cases attribute names, so the DOM ends up with the expected attributes.

### Theming

Components read the shadcn theme tokens (`--background`, `--card`, `--foreground`, `--muted`,
`--muted-foreground`, `--border`, `--destructive`, the fonts and others) plus the `--lumesec*` accent tokens.
Custom elements read them through a chain, `var(--ui-x, var(<theme token>, <fallback>))`, so `--ui-*`
properties restyle them on their own. Canvas code resolves colours through a 1x1 canvas, so `oklch()` and
`color-mix()` work. See [Theming](https://elements.lumesec.ai/docs/theming).

## Develop locally

You need Node.js 22 or later (see `.nvmrc`) and pnpm 10. With Corepack, `corepack enable` selects the pnpm
version pinned in `package.json`.

```bash
git clone https://github.com/lumesec/elements-ui.git
cd elements-ui
pnpm install            # also generates the MDX collections in .source
cp .env.example .env.local
pnpm dev                # http://localhost:3000
```

No database or other service is needed. `.env.example` lists every variable:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, Open Graph images, the sitemap and the registry item URLs. `http://localhost:3000` locally. |
| `DATABASE_URL` | Optional. A Postgres connection string turns on the anonymous statistics. Empty: nothing is recorded. |
| `DATABASE_POOL_MAX` | Optional. Connections per server process, 5 by default. |
| `TRUSTED_PROXIES` | Optional. Proxies outside the private ranges in front of the app, for the rate limits. |

The registry route `/r/{name}.json` serves the output of `pnpm registry:build` from `.registry/r`, so run that
once before you try an install against the local site. The build scripts read `NEXT_PUBLIC_SITE_URL` from the
shell environment, not from `.env.local`.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server (Turbopack) at http://localhost:3000 |
| `pnpm catalog` | Registry sources and notes → `src/generated/*`; regenerates the custom-element React wrappers |
| `pnpm docs:generate` | Writes `content/components/**.mdx` for components without a page (`--force` rewrites generated pages) |
| `pnpm verify` | Quality gates (see below) |
| `pnpm registry:build` | `registry.json`, `shadcn build` into `.registry/r`, and the CDN modules in `public/cdn` |
| `pnpm build` | `catalog`, `registry:build`, then `next build` |
| `pnpm start` | Serves the production build |
| `pnpm check-types` | MDX collections, `next typegen`, then `tsc --noEmit` |
| `pnpm lint` | ESLint (`eslint-config-next`) over the site and the scripts |
| `pnpm stats [days]` | Prints the site statistics from `DATABASE_URL` (default: the last 30 days) |

### Repository layout

```
registry/components/lumesec/      the components: {tag}.tsx (React) or {tag}.element.ts + generated {tag}.tsx wrapper
registry/lib/lumesec/             shared modules (math, color, motion, canvas, pixel-canvas, pixel-font, sparks,
                                  roll-text, use-controllable-state, fuzzy, data), the Location modules (geo,
                                  geo-data, geo-world, geo-countries), the pixel engine (pixel.ts) and the React
                                  bindings for custom elements (react.ts)
registry/examples/{tag}-demo.tsx  the live demo of each React component
content/catalog.json              one entry per component: title, description, group, layout, demo markup
content/meta/{tag}.json           the notes: props or attributes, events, methods, slots, keyboard, accessibility
content/components/               generated component pages, one MDX file per component
content/docs/                     the guides (installation, React, HTML, theming, accessibility, motion, ...)
contributing/                     contributor guides: conventions, React components, custom elements, writing
scripts/catalog.mjs               sources + notes → src/generated/{elements,collections}.json, loaders.ts,
                                  demos.ts; generates the element wrappers
scripts/gen-docs.mjs              metadata + notes → content/components/{collection}/{slug}.mdx
scripts/build-registry.mjs        registry.json → `shadcn build` → .registry/r, plus public/cdn/*.js
scripts/verify.mjs                quality gates (see below)
scripts/stats.mjs                 prints the optional statistics
src/app/(site)/                   landing, gallery, collections, docs and component pages
src/app/r/[name]                  registry items, served with an ETag
src/app/og, md, llms*.txt         Open Graph images, Markdown twins, LLM indexes
src/app/api/                      anonymous statistics (track, feedback) and the healthcheck
src/lib/server/                   the optional statistics database, rate limits, client address
```

### Quality gates

`pnpm verify` runs after `pnpm catalog` and checks that:

1. the registry sources contain no type escape hatches (`any`, `as any`, `@ts-ignore`, `@ts-nocheck`,
   `@ts-expect-error`);
2. every custom element module imports on the server without touching the DOM;
3. every React demo renders on the server;
4. the site, registry included, type-checks under `strict`;
5. every usage snippet shown in the docs type-checks;
6. the registry passes the ESLint config of a stock `create-next-app` project with no warnings.

CI (`.github/workflows/ci.yml`) runs `pnpm catalog`, `pnpm lint`, `pnpm verify` and `pnpm build` on every push
and pull request to `main`, then fails if `registry.json`, `registry/` or `src/generated/` differ from the commit: the
generated files must be committed with the change that produced them. None of these steps needs a database
or network access beyond the package registry.

Component findings that are not fixed yet are listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

### Statistics

Statistics are optional and off by default. The site has no accounts and sets no cookies. With
`DATABASE_URL` set it records anonymous statistics:

- Events carry a type, the path, the referring host, the country from the edge and a device class. No IP
  address, user agent string or identifier is stored. Do Not Track and Global Privacy Control turn them off
  in the browser.
- Registry installs are counted in `src/app/r/[name]/route.ts`; the client (`shadcn`, `node`, browser) is
  derived from the user agent, which is not stored.
- "Was this page helpful?" answers are stored with their optional note. A vote returns a random token, and only
  that token can add the note to it.
- The tables are created on first use (`src/lib/server/db.ts`), so a new database needs no setup. Create it
  with UTF-8 encoding. `pnpm stats` prints the numbers.

Without `DATABASE_URL` the endpoints accept and discard everything.

### Self-hosting

The `Dockerfile` builds a Next.js standalone server that listens on port 3000:

```bash
docker build --build-arg NEXT_PUBLIC_SITE_URL=https://elements.example.com -t elements .
docker run -p 3000:3000 elements
```

- `NEXT_PUBLIC_SITE_URL` is compiled into the bundles and the registry, so it is a build argument as well as a
  runtime variable.
- `/api/health` answers the container healthcheck.
- The rate limits on the statistics endpoints use the client address from `X-Forwarded-For`, skipping proxies
  in private ranges. Every proxy in front of the app must pass the header on; list proxies outside the private
  ranges in `TRUSTED_PROXIES`, and do not expose the container port directly, or clients can forge the header.

## Contributing

Bug reports, accessibility fixes, documentation corrections and new components are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the setup and the pull request checklist, and the guides in
[`contributing/`](contributing) for the conventions every component follows. Open an issue before you start
on a new component. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not report vulnerabilities in public issues. Email security@lumesec.ai and see [SECURITY.md](SECURITY.md)
for what to include and what to expect.

## License

The components, the engine, the React bindings, the scripts and the site code are released under the
[MIT license](LICENSE), copyright 2026 LumeSec Technologies GmbH.

The LumeSec name and logo are not covered by the license. Do not use them in a way that suggests LumeSec
endorses your project or product. If you deploy your own copy of the site, replace the name, logo and company
details in `src/config/site.ts`, including the links to the imprint and privacy policy.

The Geist font files in `src/assets/fonts/`, used for the Open Graph images, are licensed under the SIL Open
Font License 1.1.

The land mask, coastlines and country outlines in `registry/lib/lumesec/geo-world.ts` and `geo-countries.ts` are
derived from [Natural Earth](https://www.naturalearthdata.com) (public domain) through world-atlas.

The country table in `registry/lib/lumesec/geo-countries.ts` (codes, common names, regions and subregions) contains
information from [world-countries](https://github.com/mledoze/countries), which is made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). That table is a derivative database and
is made available under the ODbL 1.0 as well; the rest of the file is under the MIT license.

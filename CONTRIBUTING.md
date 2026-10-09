# Contributing to LumeSec Elements

Thank you for taking the time to contribute. This guide covers the setup, where things live, how to add or
change a component, and what a pull request needs before it is merged. The detailed guides are in
[`contributing/`](contributing):

| Guide | Covers |
| --- | --- |
| [Conventions](contributing/conventions.md) | The quality bar for every component: strict TypeScript, readable code, server safety, accessibility, theme tokens, imports, no new dependencies |
| [React components](contributing/react-components.md) | Interaction, Pixel UI and Location: file layout, API naming, controlled state, ref handles, Tailwind on tokens, canvas helpers, the demo and the notes |
| [Custom elements](contributing/custom-elements.md) | Pixel Lab and Pixel HD: the pixel engine, attributes and properties, events, forms, cleanup, the generated React wrapper and the notes |
| [Writing](contributing/writing.md) | The voice for docs, notes and demo copy, and how to check a component in the browser |

## Before you start

- **Bugs.** Check [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and the open issues, then open a bug report. A fix for a
  listed known issue is welcome without further discussion.
- **New components and larger changes.** Open a feature request first, so we can agree on the scope and the
  collection before you write code.
- **Security issues.** Do not open an issue. Follow [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Node.js 22 or later (see `.nvmrc`) and pnpm 10. With Corepack, `corepack enable` selects the pnpm
version pinned in `package.json`.

```bash
git clone https://github.com/<your-account>/elements-ui.git
cd elements-ui
pnpm install            # also generates the MDX collections in .source
cp .env.example .env.local
pnpm dev                # http://localhost:3000
```

No database or other service is needed. `.env.example` already points `NEXT_PUBLIC_SITE_URL` at
`http://localhost:3000`; the [README](README.md#develop-locally) lists every variable.

Two pages are useful while you work on a component: `/components/{collection}/{slug}` (the docs page with the
preview and the playground) and `/view/{tag}` (the component on its own).

## Project structure

Files you edit:

| Path | Contents |
| --- | --- |
| `registry/components/lumesec/{tag}.tsx` | Native React component (Interaction, Pixel UI, Location) |
| `registry/components/lumesec/{tag}.element.ts` | Custom element (Pixel Lab, Pixel HD) |
| `registry/examples/{tag}-demo.tsx` | Live demo of a React component |
| `registry/lib/lumesec/` | Shared modules, the pixel engine (`pixel.ts`) and the React bindings (`react.ts`) |
| `content/catalog.json` | One entry per component: title, description, collection, group, layout, demo markup |
| `content/meta/{tag}.json` | The notes: props or attributes, events, keyboard, accessibility, motion, usage |
| `content/docs/*.mdx` | The guides on the site |
| `src/components/preview/demo-setups.ts` | Demo wiring for custom elements (buttons, timers) |
| `src/` | The site |

Files that scripts write. Do not edit them by hand; change the input and run the script:

| Path | Written by |
| --- | --- |
| `src/generated/*` | `pnpm catalog` |
| `registry/components/lumesec/{tag}.tsx` of a custom element (the typed React wrapper) | `pnpm catalog` |
| `content/components/{collection}/{slug}.mdx` | `pnpm docs:generate` |
| `registry.json`, `.registry/r/`, `public/cdn/` | `pnpm registry:build` (also part of `pnpm build`) |
| `.source/` | `pnpm install` (fumadocs-mdx) |

## Add or change a component

Read [Conventions](contributing/conventions.md) and the guide for the kind of component you are writing. To
add a component:

1. Add an entry to `content/catalog.json`. Copy an entry of the same collection and change every field.
   `tag`, `component`, `collection`, `slug`, `title`, `stage`, `layout` and `added` are required, and
   `pnpm catalog` stops with an error when one is missing or a tag, component name or page is already taken.
   `added` orders the "newest" sort.
2. Write the source:
   - React: `registry/components/lumesec/{tag}.tsx` and its demo `registry/examples/{tag}-demo.tsx`
     ([React components](contributing/react-components.md)).
   - Custom element: `registry/components/lumesec/{tag}.element.ts` on the pixel engine
     ([Custom elements](contributing/custom-elements.md)). `pnpm catalog` generates the React wrapper.
3. Write `content/meta/{tag}.json`. Every statement in it must match the source.
4. Run the scripts:

   ```bash
   pnpm catalog         # registers the component, regenerates src/generated/* and the element wrappers
   pnpm docs:generate   # writes the docs page for the new component
   pnpm verify          # quality gates
   ```

5. Check the component in the browser as described in [Check a component](contributing/writing.md#check-a-component):
   light and dark theme, a 375 px wide viewport, pointer and keyboard, reduced motion, and the console.

To change a component, edit its source, update `content/meta/{tag}.json` when the API or the behaviour
changes, then run `pnpm catalog`, `pnpm docs:generate --force` and `pnpm verify`. If the change fixes an entry
in `KNOWN_ISSUES.md`, remove the entry in the same pull request.

### How the notes and docs are generated

- `pnpm catalog` reads `content/catalog.json`, the notes in `content/meta/` and the sources. It analyses the
  custom element classes with the TypeScript compiler (observed attributes, the exported class, its event
  map), merges them with the notes, and writes `src/generated/elements.json`, `collections.json`, the preview
  loaders and demos, and the typed React wrapper of each custom element.
- `pnpm docs:generate` writes `content/components/{collection}/{slug}.mdx` from `src/generated/elements.json`
  and the notes. Without flags it only writes pages that do not exist yet; `--force` rewrites every generated
  page, and only pages whose inputs changed end up different. A page with `generated: false` in its
  frontmatter is never overwritten, so set that flag if you edit a page by hand.
- `pnpm registry:build` writes `registry.json` from the generated metadata and the imports of each file, runs
  `shadcn build`, and bundles the CDN modules. Run it when you add or remove a component or change what a file
  imports, and commit the updated `registry.json`.

## Quality gates

`pnpm verify` must pass before a pull request is merged. It checks that:

1. the registry sources contain no type escape hatches;
2. every custom element module imports on the server without touching the DOM;
3. every React demo renders on the server;
4. the site, registry included, type-checks under `strict`;
5. every usage snippet in the docs type-checks;
6. the registry passes the ESLint config of a stock `create-next-app` project with no warnings.

`pnpm lint` must pass as well: ESLint with `eslint-config-next` over the site and the scripts.

CI runs `pnpm catalog`, `pnpm lint`, `pnpm verify` and `pnpm build` on every pull request, then fails if
`registry.json`, `registry/` or `src/generated/` differ from what you committed. Run the same scripts before
you push and commit their output. The registry build writes the public site URL into `registry.json` unless
`NEXT_PUBLIC_SITE_URL` is set in your shell, so leave it unset when you build the files you commit.

## Commit messages

- Write the subject in the imperative mood, at most 72 characters, without a trailing period:
  `Fix focus loss in hf-tree after a row click`, not `Fixed focus bug.`
- Start with the tag when the change concerns one component: `px-tabs: Measure the underline against the
  tab list`.
- Use the body, wrapped at 72 characters, to explain why. Reference the issue: `Fixes #123`.
- Keep one logical change per commit, and commit generated files together with the change that produced them.

## Pull requests

Keep a pull request to one topic. The template asks for:

- a summary of what changes and why, with the issue it closes;
- screenshots or a short recording for visual changes, in light and dark theme;
- this checklist:
  - [ ] `pnpm lint` and `pnpm verify` pass.
  - [ ] `pnpm catalog` ran after changes to a component, a demo, `content/catalog.json` or `content/meta/`,
        and the generated files are committed.
  - [ ] A new component has its docs page (`pnpm docs:generate`).
  - [ ] The notes in `content/meta/{tag}.json` match the code.
  - [ ] Checked in light and dark theme, at 375 px width, with the keyboard and with reduced motion.
  - [ ] No new runtime dependencies.
  - [ ] Text follows [`contributing/writing.md`](contributing/writing.md): plain, precise, no marketing
        words, no exclamation marks, no emoji.

By contributing, you agree that your contribution is licensed under the [MIT license](LICENSE) of this
repository.

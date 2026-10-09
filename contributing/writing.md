# Writing

The same voice applies to every piece of text in this repository: the guides in `content/docs/`, the notes in
`content/meta/`, catalog descriptions and try texts in `content/catalog.json`, JSDoc comments, demo copy,
commit messages and pull request descriptions. This page also describes how to check a component before you
open a pull request.

## Voice

- Evidence over assertion, brevity over emphasis, quiet over loud.
- Plain, precise English in the present tense, with British spelling as in the existing pages (colour,
  behaviour).
- Say what a component does, not how it feels. "The thumb settles with a short overshoot" rather than "a
  delightful bounce".
- No marketing words. Do not use: magic, revolutionary, game-changer, next-gen, cutting-edge, seamless,
  robust, intuitive, powerful, stunning, beautiful, effortless, delightful, AI-powered, supercharge,
  transform, unlock.
- No exclamation marks. No emoji.
- Identifiers, attribute names, props and values in backticks: `value`, `aria-valuenow`, `"medium"`.
- Headings in sentence case.

## Notes

The notes in `content/meta/{tag}.json` become the API reference on the docs page, the React wrapper's JSDoc
for custom elements, the registry description and `llms.txt`. Accuracy matters more than volume.

- **Read the source for every statement.** Check how each prop or attribute is read, its default (the
  fallback in code), its range or allowed values, and whether a change takes effect on a connected element.
- **Booleans** are presence attributes on custom elements; say so where it matters.
- **Events** use the real `detail` shape from the `emit()` call, or the real callback arguments.
- **Methods and properties** cover only the public API a developer calls. Leave out lifecycle hooks,
  `render`, `layout` and private helpers.
- **Keyboard** lists what the key handlers actually do. An empty list is fine.
- **Accessibility** is short factual statements: roles, `aria-*`, live regions, labels, focus handling, form
  association.
- **Motion** says in one sentence what changes with reduced motion.
- **Data.** When a component ships with demo data, say so in `data` and name the prop or attribute that
  takes your own records. "Demo data" means the component cannot show your own data yet; "Your data" means
  it can.
- **Summary**: one sentence of at most about 150 characters that says what the component is and its one
  notable behaviour. It is also the page's meta description.

## Catalog text

Each entry in `content/catalog.json` has a `title`, a `description` (one or two paragraphs shown under the
preview) and an optional `tryText`, which tells the reader what to do with the preview:
`"**Try:** drag to Max, then to Ultracode. Use the arrow keys, Home and End."`. The site draws the "Try" label
itself and drops the prefix. Describe what the reader sees and can do, and keep the description true when the
behaviour changes.

## Demo copy

Demos use invented names, numbers and messages: no real people, customers or brands. Keep them neutral and
short, the way a real product would label things ("Rate limit", "Tokens per day", "Web search").

## Check a component

Run the dev server (`pnpm dev`) and open:

- `/components/{collection}/{slug}`: the docs page with the preview, the playground and the API reference;
- `/view/{tag}`: the component on its own;
- `/components/{collection}`: the gallery, where every card is live.

Then check:

| What | How |
| --- | --- |
| Light and dark theme | The theme toggle in the site header (in the menu on narrow screens). Look for colours that are wrong in one theme, low contrast, missing borders. |
| Narrow screens | A 375 px wide viewport in the browser's device mode. No horizontal overflow, no text cut off at the sides, no overlapping text. |
| Gallery card | The demo fits its card. Vertical cropping is acceptable only where the card's fade hides non-essential content. |
| Pointer | Hover, click and drag. State updates, nothing jumps or leaves its bounds, no stale state after an interaction. |
| Keyboard | Tab, Shift+Tab, arrow keys, Home, End, Enter, Space and Escape, as the notes describe. The focus ring is visible and in the right place. |
| Reduced motion | In Chrome DevTools: Rendering, Emulate CSS media feature `prefers-reduced-motion: reduce`. Loops stop, no sparks, values still update. |
| Console | No errors and no React warnings, including hydration warnings on a full page load. |

Finally run `pnpm verify`, and update the notes and the catalog entry if anything you changed is described
there.

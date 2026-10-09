#!/usr/bin/env node
// Writes content/components/{collection}/{slug}.mdx for every component, from
// src/generated/elements.json plus the hand-checked API notes in content/meta/{tag}.json.
//
//   node scripts/gen-docs.mjs            only writes pages that do not exist yet
//   node scripts/gen-docs.mjs --force    rewrites every generated page
//
// A page with `generated: false` in its frontmatter is never overwritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENGINES, readJson, ROOT } from "./lib/catalog.mjs";

const force = process.argv.includes("--force");
const elements = readJson(join(ROOT, "src/generated/elements.json"));
const collections = readJson(join(ROOT, "src/generated/collections.json"));

/* ---------------------------------------------------------------- text helpers */

/** Escape MDX-significant characters outside inline code. */
function mdx(text = "") {
  return String(text)
    .split(/(`[^`]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/([{}<>])/g, "\\$1")))
    .join("");
}
const cell = (text = "") => mdx(text).replace(/\|/g, "\\|").replace(/\n+/g, " ");
const code = (s) => "`" + String(s).replace(/`/g, "") + "`";
const codeCell = (s) => code(s).replace(/\|/g, "\\|");
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join(""));

function summaryOf(el, meta) {
  if (meta?.summary) return meta.summary.trim();
  const first = (el.description[0] ?? `${el.title} component.`).replace(/`/g, "");
  if (first.length <= 158) return first;
  const cut = first.slice(0, 155);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

/* ---------------------------------------------------------------- token usage (custom elements) */

/**
 * Each engine declares `--_x: var(--ui-y, <chain to the shadcn or LumeSec token>)`. Map every private
 * name to its override token and the theme tokens it falls back to.
 */
function tokenMap(engine) {
  const map = {};
  const source = readFileSync(join(ROOT, `registry/lib/lumesec/${engine}.ts`), "utf8");
  for (const m of source.matchAll(/(--_[a-z0-9-]+)\s*:\s*var\((--ui-[a-z0-9-]+),\s*([^;]+);/g)) {
    const theme = [...m[3].matchAll(/var\((--(?!ui-|_)[a-z0-9-]+)/g)]
      .map((x) => x[1])
      .filter((t) => !t.startsWith("--font"));
    map[m[1]] = { override: m[2], theme };
  }
  return map;
}

const tokenMaps = Object.fromEntries([...ENGINES].map((engine) => [engine, tokenMap(engine)]));

/** The engine a custom element runs on: the engine module among its install files. */
const engineOf = (el) =>
  [...ENGINES].find((engine) => el.files.some((f) => f.source === `registry/lib/lumesec/${engine}.ts`));

function elementTokens(el) {
  const map = tokenMaps[engineOf(el)];
  if (!map) return { theme: [], overrides: [] };
  const src = readFileSync(join(ROOT, `registry/components/lumesec/${el.tag}.element.ts`), "utf8");
  const used = new Set(src.match(/--_[a-z0-9-]+/g) ?? []);
  // canvas palettes read the accent and foreground through the engine's palette
  if (/this\.P\b|\bP\.(accent|ac|fg|muted)\b|\bpalette\b/.test(src))
    ["--_accent", "--_ac", "--_fg"].forEach((t) => used.add(t));
  const theme = new Set();
  const overrides = new Set();
  for (const name of used) {
    if (!map[name]) continue;
    overrides.add(map[name].override);
    map[name].theme.forEach((t) => theme.add(t));
  }
  return { theme: [...theme].sort(), overrides: [...overrides].sort() };
}

/* ---------------------------------------------------------------- shared sections */

function behaviour(el, push) {
  if (!el.description.length) return;
  push("## Behaviour", "");
  for (const p of el.description) push(mdx(p), "");
}

function keyboardSection(meta, push) {
  const keyboard = meta?.keyboard ?? [];
  if (!keyboard.length) return;
  push("## Keyboard", "", "| Keys | Action |", "| --- | --- |");
  for (const k of keyboard) push(`| ${cell(k.keys)} | ${cell(k.action)} |`);
  push("");
}

function accessibilitySection(meta, push) {
  const a11y = meta?.accessibility ?? [];
  if (!a11y.length && !meta?.motion && !meta?.form) return;
  push("## Accessibility", "");
  for (const s of a11y) push(`- ${mdx(s)}`);
  if (meta?.form) push(`- ${mdx(meta.form)}`);
  if (meta?.motion) {
    const m = meta.motion.replace(/^(reduced motion:\s*)?((with|under) (prefers-)?reduced[- ]motion( on)?,?\s*)?/i, "");
    push(`- Reduced motion: ${mdx(m.charAt(0).toLowerCase() + m.slice(1))}`);
  }
  push("");
}

function notesSection(meta, push) {
  if (!meta?.notes?.length) return;
  push("## Notes", "");
  for (const n of meta.notes) push(`- ${mdx(n)}`);
  push("");
}

/* ---------------------------------------------------------------- native React page */

function reactPage(el, meta, push) {
  if (meta?.playground?.controls?.length) {
    push(
      "## Playground",
      "",
      "Change a prop and the component re-renders. Props marked remounts set an initial value, so the component starts over.",
      "",
      `<Playground tag="${el.tag}" />`,
      "",
    );
  }
  push("## Installation", "", `<Install tag="${el.tag}" />`, "");
  push("## Usage", "", `<Usage tag="${el.tag}" />`, "");
  behaviour(el, push);

  const props = meta?.props ?? [];
  const methods = meta?.ref?.methods ?? [];
  const subs = meta?.subcomponents ?? [];
  if (props.length || meta?.ref || subs.length) push("## API reference", "");
  if (props.length) {
    push("### Props", "");
    if (meta?.extends)
      push(
        `Also accepts every prop of ${code(`<${meta.extends}>`)} (${code(`React.ComponentProps<"${meta.extends}">`)}), spread onto the root element.`,
        "",
      );
    push("| Prop | Type | Default | Description |", "| --- | --- | --- | --- |");
    for (const p of props)
      push(
        `| ${codeCell(p.name)} | ${codeCell(p.type ?? "unknown")} | ${p.default && p.default !== "-" ? codeCell(p.default) : "—"} | ${cell(p.description) || "—"} |`,
      );
    push("");
  }
  if (meta?.ref) {
    push("### Ref", "");
    if (methods.length) {
      push(
        `${code("ref")} receives a ${code(meta.ref.type)} handle with these methods.`,
        "",
        "| Method | Description |",
        "| --- | --- |",
      );
      for (const m of methods) push(`| ${codeCell(m.signature)} | ${cell(m.description) || "—"} |`);
      push("");
    } else {
      push(`${code("ref")} points at the root ${code(meta.ref.type)}.`, "");
    }
  }
  if (subs.length) {
    push("### Subcomponents", "", "| Component | Description |", "| --- | --- |");
    for (const s of subs) push(`| ${codeCell(s.name)} | ${cell(s.description) || "—"} |`);
    push("");
  }

  keyboardSection(meta, push);
  accessibilitySection(meta, push);

  const tokens = meta?.tokens ?? [];
  push("## Theming", "");
  push(
    `Styled with Tailwind classes on your shadcn theme tokens, so light and dark follow your theme. The accent comes from ${code("--lumesec")}. See [Theming](/docs/theming).`,
    "",
  );
  if (tokens.length) push(`This component reads ${list(tokens.map(code))}.`, "");
  notesSection(meta, push);
}

/* ---------------------------------------------------------------- custom element page */

/** Attribute type for the table: JSON attributes show the record type they hold. */
const attrType = (a) =>
  a.type === "json" && a.tsType ? `${a.tsType.replace(/ElementModule\./g, "")} (JSON)` : (a.type ?? "string");

function elementPage(el, meta, push) {
  if (meta?.attributes?.length)
    push(
      "## Playground",
      "",
      "Change a prop and the component updates. Props marked live animate to the new value; the others rebuild the element.",
      "",
      `<Playground tag="${el.tag}" />`,
      "",
    );
  push("## Installation", "", `<Install tag="${el.tag}" />`, "");
  push("## Usage", "", `<Usage tag="${el.tag}" />`, "");
  behaviour(el, push);

  const attrs = meta?.attributes ?? el.attributes.map((a) => ({ name: a.name, type: a.type, description: "" }));
  const events =
    meta?.events ??
    el.events.map((e) => ({
      name: e.name,
      detail: e.detail.length ? `{ ${e.detail.join(", ")} }` : "",
      description: "",
    }));
  const methods = meta?.methods ?? el.methods.map((m) => ({ signature: `${m}()`, description: "" }));
  const props = meta?.properties ?? [];
  const slots = meta?.slots ?? [];

  if (attrs.length || events.length || methods.length || props.length || slots.length) push("## API reference", "");
  if (attrs.length) {
    const reactProp = (name) =>
      el.attributes.find((a) => a.name === name)?.prop ?? name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    push(
      "### Attributes",
      "",
      "| Attribute | React prop | Type | Default | Description |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const a of attrs)
      push(
        `| ${codeCell(a.name)} | ${codeCell(reactProp(a.name))} | ${codeCell(attrType(a))} | ${a.default !== undefined && a.default !== "" ? codeCell(a.default) : "—"} | ${cell(a.description) || "—"} |`,
      );
    push("");
  }
  if (events.length) {
    const reactEvent = (name) =>
      el.events.find((e) => e.name === name)?.prop ??
      "on" + name.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
    push(
      "### Events",
      "",
      "Events bubble and cross the shadow boundary unless the description says otherwise.",
      "",
      "| Event | React prop | Detail | Description |",
      "| --- | --- | --- | --- |",
    );
    for (const e of events)
      push(
        `| ${codeCell(e.name)} | ${codeCell(reactEvent(e.name))} | ${e.detail ? codeCell(e.detail) : "—"} | ${cell(e.description) || "—"} |`,
      );
    push("");
  }
  if (methods.length) {
    push(
      "### Methods",
      "",
      "Call them on the element, for example through a React ref.",
      "",
      "| Method | Description |",
      "| --- | --- |",
    );
    for (const m of methods) push(`| ${codeCell(m.signature)} | ${cell(m.description) || "—"} |`);
    push("");
  }
  if (props.length) {
    push("### Properties", "", "| Property | Type | Description |", "| --- | --- | --- |");
    for (const p of props)
      push(
        `| ${codeCell(p.name)}${p.readonly ? " (read-only)" : ""} | ${codeCell(p.type ?? "unknown")} | ${cell(p.description) || "—"} |`,
      );
    push("");
  }
  if (slots.length) {
    push("### Slots", "", "| Slot | Description |", "| --- | --- |");
    for (const s of slots) push(`| ${codeCell(s.name || "(default)")} | ${cell(s.description)} |`);
    push("");
  }

  keyboardSection(meta, push);
  accessibilitySection(meta, push);

  const { theme, overrides } = elementTokens(el);
  push("## Theming", "");
  push(
    `The element reads your shadcn theme tokens through its shadow root, so light and dark follow your theme. The accent comes from ${code("--lumesec")}. See [Theming](/docs/theming).`,
    "",
  );
  if (theme.length) push(`This component reads ${list(theme.map(code))}.`, "");
  if (overrides.length)
    push(
      `To restyle only LumeSec elements, set the matching ${code("--ui-*")} overrides: ${list(overrides.map(code))}.`,
      "",
    );
  notesSection(meta, push);
}

/* ---------------------------------------------------------------- page */

/** Says right under the preview whether the component takes your data or only shows demo data. */
function dataCallout(meta, push) {
  const d = meta?.data;
  if (d?.kind === "demo") {
    push(
      `<Callout title="Demo data" type="warning">`,
      "",
      `${mdx(d.note)} It cannot show your own data yet, so use it as a template: replace the invented data in its source before it shows anything real. See [Your data](/docs/data).`,
      "",
      "</Callout>",
      "",
    );
  } else if (d?.kind === "input") {
    push(`<Callout title="Your data">`, "", `${mdx(d.note)} See [Your data](/docs/data).`, "", "</Callout>", "");
  }
}

function page(el, meta) {
  const lines = [];
  const push = (...l) => lines.push(...l);
  push(
    "---",
    `title: ${JSON.stringify(el.title)}`,
    `description: ${JSON.stringify(summaryOf(el, meta))}`,
    `tag: ${el.tag}`,
    `updated: "${el.added}"`,
    "---",
    "",
  );
  push(`<ComponentPreview tag="${el.tag}" />`, "");
  dataCallout(meta, push);
  if (el.kind === "react") reactPage(el, meta, push);
  else elementPage(el, meta, push);
  push(`<RelatedComponents tag="${el.tag}" />`, "");
  return lines.join("\n");
}

/* ---------------------------------------------------------------- write */

/** Existing pages are kept unless --force, and pages marked `generated: false` always. */
function keep(file) {
  if (!existsSync(file)) return false;
  return !force || /^generated:\s*false/m.test(readFileSync(file, "utf8"));
}

let written = 0;
let kept = 0;
for (const c of collections) {
  const dir = join(ROOT, "content/components", c.slug);
  mkdirSync(dir, { recursive: true });
  const items = elements.filter((e) => e.collection === c.slug);
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ title: c.title, pages: items.map((e) => e.slug) }, null, 2) + "\n",
  );
  for (const el of items) {
    const file = join(dir, `${el.slug}.mdx`);
    if (keep(file)) {
      kept++;
      continue;
    }
    const notesFile = join(ROOT, "content/meta", `${el.tag}.json`);
    writeFileSync(file, page(el, existsSync(notesFile) ? readJson(notesFile) : null));
    written++;
  }
}
console.log(`component pages: ${written} written, ${kept} kept`);

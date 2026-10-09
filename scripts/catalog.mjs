#!/usr/bin/env node
// Builds the component metadata from the registry sources, which are the source of truth:
//   content/catalog.json               curated entries: title, description, demo markup, group, layout
//   content/meta/{tag}.json            verified API notes (props for React components, attributes and
//                                      events for custom elements)
//   registry/components/lumesec/       native React components ({tag}.tsx with a demo in
//                                      registry/examples/{tag}-demo.tsx) and typed custom elements
//                                      ({tag}.element.ts)
// Writes:
//   registry/components/lumesec/{tag}.tsx   typed React wrapper, for custom elements only
//   src/generated/elements.json             metadata for docs, search, llms.txt and the registry
//   src/generated/collections.json          collection metadata with counts
//   src/generated/loaders.ts                lazy element loaders for live previews
//   src/generated/demos.ts, react-tags.json React demos for live previews
//
// Run after adding or changing a component, its demo or its notes: `pnpm catalog`.
//   node scripts/catalog.mjs --dry     analyses and reports without writing anything
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as prettier from "prettier";
import ts from "typescript";

import { camel, COLLECTIONS, ENGINES, LIB_MODULES, pascal, readJson, ROOT, SITE_URL } from "./lib/catalog.mjs";
import { usageFor } from "./lib/usage.mjs";

const COMPONENTS = join(ROOT, "registry/components/lumesec");
const LIB = join(ROOT, "registry/lib/lumesec");
const EXAMPLES = join(ROOT, "registry/examples");
const GENERATED = join(ROOT, "src/generated");

const DRY = process.argv.includes("--dry");

function write(file, text) {
  if (!DRY) writeFileSync(file, text.replace(/\r\n/g, "\n"));
}

/** Custom-element wrappers, written once every entry is analysed (see the end of this script). */
const wrappers = [];

const collectionOf = Object.fromEntries(COLLECTIONS.map((c) => [c.slug, c]));

/* ------------------------------------------------------------------ catalog entries */

const REQUIRED_FIELDS = ["tag", "component", "collection", "slug", "title", "stage", "layout", "added"];
const LAYOUTS = new Set(["center", "fill", "wide"]);

/** The entries of content/catalog.json, checked, with the fields the site reads. */
function readCatalog() {
  const entries = readJson(join(ROOT, "content/catalog.json"));
  if (!Array.isArray(entries)) throw new Error("content/catalog.json: expected an array of entries");
  const seen = new Map();
  return entries.map((entry, index) => {
    const where = `content/catalog.json[${index}]${entry?.tag ? ` (${entry.tag})` : ""}`;
    const missing = REQUIRED_FIELDS.filter((field) => typeof entry?.[field] !== "string" || !entry[field]);
    if (missing.length) throw new Error(`${where}: missing ${missing.join(", ")}`);
    if (!collectionOf[entry.collection]) throw new Error(`${where}: unknown collection "${entry.collection}"`);
    if (!LAYOUTS.has(entry.layout)) throw new Error(`${where}: layout must be one of ${[...LAYOUTS].join(", ")}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.added)) throw new Error(`${where}: added must be a date (YYYY-MM-DD)`);
    for (const key of [entry.tag, entry.component, `${entry.collection}/${entry.slug}`]) {
      if (seen.has(key)) throw new Error(`${where}: "${key}" is already used by ${seen.get(key)}`);
      seen.set(key, where);
    }
    return {
      tag: entry.tag,
      component: entry.component,
      collection: entry.collection,
      slug: entry.slug,
      title: entry.title,
      description: entry.description ?? [],
      tryText: entry.tryText ?? null,
      group: entry.group ?? null,
      stage: entry.stage,
      stageClass: entry.stageClass ?? "",
      layout: entry.layout,
      markup: entry.markup ?? null,
      added: entry.added,
    };
  });
}

const catalog = readCatalog();
const knownTags = new Set(catalog.map((e) => e.tag));

/** Verified API notes written for the docs (content/meta/{tag}.json). */
function readNotes(tag) {
  const file = join(ROOT, "content/meta", `${tag}.json`);
  return existsSync(file) ? readJson(file) : null;
}

/** Wrappers this script generates call `useLumesecElement`; hand-written components do not. */
const isGeneratedWrapper = (file) => readFileSync(file, "utf8").includes("useLumesecElement");

/** A native React component: its .tsx is not a wrapper and it has a demo. */
function kindOf(tag) {
  const component = join(COMPONENTS, `${tag}.tsx`);
  const demo = join(EXAMPLES, `${tag}-demo.tsx`);
  return existsSync(demo) && existsSync(component) && !isGeneratedWrapper(component) ? "react" : "element";
}

/* ------------------------------------------------------------------ source analysis */

/** Classes in a module, with the attributes they observe. */
function classesIn(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const classes = [];
  const isObservedAttributes = (member) =>
    member.name &&
    (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
    member.name.text === "observedAttributes" &&
    member.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword);
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const member = node.members.find(isObservedAttributes);
      const observed = member ? [...member.getText(sf).matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]) : [];
      classes.push({ name: node.name.text, observed });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return classes;
}

const isPlainAttribute = (name) => !/^(data|aria)-/.test(name);

/** Attribute names and their types detected from attribute reads (fallback when there are no notes). */
function detectAttributes(code) {
  const attrs = new Map();
  const rank = { number: 3, boolean: 2, string: 1 };
  const add = (name, type) => {
    if (!isPlainAttribute(name)) return;
    const current = attrs.get(name);
    if (!current || rank[type] > rank[current]) attrs.set(name, type);
  };
  for (const m of code.matchAll(/this\.num\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) add(m[1], "number");
  for (const m of code.matchAll(/this\.hasAttribute\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) add(m[1], "boolean");
  for (const m of code.matchAll(/this\.getAttribute\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) add(m[1], "string");
  return attrs;
}

/** Event names fired by the module (fallback when there are no notes). */
function detectEvents(code) {
  const events = new Set();
  for (const m of code.matchAll(/\.emit(?:<[^()]*?>)?\(\s*['"]([a-z][\w-]*)['"]/g)) events.add(m[1]);
  for (const m of code.matchAll(/new (?:Custom)?Event(?:<[^()]*?>)?\(\s*['"]([a-z][\w-]*)['"]/g)) events.add(m[1]);
  return [...events];
}

/** Other components a module renders or imports. */
function nestedTags(tag, code) {
  const found = new Set();
  for (const m of code.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)[\s>/]/g)) found.add(m[1]);
  for (const m of code.matchAll(/@\/components\/lumesec\/([a-z0-9-]+?)(?:\.element)?["']/g)) found.add(m[1]);
  found.delete(tag);
  return [...found].filter((t) => knownTags.has(t)).sort();
}

/** Method names from documented signatures such as `reset(): void`. */
const methodNames = (methods = []) =>
  methods.map((m) => String(m.signature).match(/^([A-Za-z_$][\w$]*)/)?.[1]).filter(Boolean);

/** Keys of an event detail written as a type, e.g. `{ value: number; source?: string }`. */
const detailKeys = (detail) => [...String(detail ?? "").matchAll(/([A-Za-z_$][\w$]*)\??\s*:/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ typed notes -> TS */

const ALLOWED_REFS = new Set([
  "Record",
  "Array",
  "ReadonlyArray",
  "Promise",
  "Date",
  "File",
  "FileList",
  "Blob",
  "FormData",
  "Map",
  "Set",
  "HTMLElement",
  "Element",
  "Event",
]);

/** True when `src` parses as a TypeScript type using only built-in names. */
function validTs(src) {
  const sf = ts.createSourceFile("t.ts", `type __T = ${src};`, ts.ScriptTarget.Latest, true);
  if (sf.parseDiagnostics?.length || sf.statements.length !== 1) return false;
  let ok = true;
  const visit = (n) => {
    if (ts.isTypeReferenceNode(n) && !ALLOWED_REFS.has(n.typeName.getText(sf))) ok = false;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return ok;
}

/** Notes write attribute types loosely ("number", "low | medium", "'a' | 'b'"); turn them into prop types. */
function propType(raw) {
  const t = String(raw ?? "string").trim();
  if (/^bool/i.test(t)) return "boolean";
  if (/^number\b/i.test(t) && !t.includes("|")) return "number";
  const words = t.split("|").map((w) => w.trim());
  const isKeyword = (w) => /^[a-z][\w-]*$/i.test(w) && !["string", "number", "boolean"].includes(w);
  if (words.length > 1 && words.every(isKeyword)) return words.map((w) => JSON.stringify(w)).join(" | ");
  if (words.length > 1 && validTs(t)) return t.replace(/'/g, '"');
  return "string";
}

/** The kind of value an attribute holds, for the docs, the playground and the usage snippets. */
function valueKind(attribute) {
  if (attribute.type === "json") return "json";
  const t = propType(attribute.type);
  return t === "boolean" || t === "number" ? t : "string";
}

/** Text for a JSDoc comment: one line that cannot end the comment early. */
const docText = (text) =>
  String(text ?? "")
    .replace(/\*\//g, "*\\/")
    .replace(/\s+/g, " ")
    .trim();
const jsdoc = (text, indent = "  ") => (text ? `${indent}/** ${docText(text)} */\n` : "");
const RESERVED_PROPS = new Set(["children", "className", "style", "ref", "key", "id", "slot"]);

/* ------------------------------------------------------------------ element wrappers */

/** The wrapper's note on data: demo-only components say so where the developer reads the props. */
function dataDoc(notes) {
  const kind = notes?.data?.kind;
  if (kind === "demo")
    return `\n *\n * Demo data: ${docText(notes.data.note)} It cannot show your own data yet; use it as a template.`;
  if (kind === "input") return `\n *\n * Data: ${docText(notes.data.note)}`;
  return "";
}

function attributeProp(attribute) {
  const hasDefault = attribute.default !== undefined && attribute.default !== "";
  const doc = `${attribute.description ?? `\`${attribute.name}\` attribute.`}${hasDefault ? ` Default: \`${attribute.default}\`.` : ""}`;
  return `${jsdoc(doc)}  ${camel(attribute.name)}?: ${attribute.tsType || propType(attribute.type)};`;
}

function eventProp(event, info) {
  return `${jsdoc(event.description ?? `Fires on \`${event.name}\`.`)}  on${pascal(event.name)}?: (event: ${eventType(event, info)}) => void;`;
}

/** The event's type: from the module's typed event map, else from the detail written in the notes. */
function eventType(event, info) {
  if (info.eventMap) return `ElementModule.${info.eventMap}[${JSON.stringify(event.name)}]`;
  const detail = String(event.detail ?? "")
    .trim()
    .replace(/'/g, '"');
  if (!detail || detail === "{}") return "CustomEvent<Record<string, never>>";
  return `CustomEvent<${validTs(detail) ? detail : "Record<string, unknown>"}>`;
}

function wrapper(entry, info) {
  const name = entry.component;
  const collection = collectionOf[entry.collection];
  const attrs = info.attributeNotes.filter(
    (a) => a?.name && !RESERVED_PROPS.has(camel(a.name)) && isPlainAttribute(a.name),
  );
  const events = info.eventNotes;
  const propNames = attrs.map((a) => camel(a.name));
  const eventProps = events.map((e) => `on${pascal(e.name)}`);
  const ownProps = [...propNames, ...eventProps];
  const omit = [...new Set(ownProps)].map((n) => JSON.stringify(n)).join(" | ") || "never";
  const body = [...attrs.map(attributeProp), ...events.map((e) => eventProp(e, info))].join("\n");
  const summary = docText(info.notes?.summary ?? entry.description[0]);
  const attributeMap = attrs.length
    ? `{ ${attrs.map((a) => `${JSON.stringify(a.name)}: ${camel(a.name)}`).join(", ")} }`
    : "{}";
  const eventMap = events.length
    ? `{ ${events.map((e) => `${JSON.stringify(e.name)}: on${pascal(e.name)}`).join(", ")} }`
    : "{}";

  return `"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/${entry.tag}.element";
import type * as ElementModule from "@/components/lumesec/${entry.tag}.element";

/** The \`<${entry.tag}>\` element, with its properties and methods. */
export type ${name}Element = ElementModule.${info.className};

${
  body
    ? `export interface ${name}Props extends Omit<LumesecElementProps<${name}Element>, ${omit}> {
${body}
}`
    : `export type ${name}Props = LumesecElementProps<${name}Element>;`
}

/**
 * ${entry.title} · \`<${entry.tag}>\` · LumeSec Elements, ${collection.title}.
 * ${summary}${dataDoc(info.notes)}
 * @see ${SITE_URL}/components/${entry.collection}/${entry.slug}
 */
export function ${name}({ ${ownProps.map((p) => `${p}, `).join("")}...props }: ${name}Props) {
  return useLumesecElement(
    "${entry.tag}",
    props,
    ${attributeMap},
    ${eventMap},
  );
}
`;
}

/* ------------------------------------------------------------------ install files */

const libImports = (text) => [
  ...new Set([...text.matchAll(/from\s+["']@\/lib\/lumesec\/([\w-]+)["']/g)].map((m) => m[1])),
];

function libPath(name) {
  for (const ext of ["ts", "tsx"])
    if (existsSync(join(LIB, `${name}.${ext}`))) return `registry/lib/lumesec/${name}.${ext}`;
  throw new Error(`missing lib module @/lib/lumesec/${name}`);
}

/** Lib modules a set of files needs, dependencies first. */
function libClosure(texts) {
  const ordered = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of libImports(readFileSync(join(ROOT, libPath(name)), "utf8"))) visit(dep);
    ordered.push(name);
  };
  texts.flatMap(libImports).forEach(visit);
  return ordered;
}

/** The files to copy for a manual install, in order: shared modules, then the component. */
function installFiles(tag, kind, texts) {
  const files = libClosure(texts).map((name) => {
    const source = libPath(name);
    return {
      target: `lib/lumesec/${name}.${source.split(".").pop()}`,
      source,
      title: LIB_MODULES[name]?.[0] ?? name,
      note: ENGINES.has(name)
        ? "Shared by every component of this family. Copy it once."
        : "Shared by several components. Copy it once.",
    };
  });
  if (kind === "react") {
    files.push({
      target: `components/lumesec/${tag}.tsx`,
      source: `registry/components/lumesec/${tag}.tsx`,
      title: "The component",
      note: "React and Tailwind. Uses `cn` from `@/lib/utils`.",
    });
    return files;
  }
  files.push(
    {
      target: `components/lumesec/${tag}.element.ts`,
      source: `registry/components/lumesec/${tag}.element.ts`,
      title: "The element",
      note: "Framework-free TypeScript. Importing it registers the tag.",
    },
    {
      target: `components/lumesec/${tag}.tsx`,
      source: `registry/components/lumesec/${tag}.tsx`,
      title: "React wrapper",
      note: "Typed props and event handlers.",
    },
  );
  return files;
}

/* ------------------------------------------------------------------ metadata */

function reactMeta(entry, notes) {
  if (notes?.kind !== "react")
    console.warn(`! ${entry.tag}: React component without React notes (content/meta/${entry.tag}.json)`);
  const source = readFileSync(join(COMPONENTS, `${entry.tag}.tsx`), "utf8");
  const demo = readFileSync(join(EXAMPLES, `${entry.tag}-demo.tsx`), "utf8");
  return {
    ...entry,
    name: entry.tag,
    kind: "react",
    props: (notes?.props ?? []).map((p) => ({ name: p.name, type: p.type, default: p.default ?? "-" })),
    attributes: [],
    events: [],
    methods: methodNames(notes?.ref?.methods),
    observed: [],
    controls: (notes?.playground?.controls ?? []).map((c) => ({
      name: c.name,
      kind: c.kind,
      options: c.options ?? null,
      default: c.default ?? null,
    })),
    playgroundProps: notes?.playground?.props ?? {},
    formAssociated: Boolean(notes?.form),
    data: notes?.data?.kind ?? null,
    dataNote: notes?.data?.note ?? null,
    nested: nestedTags(entry.tag, source),
    files: installFiles(entry.tag, "react", [source]),
    usage: { react: notes?.usage ?? "", html: null, uses: [entry.tag, ...nestedTags(entry.tag, demo)] },
  };
}

/** Writes the typed React wrapper of a custom element and returns its text. */
function writeWrapper(entry, info) {
  const file = join(COMPONENTS, `${entry.tag}.tsx`);
  // never overwrite a hand-written component (a native React port in progress)
  if (existsSync(file) && !isGeneratedWrapper(file)) {
    console.warn(`! ${entry.tag}: ${entry.tag}.tsx is not a generated wrapper; left untouched`);
    return readFileSync(file, "utf8");
  }
  const text = wrapper(entry, info);
  wrappers.push({ file, text });
  return text;
}

function elementMeta(entry, notes) {
  const file = join(COMPONENTS, `${entry.tag}.element.ts`);
  if (!existsSync(file))
    throw new Error(
      `${entry.tag}: neither a native React component (with a demo) nor a custom element module (${entry.tag}.element.ts)`,
    );
  const source = readFileSync(file, "utf8");
  const classes = classesIn(source, file);
  const exported =
    source.match(/export\s*\{\s*([A-Za-z_$][\w$]*)/)?.[1] ?? source.match(/export\s+class\s+([A-Za-z_$][\w$]*)/)?.[1];
  const cls = classes.find((c) => c.name === exported) ?? classes[0];
  if (!cls) throw new Error(`${entry.tag}: no class found in ${file}`);
  const eventMap = new RegExp(`export\\s+interface\\s+${cls.name}EventMap\\b`).test(source)
    ? `${cls.name}EventMap`
    : null;

  const detected = detectAttributes(source);
  for (const name of cls.observed) if (!detected.has(name) && isPlainAttribute(name)) detected.set(name, "string");
  const attributeNotes = notes?.attributes ?? [...detected].map(([name, type]) => ({ name, type }));
  const eventNotes = notes?.events ?? detectEvents(source).map((name) => ({ name }));
  const wrapperText = writeWrapper(entry, { notes, className: cls.name, eventMap, attributeNotes, eventNotes });

  return {
    ...entry,
    name: entry.tag,
    kind: "element",
    props: [],
    attributes: attributeNotes
      .filter((a) => a?.name && isPlainAttribute(a.name))
      .map((a) => ({ name: a.name, prop: camel(a.name), type: valueKind(a) })),
    events: eventNotes.map((e) => ({ name: e.name, prop: `on${pascal(e.name)}`, detail: detailKeys(e.detail) })),
    methods: methodNames(notes?.methods),
    observed: cls.observed,
    // playground controls: allowed values and defaults from the verified notes; JSON data has no control
    controls: (notes?.attributes ?? [])
      .filter((a) => a?.name && isPlainAttribute(a.name) && a.type !== "json")
      .map((a) => {
        const t = propType(a.type);
        const options = t.includes('"') ? [...t.matchAll(/"([^"]*)"/g)].map((m) => m[1]) : null;
        return { name: a.name, kind: options ? "enum" : valueKind(a), options, default: a.default ?? null };
      }),
    playgroundProps: {},
    formAssociated: /extends\s+FormMixin\(|static\s+(get\s+)?formAssociated|attachInternals\(/.test(source),
    // "input": shows your data (demo data until you pass it); "demo": shows invented data only; null: no data
    data: notes?.data?.kind ?? null,
    dataNote: notes?.data?.note ?? null,
    nested: nestedTags(entry.tag, source),
    files: installFiles(entry.tag, "element", [source, wrapperText]),
  };
}

const meta = catalog.map((entry) => {
  const notes = readNotes(entry.tag);
  return kindOf(entry.tag) === "react" ? reactMeta(entry, notes) : elementMeta(entry, notes);
});

const byTag = new Map(meta.map((m) => [m.tag, m]));
for (const m of meta) if (m.kind === "element") m.usage = usageFor(m, byTag);

/* ------------------------------------------------------------------ write */

const reactTags = meta.filter((m) => m.kind === "react").map((m) => m.tag);
const elementTags = meta.filter((m) => m.kind === "element").map((m) => m.tag);

function collectionKind(items) {
  if (items.every((m) => m.kind === "react")) return "react";
  if (items.every((m) => m.kind === "element")) return "element";
  return "mixed";
}

const collections = COLLECTIONS.map((c) => {
  const items = meta.filter((m) => m.collection === c.slug);
  return {
    ...c,
    count: items.length,
    kind: collectionKind(items),
    groups: [...new Set(items.map((m) => m.group).filter(Boolean))],
    updated: items
      .map((m) => m.added)
      .sort()
      .at(-1),
  };
});

const json = (value) => JSON.stringify(value, null, 2) + "\n";

// The wrappers are committed with the rest of registry/, so they are written in the repository's Prettier
// style: `pnpm format` leaves them unchanged, and CI can compare a fresh catalog run with the commit.
const prettierOptions = await prettier.resolveConfig(join(COMPONENTS, "wrapper.tsx"));
for (const { file, text } of wrappers) {
  write(file, await prettier.format(text, { ...prettierOptions, filepath: file }));
}

write(join(GENERATED, "elements.json"), json(meta));
write(join(GENERATED, "collections.json"), json(collections));
write(
  join(GENERATED, "loaders.ts"),
  `// Generated by scripts/catalog.mjs. Lazy element loaders for live previews.
export const loaders: Record<string, () => Promise<unknown>> = {
${elementTags.map((t) => `  ${JSON.stringify(t)}: () => import("@/components/lumesec/${t}.element"),`).join("\n")}
};
`,
);
write(
  join(GENERATED, "demos.ts"),
  `// Generated by scripts/catalog.mjs. React demos for native React components.
import type { ComponentType } from "react";

export const demos: Record<string, () => Promise<{ default: ComponentType }>> = {
${reactTags.map((t) => `  ${JSON.stringify(t)}: () => import("@/examples/${t}-demo"),`).join("\n")}
};

/** Component modules, for the docs playground. */
export const reactModules: Record<string, () => Promise<Record<string, unknown>>> = {
${reactTags.map((t) => `  ${JSON.stringify(t)}: () => import("@/components/lumesec/${t}"),`).join("\n")}
};
`,
);
write(join(GENERATED, "react-tags.json"), json(reactTags));

const byCollection = Object.fromEntries(collections.map((c) => [c.slug, c.count]));
console.log(
  `catalog: ${meta.length} components (${reactTags.length} React, ${elementTags.length} elements)${DRY ? ", dry run" : ""}`,
  byCollection,
);

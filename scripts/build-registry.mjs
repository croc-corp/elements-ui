#!/usr/bin/env node
// Builds the shadcn registry and the plain-HTML modules. Run after `pnpm catalog`.
//   registry.json              source manifest
//   .registry/r/*.json         `shadcn build` output, served by src/app/r/[name]/route.ts
//   public/cdn/{tag}.js        one ES module per custom element, engine inlined
//   public/cdn/{collection}.js every custom element of a collection
//
// Native React components ship as one .tsx file plus the shared lib files they import. Custom elements
// ship as their typed module, a typed React wrapper and their engine.
//
// Item URLs point at NEXT_PUBLIC_SITE_URL (from the shell, not .env.local), so a self-hosted site serves a
// registry that installs from itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

import { execBin } from "./lib/bin.mjs";
import { LIB_MODULES, libItemName, readJson, ROOT, SITE_URL } from "./lib/catalog.mjs";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/$/, "");
const LIB = join(ROOT, "registry/lib/lumesec");
const COMPONENTS = join(ROOT, "registry/components/lumesec");

const read = (file) => readFileSync(file, "utf8");

const elements = readJson(join(ROOT, "src/generated/elements.json"));
const collections = readJson(join(ROOT, "src/generated/collections.json"));

const r = (name) => `${SITE}/r/${name}.json`;

/** The one-line summary from the verified notes, else the start of the description. */
function summary(el) {
  const file = join(ROOT, "content/meta", `${el.tag}.json`);
  const notes = existsSync(file) ? readJson(file) : null;
  return notes?.summary ?? (el.description[0] ?? el.title).slice(0, 200);
}

/** What a source file imports from the registry: lib modules, components, and shadcn's `cn`. */
function importsOf(text) {
  const lib = [...new Set([...text.matchAll(/from\s+["']@\/lib\/lumesec\/([\w-]+)["']/g)].map((m) => m[1]))];
  const components = [...new Set([...text.matchAll(/["']@\/components\/lumesec\/([a-z0-9-]+?)(?:\.element)?["']/g)].map((m) => m[1]))];
  return { lib, components, utils: /from\s+["']@\/lib\/utils["']/.test(text) };
}

/* ---------------------------------------------------------------- registry.json */
// Files carry alias-relative targets (@lib/…, @components/…): the CLI resolves them inside the
// project's own alias roots, keeps the lumesec/ sub-folders, and works the same on Windows.

const items = [];

items.push({
  name: "lumesec-theme",
  type: "registry:theme",
  title: "LumeSec accent tokens",
  description: "Adds the --lumesec accent tokens (Electric, its soft shade, shine, glint, success, warning, info) to your shadcn theme, with Tailwind colours.",
  cssVars: {
    theme: Object.fromEntries(
      ["lumesec", "lumesec-foreground", "lumesec-soft", "lumesec-shine", "lumesec-glint", "lumesec-success", "lumesec-warning", "lumesec-info"].map((n) => [`color-${n}`, `var(--${n})`]),
    ),
    light: {
      lumesec: "#6219f3",
      "lumesec-foreground": "#fafafa",
      "lumesec-soft": "#a685ff",
      "lumesec-shine": "#3f12b0",
      "lumesec-glint": "#c9bdff",
      "lumesec-success": "#00a14b",
      "lumesec-warning": "#d97706",
      "lumesec-info": "#1e40af",
    },
    dark: {
      lumesec: "#8654fb",
      "lumesec-foreground": "#fafafa",
      "lumesec-soft": "#a685ff",
      "lumesec-shine": "#ffffff",
      "lumesec-glint": "#ffffff",
      "lumesec-success": "#00c758",
      "lumesec-warning": "#eeb154",
      "lumesec-info": "#4ab8e8",
    },
  },
  categories: ["theme"],
});

/* shared lib modules: one item each, dependencies from their own imports */
function libFile(name) {
  for (const ext of ["ts", "tsx"]) if (existsSync(join(LIB, `${name}.${ext}`))) return { path: `registry/lib/lumesec/${name}.${ext}`, ext };
  throw new Error(`missing lib module @/lib/lumesec/${name}`);
}

/** The files of a component, relative to registry/components/lumesec. */
const filesOf = (el) => (el.kind === "react" ? [`${el.tag}.tsx`] : [`${el.tag}.element.ts`, `${el.tag}.tsx`]);

const usedLibs = new Set();
const componentFiles = new Map();
for (const el of elements) {
  const files = filesOf(el);
  const imports = files.map((f) => importsOf(read(join(COMPONENTS, f))));
  const merged = {
    lib: [...new Set(imports.flatMap((i) => i.lib))],
    components: [...new Set(imports.flatMap((i) => i.components))].filter((t) => t !== el.tag),
    utils: imports.some((i) => i.utils),
  };
  componentFiles.set(el.tag, { files, imports: merged });
  merged.lib.forEach((l) => usedLibs.add(l));
}

// close over lib → lib imports
const libQueue = [...usedLibs];
while (libQueue.length) {
  const name = libQueue.pop();
  for (const dep of importsOf(read(join(ROOT, libFile(name).path))).lib) {
    if (!usedLibs.has(dep)) {
      usedLibs.add(dep);
      libQueue.push(dep);
    }
  }
}

for (const name of [...usedLibs].sort()) {
  const file = libFile(name);
  const deps = importsOf(read(join(ROOT, file.path)));
  const [title, description] = LIB_MODULES[name] ?? [name, `Shared module ${name}.`];
  items.push({
    name: libItemName(name),
    type: "registry:lib",
    title,
    description,
    registryDependencies: [...deps.lib.map((l) => r(libItemName(l))), ...(deps.utils ? ["utils"] : [])],
    files: [{ path: file.path, type: "registry:lib", target: `@lib/lumesec/${name}.${file.ext}` }],
    categories: ["core"],
  });
}

/* components */
for (const el of elements) {
  const { files, imports } = componentFiles.get(el.tag);
  const deps = [r("lumesec-theme"), ...imports.lib.map((l) => r(libItemName(l))), ...(imports.utils ? ["utils"] : [])];
  // demos that host other components (a shell around a map) pull them in too
  for (const t of new Set([...imports.components, ...(el.nested ?? []), ...(el.usage?.uses ?? [])])) if (t !== el.tag) deps.push(r(t));
  items.push({
    name: el.tag,
    type: "registry:component",
    title: el.title,
    // `shadcn search` and `view` show the description: say up front when a component only shows demo data
    description: el.data === "demo" ? `Demo data (a template: it cannot show your own data yet). ${summary(el)}` : summary(el),
    registryDependencies: [...new Set(deps)],
    files: files.map((f) => ({ path: `registry/components/lumesec/${f}`, type: "registry:component", target: `@components/lumesec/${f}` })),
    categories: [el.collection, (el.group ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")].filter(Boolean),
    docs: `${el.title} docs: ${SITE}/components/${el.collection}/${el.slug}`,
    meta: { tag: el.tag, collection: el.collection, react: el.component, kind: el.kind, ...(el.data ? { data: el.data } : {}) },
  });
}

/* whole collections: `shadcn add @lumesec/pixel-ui` installs every component of a collection */
for (const c of collections) {
  const tags = elements.filter((e) => e.collection === c.slug).map((e) => e.tag);
  items.push({
    name: c.slug,
    type: "registry:item",
    title: `${c.title} collection`,
    description: `Every ${c.title} component (${tags.length}). ${c.summary}`,
    registryDependencies: tags.map((t) => r(t)),
    files: [],
    categories: [c.slug, "collection"],
    docs: `${c.title}: ${SITE}/components/${c.slug}`,
  });
}

const manifest = { $schema: "https://ui.shadcn.com/schema/registry.json", name: "lumesec", homepage: SITE, items };
writeFileSync(join(ROOT, "registry.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`registry.json: ${items.length} items`);

/* ---------------------------------------------------------------- shadcn build */

const out = join(ROOT, ".registry/r");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execBin("shadcn", "shadcn", ["build", "registry.json", "--output", out], { stdio: "inherit" });

/* ---------------------------------------------------------------- CDN modules (custom elements only) */

const cdn = join(ROOT, "public/cdn");
rmSync(cdn, { recursive: true, force: true });
mkdirSync(cdn, { recursive: true });
const customElements = elements.filter((e) => e.kind === "element");
const bundle = {
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  alias: { "@/components/lumesec": COMPONENTS, "@/lib/lumesec": LIB },
  banner: { js: `/* LumeSec Elements · ${SITE} · MIT */` },
  legalComments: "none",
  logLevel: "warning",
};

await build({
  ...bundle,
  entryPoints: Object.fromEntries(customElements.map((e) => [e.tag, join(COMPONENTS, `${e.tag}.element.ts`)])),
  outdir: cdn,
  splitting: false,
});

let bundles = 0;
for (const c of collections) {
  const tags = customElements.filter((e) => e.collection === c.slug).map((e) => e.tag);
  if (!tags.length) continue;
  bundles++;
  await build({
    ...bundle,
    stdin: { contents: tags.map((t) => `import "@/components/lumesec/${t}.element";`).join("\n"), resolveDir: ROOT, loader: "js" },
    outfile: join(cdn, `${c.slug}.js`),
  });
}
console.log(`cdn: ${customElements.length} element modules, ${bundles} collection bundles`);

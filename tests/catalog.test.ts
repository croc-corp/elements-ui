import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPONENTS = join(ROOT, "registry/components/lumesec");

interface CatalogEntry {
  tag: string;
  component: string;
  collection: string;
  slug: string;
}

/** Parses a JSON file; a syntax error names the file. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const catalog = readJson("content/catalog.json") as CatalogEntry[];
const tags = new Set(catalog.map((entry) => entry.tag));

/** Custom elements have a generated React wrapper next to their module; native React components do not. */
const isCustomElement = (tag: string) =>
  readFileSync(join(COMPONENTS, `${tag}.tsx`), "utf8").includes("useLumesecElement");

const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

describe("content/catalog.json", () => {
  it("lists 181 components in five collections", () => {
    const counts: Record<string, number> = {};
    for (const entry of catalog) counts[entry.collection] = (counts[entry.collection] ?? 0) + 1;
    expect(counts).toEqual({ interaction: 11, "pixel-ui": 30, "pixel-lab": 50, "pixel-hd": 60, location: 30 });
    expect(catalog).toHaveLength(181);
  });

  it("uses each tag, component name and collection/slug pair once", () => {
    expect(duplicates(catalog.map((entry) => entry.tag))).toEqual([]);
    expect(duplicates(catalog.map((entry) => entry.component))).toEqual([]);
    expect(duplicates(catalog.map((entry) => `${entry.collection}/${entry.slug}`))).toEqual([]);
  });

  it("has notes, a docs page and a registry source for every entry", () => {
    const missing = catalog.flatMap(({ tag, collection, slug }) =>
      [
        `content/meta/${tag}.json`,
        `content/components/${collection}/${slug}.mdx`,
        `registry/components/lumesec/${tag}.tsx`,
      ].filter((file) => !existsSync(join(ROOT, file))),
    );
    expect(missing).toEqual([]);
  });

  it("pairs each custom element wrapper with its module, and each React component with its demo", () => {
    const missing = catalog.map(({ tag }) =>
      isCustomElement(tag) ? `registry/components/lumesec/${tag}.element.ts` : `registry/examples/${tag}-demo.tsx`,
    );
    expect(missing.filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
  });

  it("documents props for React components and attributes for custom elements", () => {
    const mismatched = catalog
      .filter(({ tag }) => {
        const notes = readJson(`content/meta/${tag}.json`) as Record<string, unknown>;
        return isCustomElement(tag)
          ? notes.kind !== undefined || !Array.isArray(notes.attributes)
          : notes.kind !== "react" || !Array.isArray(notes.props);
      })
      .map(({ tag }) => tag);
    expect(mismatched).toEqual([]);
  });
});

describe("content/meta", () => {
  it("holds one parseable notes object per catalog entry and nothing else", () => {
    const files = readdirSync(join(ROOT, "content/meta"));
    const notObjects = files.filter((file) => {
      const notes = readJson(`content/meta/${file}`);
      return notes === null || typeof notes !== "object" || Array.isArray(notes);
    });
    const orphans = files.filter((file) => !file.endsWith(".json") || !tags.has(file.slice(0, -".json".length)));
    expect(notObjects).toEqual([]);
    expect(orphans).toEqual([]);
  });
});

describe("demo copy", () => {
  const FORBIDDEN = [/\bClaude Code\b/i, /\bOpus\b/i, /\bSonnet\b/i, /\bHaiku\b/i, /\bAnthropic\b/i];
  // a radio station in px-tuner's demo data, and a computer scientist in px-identicon's sample names
  const ALLOWED = [/\bOPUS FM\b/gi, /\bClaude Shannon\b/g];

  it("names no AI models or vendors in content/ or registry/", () => {
    const offenders: string[] = [];
    for (const file of [...filesUnder("content"), ...filesUnder("registry")]) {
      let source = readFileSync(join(ROOT, file), "utf8");
      for (const pattern of ALLOWED) source = source.replace(pattern, "");
      for (const pattern of FORBIDDEN) {
        const match = pattern.exec(source);
        if (match) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

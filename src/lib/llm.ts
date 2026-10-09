import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { site } from "@/config/site";
import { collections, elementHref, elements, elementsIn, getCollection, getElement } from "@/lib/catalog";
import { componentsSource, type ComponentPage, type DocPage, docsSource } from "@/lib/source";

const fence = (lang: string, code: string) => "```" + lang + "\n" + code.trim() + "\n```";

function installMd(tag: string) {
  return [
    fence("bash", `npx shadcn@latest add ${site.registry.namespace}/${tag}`),
    "",
    `First time with the ${site.registry.namespace} registry? Register it once, or install by URL:`,
    "",
    fence(
      "bash",
      `npx shadcn@latest registry add ${site.registry.namespace}=${site.registry.url}\nnpx shadcn@latest add ${site.url}/r/${tag}.json`,
    ),
  ].join("\n");
}

/** Source of a native React component's demo, if it has one. */
function demoSource(tag: string) {
  const file = join(process.cwd(), "registry", "examples", `${tag}-demo.tsx`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Marks components that only show demo data in the Markdown lists. */
const demoMark = (e: { data: string | null }) => (e.data === "demo" ? " (demo data)" : "");

/** Replace the MDX components on our pages with plain Markdown equivalents. */
function expandJsx(md: string) {
  return md
    .replace(/<ComponentPreview\s+tag="([^"]+)"[^>]*\/>/g, (_, tag) => {
      const e = getElement(tag);
      if (!e) return "";
      const demo = e.kind === "react" ? demoSource(tag) : null;
      if (demo) return `Live preview: ${site.url}/view/${tag}\n\nDemo source:\n\n${fence("tsx", demo)}`;
      return `Live preview: ${site.url}/view/${tag}\n\n${fence("html", e.markup ?? e.usage.html ?? e.stage)}`;
    })
    .replace(/<Install\s+tag="([^"]+)"\s*\/>/g, (_, tag) => installMd(tag))
    .replace(/<Usage\s+tag="([^"]+)"\s*\/>/g, (_, tag) => {
      const e = getElement(tag);
      if (!e) return "";
      const react = `React:\n\n${fence("tsx", e.usage.react)}`;
      return e.usage.html ? `${react}\n\nHTML:\n\n${fence("html", e.usage.html)}` : react;
    })
    .replace(/<Callout\b([^>]*)>\s*([\s\S]*?)\s*<\/Callout>/g, (_, attrs: string, body: string) => {
      const title = /title="([^"]*)"/.exec(attrs)?.[1] ?? "Note";
      return `> **${title}:** ${body.replace(/\s*\n\s*/g, " ")}`;
    })
    .replace(/<DataList\s+kind="(input|demo)"\s*\/>/g, (_, kind: string) =>
      elements
        .filter((e) => e.data === kind)
        .map((e) => `- [${e.title}](${site.url}${elementHref(e)}.md) \`<${e.tag}>\`: ${e.dataNote ?? ""}`)
        .join("\n"),
    )
    .replace(/<RelatedComponents\s+tag="([^"]+)"\s*\/>/g, "")
    .replace(/## Playground\n+[^\n]*\n+<Playground\s+tag="([^"]+)"\s*\/>/g, "")
    .replace(/<Playground\s+tag="([^"]+)"\s*\/>/g, "")
    .replace(/^(#{1,6} .*?) \[#[^\]]+\]$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

/** A guide as Markdown, with the MDX components expanded. */
export async function docMarkdown(page: DocPage) {
  const body = await page.data.getText("processed");
  return `# ${page.data.title}\n\n> ${page.data.description ?? ""}\n\nSource: ${site.url}${page.url}\n\n${expandJsx(body)}\n`;
}

/** A component page as Markdown, headed by its tag, import, collection and registry item. */
export async function componentMarkdown(page: ComponentPage) {
  const tag = page.data.tag;
  const e = getElement(tag);
  const col = e ? getCollection(e.collection) : undefined;
  const body = await page.data.getText("processed");
  const head = [
    `# ${page.data.title}`,
    "",
    `> ${page.data.description ?? ""}`,
    "",
    e?.kind === "element" ? `- Element: \`<${tag}>\`` : "",
    e ? `- React: \`import { ${e.component} } from "@/components/lumesec/${tag}"\`` : "",
    col ? `- Collection: ${col.title} (${site.url}/components/${col.slug})` : "",
    e?.data === "demo" ? "- Data: demo data; it cannot show your own data yet (a template)" : "",
    e?.data === "input" ? "- Data: takes your data (`data`); shows demo data until you pass it" : "",
    `- Registry item: ${site.url}/r/${tag}.json`,
    `- Page: ${site.url}${page.url}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `${head}\n\n${expandJsx(body)}\n`;
}

/** A collection and its components as a Markdown list, or null for an unknown slug. */
export function collectionMarkdown(slug: string) {
  const c = getCollection(slug);
  if (!c) return null;
  const list = elementsIn(slug)
    .map(
      (e) =>
        `- [${e.title}](${site.url}${elementHref(e)}.md) \`<${e.tag}>\`${demoMark(e)}: ${(e.description[0] ?? "").replace(/\s+/g, " ")}`,
    )
    .join("\n");
  return `# ${c.title}\n\n> ${c.description}\n\n${c.count} components.\n\n${list}\n`;
}

/** llms.txt: every guide, collection and component, linked to its Markdown twin. */
export function indexMarkdown() {
  return [
    `# ${site.name}`,
    "",
    `> ${site.description}`,
    "",
    "## Guides",
    "",
    ...docsSource.getPages().map((p) => `- [${p.data.title}](${site.url}${p.url}.md): ${p.data.description ?? ""}`),
    "",
    "## Collections",
    "",
    ...collections.map(
      (c) => `- [${c.title}](${site.url}/components/${c.slug}.md): ${c.summary} (${c.count} components)`,
    ),
    "",
    ...collections.flatMap((c) => [
      `## ${c.title}`,
      "",
      ...elementsIn(c.slug).map((e) => `- [${e.title}](${site.url}${elementHref(e)}.md) \`<${e.tag}>\`${demoMark(e)}`),
      "",
    ]),
    "## Registry",
    "",
    `- Index: ${site.url}/r/registry.json`,
    `- Item: ${site.registry.url}`,
    `- Full documentation in one file: ${site.url}/llms-full.txt`,
    "",
  ].join("\n");
}

/** llms-full.txt: every guide and component page in one document. */
export async function fullMarkdown() {
  const docs = await Promise.all(docsSource.getPages().map(docMarkdown));
  const comps = await Promise.all(componentsSource.getPages().map(componentMarkdown));
  return [`# ${site.name}\n\n> ${site.description}\n`, ...docs, ...comps].join("\n\n---\n\n");
}

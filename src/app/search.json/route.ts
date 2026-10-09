import type { SearchEntry } from "@/components/site/command-menu";
import { collections, elementHref, elements, getCollection } from "@/lib/catalog";
import { docsSource } from "@/lib/source";

export const dynamic = "force-static";

/** The command palette's index: guides, their headings, collections and every component. */
export function GET() {
  const entries: SearchEntry[] = [];
  for (const p of docsSource.getPages()) {
    entries.push({ id: `page:${p.url}`, kind: "page", title: p.data.title, url: p.url, description: p.data.description });
    for (const h of p.data.toc) {
      if (h.depth > 3 || typeof h.title !== "string") continue;
      entries.push({ id: `heading:${p.url}${h.url}`, kind: "heading", title: h.title, url: `${p.url}${h.url}`, section: p.data.title });
    }
  }
  for (const c of collections) {
    entries.push({ id: `collection:${c.slug}`, kind: "collection", title: c.title, url: `/components/${c.slug}`, description: c.description, collection: c.slug, keywords: c.prefix });
  }
  for (const e of elements) {
    entries.push({
      id: `component:${e.tag}`,
      kind: "component",
      title: e.title,
      url: elementHref(e),
      description: e.description[0],
      section: getCollection(e.collection)?.title,
      tag: e.tag,
      collection: e.collection,
      keywords: [e.group, ...e.attributes.map((a) => a.name), ...e.events.map((v) => v.name)].filter(Boolean).join(" "),
    });
  }
  return Response.json(entries, { headers: { "Cache-Control": "public, max-age=3600" } });
}

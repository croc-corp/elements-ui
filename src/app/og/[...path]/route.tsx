import { collections, elements, getCollection, getElementByPath, totalComponents } from "@/lib/catalog";
import { renderOg } from "@/lib/og";
import { componentsSource, docsSource } from "@/lib/source";
import { countWord } from "@/lib/utils";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [
    { path: ["home.png"] },
    { path: ["components.png"] },
    { path: ["collections.png"] },
    ...docsSource.getPages().map((p) => ({
      path: p.slugs.length ? ["docs", ...p.slugs.slice(0, -1), `${p.slugs.at(-1)}.png`] : ["docs.png"],
    })),
    ...collections.map((c) => ({ path: ["components", `${c.slug}.png`] })),
    ...elements.map((e) => ({ path: ["components", e.collection, `${e.slug}.png`] })),
  ];
}

/** Open Graph images for every page, rendered at build time. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  // the last segment carries the extension: docs/theming.png → docs/theming
  const key = segments.join("/").replace(/\.png$/, "");
  const path = key.split("/");

  if (key === "home") {
    return renderOg({
      eyebrow: "LumeSec Elements · shadcn registry",
      title: "Built in the lab. Shipped to your repo.",
      description: "Interactive components for React and plain HTML: controls, meters, charts and dot-matrix displays.",
      footer: "npx shadcn add @lumesec/…",
    });
  }
  if (key === "components") {
    return renderOg({
      eyebrow: `Components · ${totalComponents} live previews`,
      title: "Every component. Running, not pictured.",
      description: `${countWord(collections.length, true)} collections in one registry. Every preview is the real element.`,
    });
  }
  if (key === "collections") {
    return renderOg({
      eyebrow: "Collections",
      title: `${countWord(collections.length, true)} collections. One way of moving.`,
      description: collections.map((c) => c.title).join(" · "),
    });
  }
  if (path[0] === "docs") {
    const page = docsSource.getPage(path.slice(1));
    if (page)
      return renderOg({
        eyebrow: "Docs",
        title: page.data.title,
        description: page.data.description,
        motif: "default",
      });
  }
  if (path[0] === "components" && path.length === 2) {
    const c = getCollection(path[1]);
    if (c)
      return renderOg({
        eyebrow: `Collection · ${c.count} components`,
        title: c.title,
        description: c.summary,
        motif: c.slug,
        footer: c.kind === "react" ? `shadcn add @lumesec/${c.slug}` : `/cdn/${c.slug}.js`,
      });
  }
  if (path[0] === "components" && path.length === 3) {
    const e = getElementByPath(path[1], path[2]);
    const page = componentsSource.getPage([path[1], path[2]]);
    if (e) {
      return renderOg({
        eyebrow: `${getCollection(e.collection)?.title} · <${e.tag}>`,
        title: e.title,
        description: page?.data.description ?? e.description[0],
        motif: e.collection,
        footer: `shadcn add @lumesec/${e.tag}`,
      });
    }
  }
  return new Response("Not found", { status: 404 });
}

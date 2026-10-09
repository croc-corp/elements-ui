import { collections, elements } from "@/lib/catalog";
import { collectionMarkdown, componentMarkdown, docMarkdown, indexMarkdown } from "@/lib/llm";
import { componentsSource, docsSource } from "@/lib/source";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [
    { slug: ["docs"] },
    ...docsSource.getPages().map((p) => ({ slug: ["docs", ...p.slugs] })),
    { slug: ["components"] },
    ...collections.map((c) => ({ slug: ["components", c.slug] })),
    ...elements.map((e) => ({ slug: ["components", e.collection, e.slug] })),
  ];
}

const md = (text: string) => new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Robots-Tag": "noindex" } });

/** The Markdown twin of every page (rewritten from /<path>.md). */
export async function GET(_req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await ctx.params;
  const [section, ...rest] = slug;
  if (section === "docs") {
    const page = docsSource.getPage(rest);
    if (page) return md(await docMarkdown(page));
  }
  if (section === "components") {
    if (rest.length === 0) return md(indexMarkdown());
    if (rest.length === 1) {
      const text = collectionMarkdown(rest[0]);
      if (text) return md(text);
    }
    const page = componentsSource.getPage(rest);
    if (page) return md(await componentMarkdown(page));
  }
  return new Response("Not found", { status: 404 });
}

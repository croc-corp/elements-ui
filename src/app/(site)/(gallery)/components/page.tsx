import type { Metadata } from "next";

import { SubNavStatic } from "@/components/docs/sub-nav-static";
import { ComponentsExplorer, type ExplorerCard } from "@/components/gallery/explorer";
import { collections, elementHref, elements, newest } from "@/lib/catalog";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd, ogImage } from "@/lib/seo";
import { countWord } from "@/lib/utils";

export const metadata: Metadata = {
  title: "All components",
  description: `Browse ${elements.length} interactive components across ${countWord(collections.length)} collections: controls, meters, charts and dot-matrix displays. Every preview runs live.`,
  alternates: { canonical: "/components", types: { "text/markdown": "/components.md" } },
  openGraph: { title: "All components", url: "/components", images: ogImage("/components", "All components") },
  twitter: { card: "summary_large_image", images: ogImage("/components", "All components") },
};

export default function ComponentsPage() {
  const fresh = new Set(newest(30).map((e) => e.tag));
  const cards: ExplorerCard[] = elements.map((e, order) => ({
    tag: e.tag,
    title: e.title,
    collection: e.collection,
    href: elementHref(e),
    stage: e.stage,
    stageClass: e.stageClass,
    layout: e.layout,
    order,
    added: e.added,
    group: e.group,
    isNew: fresh.has(e.tag),
    demo: e.data === "demo",
    keywords: [e.title, e.tag, e.group, ...e.attributes.map((a) => a.name), ...e.events.map((v) => v.name)].join(" ").toLowerCase(),
  }));
  const cols = collections.map((c) => ({ slug: c.slug, title: c.title, count: c.count, summary: c.summary }));

  return (
    <>
      <JsonLd
        data={[
          itemListJsonLd(
            "LumeSec Elements components",
            elements.map((e) => ({ name: e.title, path: elementHref(e) })),
          ),
          breadcrumbJsonLd([{ name: "Components", path: "/components" }]),
        ]}
      />
      <SubNavStatic />
      <div className="sl-page">
        <section className="sl-panel sl-open-top">
          <div className="px-4 pt-14 pb-12 sm:px-6 sm:pt-20">
            <p className="sl-eyebrow page-enter">
              <span className="text-foreground">Components</span>
              <span data-sep />
              <span className="tabular">{elements.length} live previews</span>
              <span data-sep />
              <span>MIT</span>
            </p>
            <h1 className="mt-6 text-[clamp(40px,7vw,88px)] leading-[0.95] font-medium tracking-[-0.05em] page-enter">
              Every component.
              <br />
              <span className="text-muted-foreground">Running, not pictured.</span>
            </h1>
            <p className="mt-6 max-w-[54ch] text-[17px] leading-[1.65] text-muted-foreground page-enter">
              Each card below is the real element, loaded when it scrolls into view. Click, drag and type in any of them, then open the page to install it.
            </p>
          </div>
        </section>
        <section className="sl-panel">
          <ComponentsExplorer cards={cards} collections={cols} />
        </section>
      </div>
    </>
  );
}

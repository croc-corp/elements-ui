import type { Metadata } from "next";
import Link from "next/link";

import { SubNavStatic } from "@/components/docs/sub-nav-static";
import { ArrowRightIcon, CollectionGlyph } from "@/components/icons";
import { ComponentPreview } from "@/components/preview/component-preview";
import { collections, signatureOf } from "@/lib/catalog";
import { itemListJsonLd, JsonLd, ogImage } from "@/lib/seo";
import { countWord, pad2 } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Collections",
  description: `${countWord(collections.length, true)} collections of interactive components: ${collections.map((c) => c.title).join(", ")}.`,
  alternates: { canonical: "/collections" },
  openGraph: { title: "Collections", url: "/collections", images: ogImage("/collections", "Collections") },
  twitter: { card: "summary_large_image", images: ogImage("/collections", "Collections") },
};

export default function CollectionsPage() {
  return (
    <>
      <JsonLd
        data={itemListJsonLd(
          "LumeSec Elements collections",
          collections.map((c) => ({ name: c.title, path: `/components/${c.slug}` })),
        )}
      />
      <SubNavStatic />
      <div className="sl-page">
        <section className="sl-panel sl-open-top">
          <div className="px-4 pt-14 pb-12 sm:px-8 sm:pt-20">
            <p className="sl-eyebrow page-enter">
              <span className="text-foreground">Collections</span>
              <span data-sep />
              <span className="tabular">{collections.length} families</span>
            </p>
            <h1 className="page-enter mt-6 text-[clamp(40px,7vw,88px)] leading-[0.95] font-medium tracking-[-0.05em]">
              {countWord(collections.length, true)} collections.
              <br />
              <span className="text-muted-foreground">One way of moving.</span>
            </h1>
            <p className="page-enter mt-6 max-w-[56ch] text-[17px] leading-[1.65] text-muted-foreground">
              Each collection came out of one design question, from a single slider state to a whole dashboard. They
              share an engine per family, a theming contract and the same rules for motion.
            </p>
          </div>
        </section>
        <section className="sl-panel">
          <div className="grid gap-px bg-border md:grid-cols-2">
            {collections.map((c, i) => {
              const sig = signatureOf(c.slug);
              return (
                <article key={c.slug} className="group/col flex flex-col bg-background">
                  {sig && (
                    <div className="border-b border-border">
                      <ComponentPreview
                        variant="hero"
                        tag={sig.tag}
                        html={sig.stage}
                        layout={sig.layout}
                        stageClass={sig.stageClass}
                        minHeight={340}
                      />
                    </div>
                  )}
                  <Link
                    href={`/components/${c.slug}`}
                    className="flex flex-1 flex-col p-6 transition-colors hover:bg-surface sm:p-8"
                  >
                    <p className="sl-eyebrow">
                      <span className="tabular text-foreground">{pad2(i + 1)}</span>
                      <span data-sep />
                      <span className="tabular">{c.count} components</span>
                      <span data-sep />
                      <span>{c.prefix}*</span>
                    </p>
                    <h2 className="mt-4 flex items-center gap-3 text-[30px] font-medium tracking-[-0.03em]">
                      <CollectionGlyph slug={c.slug} size={22} className="text-muted-foreground" />
                      {c.title}
                      <ArrowRightIcon
                        size={18}
                        className="ml-auto text-muted-foreground transition-all duration-300 ease-[var(--ease-expo)] group-hover/col:translate-x-1 group-hover/col:text-foreground"
                      />
                    </h2>
                    <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
                      {c.description}
                    </p>
                    <p className="mt-auto pt-6 font-mono text-[11.5px] text-muted-foreground">{c.groups.join(" · ")}</p>
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

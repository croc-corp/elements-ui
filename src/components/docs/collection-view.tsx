import Link from "next/link";

import { CodeBlock } from "@/components/code/code-block";
import { Breadcrumbs } from "@/components/docs/page-parts";
import { ArrowRightIcon, CollectionGlyph } from "@/components/icons";
import { ComponentCard } from "@/components/preview/component-card";
import { site } from "@/config/site";
import { type CollectionMeta, collections, elementHref, elementsIn } from "@/lib/catalog";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/lib/seo";
import { pad2 } from "@/lib/utils";

/** The anchor id of a group heading, e.g. `Charts and data` → `charts-and-data`. */
const groupId = (group: string) => group.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** A collection page: header, install commands and every component by group. */
export function CollectionView({ c }: { c: CollectionMeta }) {
  const items = elementsIn(c.slug);
  const index = collections.findIndex((x) => x.slug === c.slug);
  const prev = collections[index - 1];
  const next = collections[index + 1];

  return (
    <div>
      <JsonLd
        data={[
          itemListJsonLd(
            `${c.title} components`,
            items.map((e) => ({ name: e.title, path: elementHref(e) })),
          ),
          breadcrumbJsonLd([
            { name: "Components", path: "/components" },
            { name: c.title, path: `/components/${c.slug}` },
          ]),
        ]}
      />
      <header className="sl-rule px-5 pt-8 pb-10 sm:px-10">
        <Breadcrumbs items={[{ name: "Components", href: "/components" }, { name: c.title }]} />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end">
          <div className="page-enter">
            <p className="sl-eyebrow">
              <span className="tabular text-foreground">{pad2(index + 1)}</span>
              <span data-sep />
              <span>Collection</span>
              <span data-sep />
              <span className="tabular">{c.count} components</span>
            </p>
            <h1 className="mt-5 flex items-center gap-4 text-[clamp(40px,6vw,72px)] leading-[0.95] font-medium tracking-[-0.05em]">
              <CollectionGlyph slug={c.slug} size={40} className="shrink-0 text-muted-foreground" strokeWidth={1.1} />
              {c.title}
            </h1>
            <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.65] text-muted-foreground">{c.description}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {c.groups.map((g) => (
                <a
                  key={g}
                  href={`#${groupId(g)}`}
                  className="h-7 rounded-full border border-border px-3 text-[12.5px] leading-[26px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                >
                  {g}
                </a>
              ))}
            </div>
          </div>
          <div className="grid gap-3">
            <p className="font-mono text-[11px] text-muted-foreground">Every component in this collection</p>
            <CodeBlock
              code={`npx shadcn@latest add ${site.registry.namespace}/${c.slug}`}
              lang="bash"
              item={c.slug}
              event="copy_install"
            />
            {c.kind !== "react" && (
              <>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">Or as one module, for plain HTML</p>
                <CodeBlock
                  code={`<script type="module" src="${site.url}/cdn/${c.slug}.js"></script>`}
                  lang="html"
                  item={c.slug}
                />
              </>
            )}
          </div>
        </div>
      </header>

      {c.groups.map((g) => {
        const list = items.filter((e) => e.group === g);
        const wide = list.filter((e) => e.layout === "wide");
        const grid = list.filter((e) => e.layout !== "wide");
        const id = groupId(g);
        return (
          <section key={g} aria-labelledby={id}>
            <div className="sl-rule flex items-baseline justify-between px-5 pt-12 pb-5 sm:px-10">
              <h2 id={id} className="scroll-mt-32 text-[22px] font-medium tracking-[-0.02em]">
                {g}
              </h2>
              <span className="tabular font-mono text-[11.5px] text-muted-foreground">{list.length}</span>
            </div>
            {/* wide components (editors, tables, maps) get a full-width row, the rest share the grid */}
            {wide.map((e, i) => (
              <div key={e.tag} className="grid border-t border-border">
                <ComponentCard
                  index={i}
                  height={460}
                  zoom={0.8}
                  data={{
                    tag: e.tag,
                    title: e.title,
                    collection: e.collection,
                    href: elementHref(e),
                    stage: e.stage,
                    stageClass: e.stageClass,
                    layout: "fill",
                    demo: e.data === "demo",
                  }}
                />
              </div>
            ))}
            {grid.length > 0 && (
              <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 2xl:grid-cols-3">
                {grid.map((e, i) => (
                  <ComponentCard
                    key={e.tag}
                    index={i}
                    data={{
                      tag: e.tag,
                      title: e.title,
                      collection: e.collection,
                      href: elementHref(e),
                      stage: e.stage,
                      stageClass: e.stageClass,
                      layout: e.layout,
                      demo: e.data === "demo",
                    }}
                  />
                ))}
                {/* fill the last row so the hairline grid stays closed */}
                {grid.length % 2 === 1 && <div className="hidden bg-background sm:block 2xl:hidden" aria-hidden />}
                {Array.from({ length: (3 - (grid.length % 3)) % 3 }, (_, i) => (
                  <div key={i} className="hidden bg-background 2xl:block" aria-hidden />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <nav aria-label="Other collections" className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
        {[prev, next].map((x, i) =>
          x ? (
            <Link
              key={x.slug}
              href={`/components/${x.slug}`}
              className={`group/c flex flex-col gap-1 bg-background p-8 transition-colors hover:bg-surface ${i === 1 ? "sm:items-end sm:text-right" : ""}`}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {i === 0 ? "Previous collection" : "Next collection"}
              </span>
              <span className="flex items-center gap-2 text-[20px] font-medium tracking-tight">
                {x.title}
                <ArrowRightIcon size={16} className="transition-transform duration-300 group-hover/c:translate-x-1" />
              </span>
              <span className="text-[13.5px] text-muted-foreground">{x.summary}</span>
            </Link>
          ) : (
            <span key={i} className="hidden bg-background sm:block" />
          ),
        )}
      </nav>
    </div>
  );
}

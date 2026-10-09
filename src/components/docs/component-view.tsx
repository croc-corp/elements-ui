import { Feedback } from "@/components/docs/feedback";
import { PageActions } from "@/components/docs/page-actions";
import { Chip, PageHeader, PrevNext } from "@/components/docs/page-parts";
import { DocsRail } from "@/components/docs/rail";
import { CollectionGlyph } from "@/components/icons";
import { getMDXComponents } from "@/components/mdx";
import { site } from "@/config/site";
import { type CollectionMeta, type ElementMeta, elementHref, siblings } from "@/lib/catalog";
import { breadcrumbJsonLd, componentJsonLd, JsonLd } from "@/lib/seo";
import type { ComponentPage } from "@/lib/source";
import { absoluteUrl } from "@/config/site";

/** A component page: header, the MDX body, feedback and the neighbours in its collection. */
export function ComponentView({ e, col, page }: { e: ElementMeta; col: CollectionMeta; page: ComponentPage }) {
  const { collection, slug } = e;
  const MDX = page.data.body;
  const path = elementHref(e);
  const { prev, next } = siblings(e);
  const registryUrl = `${site.url}/r/${e.tag}.json`;

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_288px]">
      <JsonLd
        data={[
          componentJsonLd(e, path, col.title),
          breadcrumbJsonLd([
            { name: "Components", path: "/components" },
            { name: col.title, path: `/components/${collection}` },
            { name: e.title, path },
          ]),
        ]}
      />
      <article className="min-w-0 px-5 pt-8 pb-20 sm:px-10">
        <div className="mx-auto max-w-[840px]">
          <PageHeader
            crumbs={[
              { name: "Components", href: "/components" },
              { name: col.title, href: `/components/${collection}` },
              { name: e.title },
            ]}
            meta={
              <>
                <Chip>
                  <CollectionGlyph slug={collection} size={12} />
                  {e.kind === "react" ? `<${e.component} />` : `<${e.tag}>`}
                </Chip>
                <Chip mono={false}>{e.kind === "react" ? "React" : "Custom element"}</Chip>
                {e.group && <Chip mono={false}>{e.group}</Chip>}
                {e.formAssociated && <Chip mono={false}>Form control</Chip>}
              </>
            }
            title={e.title}
            description={page.data.description}
            actions={
              <PageActions url={absoluteUrl(path)} markdownPath={`${path}.md`} registryUrl={registryUrl} item={e.tag} />
            }
          />
          <div className="prose mt-8">
            <MDX components={getMDXComponents()} />
          </div>
          {/* the rail holds the feedback on wide screens */}
          <Feedback path={path} className="mt-12 border-t border-border pt-6 xl:hidden" />
          <PrevNext
            prev={prev ? { title: prev.title, href: elementHref(prev), meta: prev.tag } : null}
            next={next ? { title: next.title, href: elementHref(next), meta: next.tag } : null}
          />
        </div>
      </article>
      <DocsRail toc={page.data.toc} path={path} file={`content/components/${collection}/${slug}.mdx`} title={e.title} />
    </div>
  );
}

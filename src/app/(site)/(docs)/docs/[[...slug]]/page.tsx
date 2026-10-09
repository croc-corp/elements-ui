import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Feedback } from "@/components/docs/feedback";
import { PageActions } from "@/components/docs/page-actions";
import { PageHeader, PrevNext } from "@/components/docs/page-parts";
import { DocsRail } from "@/components/docs/rail";
import { getMDXComponents } from "@/components/mdx";
import { getNav } from "@/lib/nav";
import { articleJsonLd, breadcrumbJsonLd, JsonLd, ogImage } from "@/lib/seo";
import { docsSource } from "@/lib/source";
import { absoluteUrl } from "@/config/site";

type Params = { slug?: string[] };

export function generateStaticParams() {
  return docsSource.generateParams();
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = docsSource.getPage(slug);
  if (!page) return {};
  const url = page.url;
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: url, types: { "text/markdown": `${url}.md` } },
    openGraph: {
      type: "article",
      title: page.data.title,
      description: page.data.description,
      url,
      images: ogImage(url, page.data.title),
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: ogImage(url, page.data.title),
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = docsSource.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;

  // previous / next in sidebar order
  const flat = getNav().guides.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
  const i = flat.findIndex((p) => p.href === page.url);
  const prev = i > 0 ? flat[i - 1] : null;
  const next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
  const group = i >= 0 ? flat[i].group : "Guides";

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_288px]">
      <JsonLd
        data={[
          articleJsonLd({
            title: page.data.title,
            description: page.data.description,
            path: page.url,
            updated: page.data.updated,
          }),
          breadcrumbJsonLd([
            { name: "Docs", path: "/docs" },
            { name: page.data.title, path: page.url },
          ]),
        ]}
      />
      <article className="min-w-0 px-5 pt-8 pb-20 sm:px-10">
        <div className="mx-auto max-w-[760px]">
          <PageHeader
            crumbs={[{ name: "Docs", href: "/docs" }, { name: group }, { name: page.data.title }]}
            title={page.data.title}
            description={page.data.description}
            actions={<PageActions url={absoluteUrl(page.url)} markdownPath={`${page.url}.md`} />}
          />
          <div className="prose mt-8">
            <MDX components={getMDXComponents()} />
          </div>
          {/* the rail holds the feedback on wide screens */}
          <Feedback path={page.url} className="mt-12 border-t border-border pt-6 xl:hidden" />
          <PrevNext
            prev={prev ? { title: prev.title, href: prev.href, meta: prev.group } : null}
            next={next ? { title: next.title, href: next.href, meta: next.group } : null}
          />
        </div>
      </article>
      <DocsRail toc={page.data.toc} path={page.url} file={`content/docs/${page.path}`} title={page.data.title} />
    </div>
  );
}

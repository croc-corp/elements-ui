import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComponentView } from "@/components/docs/component-view";
import { elements, getCollection, getElementByPath } from "@/lib/catalog";
import { ogImage } from "@/lib/seo";
import { componentsSource } from "@/lib/source";

type Params = { collection: string; slug: string };

export function generateStaticParams() {
  return elements.map((e) => ({ collection: e.collection, slug: e.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { collection, slug } = await params;
  const e = getElementByPath(collection, slug);
  const page = componentsSource.getPage([collection, slug]);
  const col = getCollection(collection);
  if (!e || !page || !col) return {};
  const title = `${e.title} · ${col.title} component`;
  const url = `/components/${collection}/${slug}`;
  return {
    title,
    description: page.data.description,
    keywords: [
      e.title,
      e.tag,
      `${e.title} component`,
      `react ${e.title.toLowerCase()}`,
      `shadcn ${e.title.toLowerCase()}`,
      col.title,
      "web component",
    ],
    alternates: { canonical: url, types: { "text/markdown": `${url}.md` } },
    openGraph: {
      type: "article",
      title,
      description: page.data.description,
      url,
      modifiedTime: e.added,
      images: ogImage(url, title),
    },
    twitter: { card: "summary_large_image", title, description: page.data.description, images: ogImage(url, title) },
  };
}

export default async function ComponentPage({ params }: { params: Promise<Params> }) {
  const { collection, slug } = await params;
  const e = getElementByPath(collection, slug);
  const page = componentsSource.getPage([collection, slug]);
  const col = getCollection(collection);
  if (!e || !page || !col) notFound();
  return <ComponentView e={e} col={col} page={page} />;
}

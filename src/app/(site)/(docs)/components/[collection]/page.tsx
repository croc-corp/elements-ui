import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollectionView } from "@/components/docs/collection-view";
import { collections, getCollection } from "@/lib/catalog";
import { ogImage } from "@/lib/seo";

type Params = { collection: string };

export function generateStaticParams() {
  return collections.map((c) => ({ collection: c.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { collection } = await params;
  const c = getCollection(collection);
  if (!c) return {};
  const runsOn = c.kind === "react" ? "React components" : "components for React and plain HTML";
  return {
    title: `${c.title} components`,
    description: `${c.description} ${c.count} ${runsOn}, installable with the shadcn CLI.`,
    alternates: { canonical: `/components/${c.slug}`, types: { "text/markdown": `/components/${c.slug}.md` } },
    openGraph: { title: `${c.title} components`, description: c.summary, url: `/components/${c.slug}`, images: ogImage(`/components/${c.slug}`, c.title) },
    twitter: { card: "summary_large_image", images: ogImage(`/components/${c.slug}`, c.title) },
  };
}

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  const { collection } = await params;
  const c = getCollection(collection);
  if (!c) notFound();
  return <CollectionView c={c} />;
}

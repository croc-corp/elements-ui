import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ViewFrame } from "@/components/preview/view-frame";
import { elementHref, elements, getElement } from "@/lib/catalog";

export function generateStaticParams() {
  return elements.map((e) => ({ tag: e.tag }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  const e = getElement(tag);
  return {
    title: e ? `${e.title} preview` : "Preview",
    robots: { index: false, follow: true },
    alternates: e ? { canonical: elementHref(e) } : undefined,
  };
}

/** A component on its own, for screenshots, demos and testing at any size. */
export default async function ViewPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const e = getElement(tag);
  if (!e) notFound();
  return <ViewFrame e={e} />;
}

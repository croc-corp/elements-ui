import { SubNav } from "@/components/docs/sub-nav";
import { collections } from "@/lib/catalog";

/** The collection switcher on pages outside the docs layout. */
export function SubNavStatic() {
  return <SubNav collections={collections.map((c) => ({ slug: c.slug, title: c.title, count: c.count }))} />;
}

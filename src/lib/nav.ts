import { type CollectionMeta, collections, type ElementMeta, elementHref, elementsIn } from "@/lib/catalog";
import { docsSource } from "@/lib/source";

export type NavItem = { title: string; href: string; tag?: string; isNew?: boolean };
export type NavGroup = { title: string; items: NavItem[] };
export type NavCollection = { slug: string; title: string; href: string; count: number; groups: NavGroup[] };
export type Nav = { guides: NavGroup[]; collections: NavCollection[] };

/** Order and grouping of the guides in the sidebar. */
const GUIDE_GROUPS: { title: string; slugs: string[] }[] = [
  { title: "Get started", slugs: ["", "installation", "react", "html", "theming"] },
  { title: "Concepts", slugs: ["data", "accessibility", "motion", "registry", "ai"] },
  { title: "Project", slugs: ["changelog", "faq", "license"] },
];

const NEWEST = collections
  .map((c) => c.updated)
  .sort()
  .at(-1);

/** The sidebar: guides in their groups, then every collection with its components by group. */
export function getNav(): Nav {
  const guides = GUIDE_GROUPS.map((g) => ({
    title: g.title,
    items: g.slugs
      .map((s) => docsSource.getPage(s ? [s] : []))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ title: p.data.title, href: p.url })),
  })).filter((g) => g.items.length);

  return { guides, collections: collections.map((c) => navCollection(c, elementsIn(c.slug))) };
}

function navCollection(c: CollectionMeta, items: ElementMeta[]): NavCollection {
  const groups = c.groups.map((g) => ({
    title: g,
    items: items
      .filter((e) => e.group === g)
      .map((e) => ({ title: e.title, href: elementHref(e), tag: e.tag, isNew: e.added === NEWEST })),
  }));
  return { slug: c.slug, title: c.title, href: `/components/${c.slug}`, count: c.count, groups };
}

import type { MetadataRoute } from "next";

import { site } from "@/config/site";
import { collections, elementHref, elements } from "@/lib/catalog";
import { docsSource } from "@/lib/source";

/** Every indexable page; component pages carry the date they were added, guides their `updated` date. */
export default function sitemap(): MetadataRoute.Sitemap {
  const latest = collections.map((c) => c.updated).sort().at(-1);
  const u = (path: string) => `${site.url}${path}`;
  return [
    { url: u("/"), lastModified: latest, changeFrequency: "weekly", priority: 1 },
    { url: u("/components"), lastModified: latest, changeFrequency: "weekly", priority: 0.9 },
    { url: u("/collections"), lastModified: latest, changeFrequency: "monthly", priority: 0.7 },
    ...collections.map((c) => ({ url: u(`/components/${c.slug}`), lastModified: c.updated, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...elements.map((e) => ({ url: u(elementHref(e)), lastModified: e.added, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...docsSource.getPages().map((p) => ({
      url: u(p.url),
      lastModified: p.data.updated ?? latest,
      changeFrequency: "monthly" as const,
      priority: p.url === "/docs" ? 0.8 : 0.6,
    })),
  ];
}

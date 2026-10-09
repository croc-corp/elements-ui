import { absoluteUrl, site } from "@/config/site";
import type { ElementMeta } from "@/lib/catalog";

type Json = Record<string, unknown>;

/** Serialises JSON-LD into a script tag; `<` is escaped so no value can close the tag. */
export function JsonLd({ data }: { data: Json | Json[] }) {
  const graph = Array.isArray(data) ? { "@context": "https://schema.org", "@graph": data } : { "@context": "https://schema.org", ...data };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }} />;
}

/** The company behind the site. */
export const organizationJsonLd = (): Json => ({
  "@type": "Organization",
  "@id": `${site.company.url}/#organization`,
  name: site.company.name,
  url: site.company.url,
  email: site.company.email,
  logo: absoluteUrl("/icon.svg"),
  sameAs: [site.company.linkedin, site.company.github],
});

/** The site, with the components search as its search action. */
export const websiteJsonLd = (): Json => ({
  "@type": "WebSite",
  "@id": `${site.url}/#website`,
  name: site.name,
  url: site.url,
  inLanguage: "en",
  description: site.description,
  publisher: { "@id": `${site.company.url}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${site.url}/components?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
});

/** The breadcrumb trail of a page. */
export const breadcrumbJsonLd = (items: { name: string; path: string }[]): Json => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
});

/** A component page as source code, part of its collection. */
export const componentJsonLd = (e: ElementMeta, url: string, collectionTitle: string): Json => ({
  "@type": "SoftwareSourceCode",
  "@id": `${absoluteUrl(url)}#code`,
  name: `${e.title} (${e.tag})`,
  description: e.description[0] ?? `${e.title} component`,
  url: absoluteUrl(url),
  codeRepository: site.repo.url,
  programmingLanguage: ["TypeScript", "React", "HTML"],
  runtimePlatform: "Web browser",
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  dateModified: e.added,
  keywords: [e.tag, e.title, collectionTitle, "shadcn", "web component", "react component"].join(", "),
  isPartOf: { "@type": "CreativeWorkSeries", name: `${collectionTitle} · ${site.name}`, url: absoluteUrl(`/components/${e.collection}`) },
  author: { "@id": `${site.company.url}/#organization` },
  publisher: { "@id": `${site.company.url}/#organization` },
});

/** A guide. */
export const articleJsonLd = (p: { title: string; description?: string; path: string; updated?: string }): Json => ({
  "@type": "TechArticle",
  headline: p.title,
  description: p.description,
  url: absoluteUrl(p.path),
  inLanguage: "en",
  dateModified: p.updated,
  author: { "@id": `${site.company.url}/#organization` },
  publisher: { "@id": `${site.company.url}/#organization` },
  isPartOf: { "@id": `${site.url}/#website` },
});

/** A list of pages, such as the components of a collection. */
export const itemListJsonLd = (name: string, items: { name: string; path: string }[]): Json => ({
  "@type": "ItemList",
  name,
  numberOfItems: items.length,
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: absoluteUrl(it.path) })),
});

/** Questions and answers. */
export const faqJsonLd = (faqs: { q: string; a: string }[]): Json => ({
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** Open Graph image for a page, rendered by /og/[...path]. */
export function ogImage(path: string, alt: string) {
  const clean = path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "");
  return [{ url: `/og/${clean}.png`, width: 1200, height: 630, alt }];
}

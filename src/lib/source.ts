import { components, docs } from "fumadocs-mdx:collections/server";
import { type InferPageType, loader } from "fumadocs-core/source";

/** The guides in content/docs, served under /docs. */
export const docsSource = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/** The component pages in content/components, served under /components/{collection}/{slug}. */
export const componentsSource = loader({
  baseUrl: "/components",
  source: components.toFumadocsSource(),
});

export type DocPage = InferPageType<typeof docsSource>;
export type ComponentPage = InferPageType<typeof componentsSource>;

import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";
import { z } from "zod";

import { lumesecDark, lumesecLight } from "./src/lib/shiki-themes";

/** Guides: /docs/* */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema.extend({
      eyebrow: z.string().optional(),
      updated: z.string().optional(),
    }),
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

/** Component pages: /components/{collection}/{slug} */
export const components = defineDocs({
  dir: "content/components",
  docs: {
    schema: frontmatterSchema.extend({
      tag: z.string(),
      updated: z.string().optional(),
    }),
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: lumesecLight, dark: lumesecDark },
      icon: false,
      langs: ["tsx", "ts", "html", "bash", "css", "json", "js", "jsx", "vue", "svelte", "md"],
    },
    remarkNpmOptions: false,
  },
});

import "server-only";

import { createHighlighter, type Highlighter } from "shiki";

import { lumesecDark, lumesecLight } from "@/lib/shiki-themes";

// on globalThis, so the hot reloads of `next dev` share one highlighter
const cache = globalThis as typeof globalThis & { __elementsHighlighter?: Promise<Highlighter> };

function highlighter() {
  cache.__elementsHighlighter ??= createHighlighter({
    themes: [lumesecLight, lumesecDark],
    langs: ["tsx", "ts", "html", "bash", "css", "json", "js", "jsx", "vue", "svelte", "md"],
  });
  return cache.__elementsHighlighter;
}

const results = new Map<string, string>();

/** Dual-theme HTML (switches with [data-theme]) for a code string. Results are memoised per process. */
export async function highlight(code: string, lang = "tsx") {
  const key = `${lang}\u0000${code}`;
  const hit = results.get(key);
  if (hit) return hit;
  const hl = await highlighter();
  const html = hl.codeToHtml(code, { lang, themes: { light: "lumesec-light", dark: "lumesec-dark" }, defaultColor: false });
  if (results.size > 2000) results.clear();
  results.set(key, html);
  return html;
}

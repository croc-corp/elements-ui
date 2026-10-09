import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { elements } from "@/lib/catalog";
import { highlight } from "@/lib/highlight";
import { registryFiles } from "@/lib/registry-files";

export const dynamic = "force-static";

/** Every file a manual install lists; nothing else in the repository is served. */
const allowed = () => new Set(elements.flatMap((e) => registryFiles(e).map((f) => f.source)));

export function generateStaticParams() {
  return [...allowed()].map((p) => ({ path: p.split("/") }));
}

/** Highlighted source of one registry file, for the Manual install tab. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const rel = path.join("/");
  if (!allowed().has(rel)) return new Response("Not found", { status: 404 });
  // static "registry" prefix keeps file tracing to that folder
  const code = await readFile(join(process.cwd(), "registry", ...path.slice(1)), "utf8");
  const html = await highlight(code.replace(/\n+$/, ""), rel.endsWith(".tsx") ? "tsx" : "ts");
  return Response.json({ code, html, lines: code.split("\n").length }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";

import { clientOf, recordEvent } from "@/lib/server/events";

const NAME = /^[a-z0-9][a-z0-9-]*\.json$/;

/** Whether an If-None-Match header lists `etag` (weak comparison, as for GET requests). */
function matchesEtag(header: string | null, etag: string) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((value) => value.trim().replace(/^W\//, "") === etag);
}

/**
 * shadcn registry items, built by `pnpm registry:build` into .registry/r. Served through a route rather than
 * /public so installs can be counted. Responses carry an ETag and must be revalidated, so a release is visible
 * at once and an unchanged item costs a 304.
 */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!NAME.test(name)) return Response.json({ error: "Not found" }, { status: 404 });
  const item = name.replace(/\.json$/, "");

  let body: string;
  try {
    body = await readFile(join(process.cwd(), ".registry/r", name), "utf8");
  } catch {
    return Response.json({ error: `Item ${item} is not in the LumeSec Elements registry.` }, { status: 404 });
  }

  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 16)}"`;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    // revalidated on every request: each CLI install reaches the route and is counted, and the index and
    // items never lag behind a release
    "Cache-Control": "public, no-cache",
    ETag: etag,
  };

  // a copy: the request object is gone once the response is sent
  const request = new Headers(req.headers);
  after(() =>
    recordEvent({
      type: "registry_download",
      item,
      path: `/r/${name}`,
      headers: request,
      device: clientOf(request.get("user-agent")),
    }),
  );

  if (matchesEtag(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

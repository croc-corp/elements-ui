export const dynamic = "force-dynamic";

/** Container healthcheck: the server answers. The optional statistics database is not required. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

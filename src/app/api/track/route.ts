import { after } from "next/server";

import { clientIp } from "@/lib/server/client-ip";
import { recordEvent } from "@/lib/server/events";
import { readJsonObject } from "@/lib/server/request";
import { withinLimit } from "@/lib/server/throttle";

const MAX_BODY = 4000;

/**
 * Receives one anonymous event from the browser (see `src/lib/track.ts`). The answer never depends on whether
 * the event was stored: the client does not retry, so throttled and unknown events are dropped quietly.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (ip && !withinLimit(`track:${ip}`, 300, 10 * 60 * 1000)) return new Response(null, { status: 204 });
  const body = await readJsonObject(req, MAX_BODY);
  const type = body?.type;
  if (!body || typeof type !== "string") return new Response(null, { status: 400 });
  const { item, path, ref, meta } = body;
  // a copy: the request object is gone once the response is sent
  const headers = new Headers(req.headers);
  after(() => recordEvent({ type, item, path, ref, meta, headers }));
  return new Response(null, { status: 204 });
}

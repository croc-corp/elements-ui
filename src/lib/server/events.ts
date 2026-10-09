import "server-only";

import { getSql } from "@/lib/server/db";
import { TRACK_TYPES } from "@/lib/track";

const BOT =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|monitor|curl|wget|python|httpclient/i;

/** Event types the site stores: the browser events plus registry downloads, which the server records. */
const EVENT_TYPES = new Set<string>([...TRACK_TYPES, "registry_download"]);

/** A device class from the user agent; the user agent itself is never stored. */
function deviceOf(userAgent: string | null) {
  if (!userAgent) return "unknown";
  if (BOT.test(userAgent)) return "bot";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobi|android|iphone/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** The shadcn CLI and other tools fetch registry items; count them as a separate client. */
export function clientOf(userAgent: string | null) {
  if (!userAgent) return "unknown";
  if (/shadcn/i.test(userAgent)) return "shadcn";
  if (/node|undici/i.test(userAgent)) return "node";
  return deviceOf(userAgent);
}

/** A non-empty string cut to `max` characters, or null. */
const clip = (value: unknown, max: number) => (typeof value === "string" && value.length ? value.slice(0, max) : null);

type Scalar = string | number | boolean | null;

const isScalar = (value: unknown): value is Scalar =>
  value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** At most eight short keys with scalar values; strings are clipped and anything else is dropped. */
function cleanMeta(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const entries: [string, Scalar][] = [];
  const given: [string, unknown][] = Object.entries(meta).slice(0, 8);
  for (const [key, value] of given) {
    if (isScalar(value)) entries.push([key.slice(0, 32), typeof value === "string" ? value.slice(0, 120) : value]);
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

/** One event as received; everything but `type` and `headers` is untrusted input and cleaned before storing. */
export type EventInput = {
  type: string;
  item?: unknown;
  path?: unknown;
  ref?: unknown;
  meta?: unknown;
  /** The request headers, for the device class and the country set by the edge. */
  headers: Headers;
  /** Overrides the device class derived from the user agent. */
  device?: string;
};

/** Stores one anonymous event when statistics are enabled (`DATABASE_URL`); otherwise does nothing. */
export async function recordEvent(input: EventInput) {
  if (!EVENT_TYPES.has(input.type)) return;
  const device = input.device ?? deviceOf(input.headers.get("user-agent"));
  if (device === "bot") return;
  try {
    const sql = await getSql();
    if (!sql) return;
    const meta = cleanMeta(input.meta);
    const country = clip(input.headers.get("x-vercel-ip-country") ?? input.headers.get("cf-ipcountry"), 2);
    await sql`
      insert into event (type, item, path, ref, country, device, meta)
      values (
        ${input.type},
        ${clip(input.item, 120)},
        ${clip(input.path, 300)},
        ${clip(input.ref, 120)},
        ${country},
        ${device},
        ${meta ? sql.json(meta) : null}
      )`;
  } catch (err) {
    console.error("[events] insert failed", err);
  }
}

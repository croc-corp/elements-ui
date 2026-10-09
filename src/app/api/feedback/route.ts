import { randomBytes } from "node:crypto";

import { clientIp } from "@/lib/server/client-ip";
import { getSql } from "@/lib/server/db";
import { readJsonObject } from "@/lib/server/request";
import { withinLimit } from "@/lib/server/throttle";

const MAX_BODY = 4000;
const MAX_NOTE = 1000;
/** How long after the vote its note may still be added. */
const NOTE_WINDOW = "1 hour";
/** 128 random bits, base64url: what POST hands out and PATCH accepts. */
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

const cleanNote = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_NOTE) : null);

/** A path on this site, never a full URL. */
const isSitePath = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

const isToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);

/** True when the client has used up its requests; clients without a known address are not limited. */
function limited(req: Request) {
  const ip = clientIp(req.headers);
  return ip !== null && !withinLimit(`feedback:${ip}`, 30, 10 * 60 * 1000);
}

/**
 * Records a vote ("Was this page helpful?"), optionally with a note. Returns a random token that lets the same
 * browser add a note afterwards; ids are never exposed, so nobody can attach notes to other votes. Without a
 * statistics database the vote is accepted and discarded (`token: null`).
 */
export async function POST(req: Request) {
  if (limited(req)) return new Response(null, { status: 429 });
  const body = await readJsonObject(req, MAX_BODY);
  const path = body?.path;
  const helpful = body?.helpful;
  if (!isSitePath(path) || typeof helpful !== "boolean") return new Response(null, { status: 400 });
  try {
    const sql = await getSql();
    if (!sql) return Response.json({ token: null });
    const token = randomBytes(16).toString("base64url");
    await sql`
      insert into feedback (path, helpful, note, token)
      values (${path.slice(0, 300)}, ${helpful}, ${cleanNote(body?.note)}, ${token})`;
    return Response.json({ token });
  } catch (err) {
    console.error("[feedback] insert failed", err);
    return new Response(null, { status: 500 });
  }
}

/** Adds a note to a recent vote that has none yet, so a vote is never counted twice or overwritten. */
export async function PATCH(req: Request) {
  if (limited(req)) return new Response(null, { status: 429 });
  const body = await readJsonObject(req, MAX_BODY);
  const token = body?.token;
  const note = cleanNote(body?.note);
  if (!isToken(token) || !note) return new Response(null, { status: 400 });
  try {
    const sql = await getSql();
    if (sql) {
      await sql`
        update feedback set note = ${note}
        where token = ${token} and note is null and created_at >= now() - ${NOTE_WINDOW}::interval`;
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[feedback] note failed", err);
    return new Response(null, { status: 500 });
  }
}

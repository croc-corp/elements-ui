import "server-only";

import postgres from "postgres";

/** A postgres.js client. */
export type Sql = postgres.Sql;

/**
 * The statistics tables. Created on first use and safe to run again, so a fresh database needs no setup.
 * `event` holds anonymous events: no IP address, no user agent string, no cookie or device identifier.
 * `feedback` holds the answers to "Was this page helpful?", with an optional note. `token` is a random value
 * returned to the browser that voted, so only that browser can add the note.
 */
const SCHEMA = `
create table if not exists event (
  id bigint primary key generated always as identity,
  type text not null,
  item text,
  path text,
  ref text,
  country text,
  device text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists event_type_time_idx on event (type, created_at);
create index if not exists event_item_idx on event (item);
create index if not exists event_time_idx on event (created_at);

create table if not exists feedback (
  id bigint primary key generated always as identity,
  path text not null,
  helpful boolean not null,
  note text,
  created_at timestamptz not null default now()
);
alter table feedback add column if not exists token text;
create index if not exists feedback_path_idx on feedback (path);
create unique index if not exists feedback_token_idx on feedback (token);
`;

// on globalThis, so the hot reloads of `next dev` share one pool
const cache = globalThis as typeof globalThis & { __elementsSql?: Promise<Sql> };

async function connect(url: string): Promise<Sql> {
  const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 5, prepare: false, onnotice: () => {} });
  await sql.unsafe(SCHEMA);
  return sql;
}

/**
 * The statistics database, or null when `DATABASE_URL` is not set. Statistics are optional: without a
 * database, events and feedback are accepted and discarded. A failed connection is retried on the next call.
 */
export async function getSql(): Promise<Sql | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  cache.__elementsSql ??= connect(url).catch((err: unknown) => {
    cache.__elementsSql = undefined;
    throw err;
  });
  return cache.__elementsSql;
}

#!/usr/bin/env node
// Prints the site statistics from the database in DATABASE_URL: page views, registry installs, copies,
// top components, referrers, searches and "Was this page helpful?" answers with their notes.
//
//   pnpm stats            the last 30 days, compared with the 30 days before
//   pnpm stats 7          the last 7 days
//
// DATABASE_URL comes from the environment, else from .env.local or .env (the files Next.js reads).
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";

/** DATABASE_URL from the environment or the first env file that sets it. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const url = parseEnv(text).DATABASE_URL;
    if (url) return url;
  }
  return undefined;
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set. Statistics are only recorded when the site runs with a database.");
  process.exit(1);
}

const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 3650) {
  console.error(`Usage: pnpm stats [days]   days is a whole number from 1 to 3650 (got "${process.argv[2]}")`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });

// fragments, reused by the queries below: the start of the period and of the period before it
const since = sql`now() - make_interval(days => ${days})`;
const before = sql`now() - make_interval(days => ${2 * days})`;

/** Whether the site has created its tables, which it does when it records the first event. */
async function tablesExist() {
  const [row] = await sql`select to_regclass('event') is not null and to_regclass('feedback') is not null as ready`;
  return row.ready;
}

/** Events of the given types in this period and in the one before. */
async function totals(types) {
  const [row] = await sql`
    select
      count(*) filter (where created_at >= ${since})::int as current,
      count(*) filter (where created_at < ${since})::int as previous
    from event
    where type in ${sql(types)} and created_at >= ${before}`;
  return row;
}

/** The most frequent values of one column for one event type in this period. */
function top(column, type, { limit = 10, where = sql`` } = {}) {
  return sql`
    select ${sql(column)} as value, count(*)::int as count
    from event
    where type = ${type} and created_at >= ${since} and ${sql(column)} is not null ${where}
    group by 1
    order by 2 desc, 1
    limit ${limit}`;
}

function change({ current, previous }) {
  if (!previous) return current ? "new" : "-";
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

const LISTS = [
  ["Most installed items", "item", "registry_download", { where: sql`and item not like 'lumesec-%'` }],
  ["Most viewed components", "path", "page_view", { where: sql`and path like '/components/%/%'` }],
  ["Most viewed pages", "path", "page_view"],
  ["Referrers", "ref", "page_view"],
  ["Countries", "country", "page_view"],
  ["Devices", "device", "page_view", { limit: 4 }],
  ["Install clients", "device", "registry_download", { limit: 4 }],
  ["Searches", "item", "search"],
];

/** Prints every table for the period. */
async function printStatistics() {
  const [views, installs, copies] = await Promise.all([
    totals(["page_view"]),
    totals(["registry_download"]),
    totals(["copy_install", "copy_code", "copy_page"]),
  ]);
  console.log(`Last ${days} days, compared with the ${days} days before`);
  console.table({
    "Page views": { total: views.current, change: change(views) },
    "Registry installs": { total: installs.current, change: change(installs) },
    "Copies (install, code, page)": { total: copies.current, change: change(copies) },
  });

  const lists = await Promise.all(LISTS.map(([, column, type, options]) => top(column, type, options)));
  LISTS.forEach(([title], i) => {
    console.log(`\n${title}`);
    if (lists[i].length) console.table(lists[i].map((row) => ({ [title]: row.value, count: row.count })));
    else console.log("  none");
  });

  const [votes] = await sql`
    select count(*) filter (where helpful)::int as yes, count(*) filter (where not helpful)::int as no
    from feedback
    where created_at >= ${since}`;
  console.log(`\nWas this page helpful? ${votes.yes} yes, ${votes.no} no`);
  const notes = await sql`
    select created_at, path, helpful, note
    from feedback
    where created_at >= ${since} and note is not null
    order by created_at desc
    limit 25`;
  if (notes.length) {
    console.table(
      notes.map((n) => ({
        date: n.created_at.toISOString().slice(0, 10),
        page: n.path,
        helpful: n.helpful ? "yes" : "no",
        note: n.note,
      })),
    );
  } else {
    console.log("  no notes");
  }
}

try {
  if (await tablesExist()) {
    await printStatistics();
  } else {
    console.error("The statistics tables do not exist yet. The site creates them when it records its first event.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Could not read the statistics: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

#!/usr/bin/env node
// Prints the release notes of one version: its section of content/docs/changelog.mdx, without the heading.
// The release workflow uses it for the GitHub release, and fails when a version has no section yet.
//
//   node scripts/release-notes.mjs            the version in package.json
//   node scripts/release-notes.mjs 0.4.0      a given version
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readJson, ROOT } from "./lib/catalog.mjs";

const version = process.argv[2] ?? readJson(join(ROOT, "package.json")).version;
const changelog = readFileSync(join(ROOT, "content/docs/changelog.mdx"), "utf8");

// a release heading is "## 0.4.0 · 2026-10-10"
const escaped = version.replace(/\./g, "\\.");
const heading = new RegExp(`^## ${escaped} · (\\d{4}-\\d{2}-\\d{2})\\s*$`, "m");
const match = heading.exec(changelog);
if (!match) {
  console.error(`content/docs/changelog.mdx has no section "## ${version} · YYYY-MM-DD". Add it before releasing.`);
  process.exit(1);
}

const start = match.index + match[0].length;
const next = changelog.slice(start).search(/^## /m);
const body = (next === -1 ? changelog.slice(start) : changelog.slice(start, start + next)).trim();
if (!body) {
  console.error(`The changelog section for ${version} is empty.`);
  process.exit(1);
}

const docs = "https://elements.lumesec.ai/docs/changelog";
process.stdout.write(`${body}\n\nReleased ${match[1]}. Full changelog: ${docs}\n`);

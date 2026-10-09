// Runs the command-line tool of an installed package with the current Node.js binary. No shell and no
// node_modules/.bin shims (.cmd files on Windows), so arguments are passed as they are on every platform.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

import { readJson, ROOT } from "./catalog.mjs";

/** The JavaScript entry of a package's command, e.g. typescript's `tsc` → node_modules/typescript/bin/tsc. */
function binEntry(pkg, command) {
  const manifest = join(ROOT, "node_modules", pkg, "package.json");
  const { bin } = readJson(manifest);
  const entry = typeof bin === "string" ? bin : bin?.[command];
  if (!entry) throw new Error(`${pkg} has no "${command}" command`);
  return join(dirname(manifest), entry);
}

/** `execFileSync` for a package's command: `execBin("typescript", "tsc", ["--noEmit"])`. */
export function execBin(pkg, command, args, options = {}) {
  return execFileSync(process.execPath, [binEntry(pkg, command), ...args], { cwd: ROOT, ...options });
}

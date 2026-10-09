#!/usr/bin/env node
// Checks that keep the registry honest. Run after `pnpm catalog`.
//   1. the registry sources contain no type escape hatches
//   2. every custom element module imports on the server without touching the DOM
//   3. every native React demo renders on the server (no window/document during render)
//   4. the site type-checks (strict), registry included
//   5. every React usage snippet shown in the docs type-checks
//   6. the registry passes the ESLint config of a stock create-next-app project
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { execBin } from "./lib/bin.mjs";
import { readJson, ROOT } from "./lib/catalog.mjs";

const TMP = join(ROOT, ".data/verify");
const meta = readJson(join(ROOT, "src/generated/elements.json"));
const alias = {
  "@/components/lumesec": join(ROOT, "registry/components/lumesec"),
  "@/lib/lumesec": join(ROOT, "registry/lib/lumesec"),
  "@/examples": join(ROOT, "registry/examples"),
  "@/lib/utils": join(ROOT, "src/lib/utils.ts"),
};
let failed = 0;

/** What a failed check printed: a command's own output (tsc and ESLint report on stdout), else the error. */
function failureOutput(error) {
  const output = [error?.stdout, error?.stderr]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const text = output || String(error?.message ?? error);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text;
}

async function step(name, check) {
  process.stdout.write(`• ${name} … `);
  try {
    const note = await check();
    console.log(`ok${note ? ` (${note})` : ""}`);
  } catch (error) {
    failed++;
    console.log("FAILED");
    console.error(failureOutput(error));
  }
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const elementTags = meta.filter((m) => m.kind === "element").map((m) => m.tag);
const reactTags = meta.filter((m) => m.kind === "react").map((m) => m.tag);

await step("no type escape hatches in the registry", async () => {
  const offenders = [];
  for (const dir of ["registry/components/lumesec", "registry/lib/lumesec", "registry/examples"]) {
    for (const file of readdirSync(join(ROOT, dir))) {
      if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue;
      const lines = readFileSync(join(ROOT, dir, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        // comments may mention `any`; code may not
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        // mixins need `any[]` constructor arguments (TS2545); the engines document that one use
        const isMixinConstructor = /new \(\.\.\.args: any\[\]\)/.test(code);
        const usesAny = /\bas any\b|:\s*any\b|<any>|any\[\]/.test(code) && !isMixinConstructor;
        if (usesAny || /@ts-(ignore|nocheck|expect-error)/.test(line))
          offenders.push(`${dir}/${file}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  if (offenders.length) throw new Error(offenders.join("\n"));
  return "clean";
});

await step("server import of every custom element", async () => {
  await build({
    stdin: {
      contents: elementTags.map((t) => `import "@/components/lumesec/${t}.element";`).join("\n"),
      resolveDir: ROOT,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: join(TMP, "ssr.mjs"),
    logLevel: "silent",
    alias,
  });
  await import(pathToFileURL(join(TMP, "ssr.mjs")).href);
  return `${elementTags.length} modules`;
});

await step("server render of every React demo", async () => {
  if (!reactTags.length) return "none yet";
  const entry = [
    `import { createElement } from "react";`,
    `import { renderToString } from "react-dom/server";`,
    ...reactTags.map((t, i) => `import Demo${i} from "@/examples/${t}-demo";`),
    `export const demos = { ${reactTags.map((t, i) => `${JSON.stringify(t)}: Demo${i}`).join(", ")} };`,
    `export const render = (Demo) => renderToString(createElement(Demo));`,
  ].join("\n");
  await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" },
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    outfile: join(TMP, "react-ssr.mjs"),
    logLevel: "silent",
    external: ["react", "react-dom", "react/jsx-runtime", "clsx", "tailwind-merge"],
    alias,
  });
  const { demos, render } = await import(pathToFileURL(join(TMP, "react-ssr.mjs")).href);
  const errors = [];
  for (const [tag, Demo] of Object.entries(demos)) {
    try {
      if (!render(Demo)) errors.push(`${tag}: rendered nothing`);
    } catch (error) {
      errors.push(`${tag}: ${error?.message ?? error}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return `${reactTags.length} demos`;
});

await step("site type-check", async () => {
  execBin("typescript", "tsc", ["--noEmit", "-p", "tsconfig.json"], { stdio: "pipe" });
});

await step("usage snippets type-check", async () => {
  const dir = join(TMP, "usage");
  mkdirSync(dir, { recursive: true });
  const snippets = meta.filter((m) => m.usage?.react);
  for (const m of snippets) {
    const suffix = m.tag.replace(/-/g, "_");
    const text = m.usage.react.replace(
      /export (default )?function (\w+)/,
      (_, isDefault, name) => `export ${isDefault ?? ""}function ${name}_${suffix}`,
    );
    writeFileSync(join(dir, `${m.tag}.tsx`), text);
  }
  // `exclude` is reset: the root config excludes .data, which is where these files are written
  const tsconfig = {
    extends: "../../../tsconfig.json",
    compilerOptions: { noEmit: true, incremental: false },
    include: ["./*.tsx"],
    exclude: [],
  };
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
  execBin("typescript", "tsc", ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" });
  const missing = meta.length - snippets.length;
  return `${snippets.length} snippets${missing ? `, ${missing} components without a snippet` : ""}`;
});

await step("registry lint with the stock create-next-app config", async () => {
  const args = [
    "--config",
    "scripts/lib/eslint.registry.mjs",
    "--max-warnings",
    "0",
    "--no-warn-ignored",
    "registry/components/lumesec",
    "registry/lib/lumesec",
  ];
  execBin("eslint", "eslint", args, { stdio: "pipe" });
  return "clean";
});

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");

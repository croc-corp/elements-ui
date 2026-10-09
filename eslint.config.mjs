// ESLint for the site (src/). The registry is linted separately against a stock create-next-app config
// (scripts/lib/eslint.registry.mjs, run by `pnpm verify`).
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".source/**",
    ".registry/**",
    ".data/**",
    ".local/**",
    ".claude/**",
    "public/**",
    "registry/**",
    "src/generated/**",
    "next-env.d.ts",
  ]),
]);

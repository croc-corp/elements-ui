// The ESLint config of a stock `create-next-app` project. The registry sources must pass it with no
// warnings: users install them into such a project, and its lint (and their CI) runs over them.
import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // looks for a pages/ directory, which an App Router project (and this check) does not have
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
]);

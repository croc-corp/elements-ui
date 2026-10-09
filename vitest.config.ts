import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dir = (relative: string) => fileURLToPath(new URL(relative, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    // the paths of tsconfig.json, most specific first
    alias: [
      // `server-only` throws unless it is imported from a React Server Component bundle, which tests are not
      { find: /^server-only$/, replacement: dir("./tests/support/empty.ts") },
      { find: /^@\/components\/lumesec\//, replacement: dir("./registry/components/lumesec/") },
      { find: /^@\/lib\/lumesec\//, replacement: dir("./registry/lib/lumesec/") },
      { find: /^@\/examples\//, replacement: dir("./registry/examples/") },
      { find: /^@\//, replacement: dir("./src/") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
  },
});

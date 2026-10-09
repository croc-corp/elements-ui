/**
 * Prettier for code, JSON, CSS and YAML. Tailwind classes are sorted in `className` and in `cn()` calls.
 * Markdown and MDX are written by hand and keep their own wrapping (see .prettierignore).
 * @type {import("prettier").Config & import("prettier-plugin-tailwindcss").PluginOptions}
 */
const config = {
  printWidth: 120,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/app/globals.css",
  tailwindFunctions: ["cn"],
};

export default config;

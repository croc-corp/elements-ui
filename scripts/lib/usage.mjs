// Turns a gallery demo's markup into usage snippets: idiomatic React (typed wrappers)
// and plain HTML.
import { NodeType, parse } from "node-html-parser";

import { camel, SITE_URL } from "./catalog.mjs";

/** Inline SVG artwork (logos) becomes a one-line placeholder in snippets. */
const stripArt = (html) => html.replace(/<svg\b[^>]*\bslot="([^"]+)"[\s\S]*?<\/svg>/g, '<span slot="$1">Your logo</span>').replace(/…lockup…/g, "Your logo");

/** `margin-top: 16px; --gap: 4px` → `{{ marginTop: 16, "--gap": "4px" }}`. */
function styleObject(css) {
  const parts = css
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.includes(":"))
    .map((declaration) => {
      const i = declaration.indexOf(":");
      const property = declaration.slice(0, i).trim();
      const value = declaration.slice(i + 1).trim();
      // custom properties keep their name; React sets them as they are
      if (property.startsWith("--")) return `${JSON.stringify(property)}: ${JSON.stringify(value)}`;
      const pixels = value.match(/^(-?\d+(?:\.\d+)?)px$/);
      return `${camel(property)}: ${pixels ? pixels[1] : JSON.stringify(value)}`;
    });
  return `{{ ${parts.join(", ")} }}`;
}

function jsxAttr(name, value, meta) {
  if (name === "class") return `className=${JSON.stringify(value)}`;
  if (name === "style") return `style=${styleObject(value)}`;
  if (name === "for") return `htmlFor=${JSON.stringify(value)}`;
  if (!meta) return value === "" ? name : `${name}=${JSON.stringify(value)}`;
  const a = meta.attributes.find((x) => x.name === name);
  // undocumented attributes do nothing; leave them out of the typed React example
  if (!a && !/^(aria|data)-/.test(name) && name !== "slot") return null;
  const prop = a?.prop ?? camel(name);
  if (a?.type === "boolean" || (value === "" && !a)) return prop;
  if (a?.type === "number" && /^-?\d+(\.\d+)?$/.test(value)) return `${prop}={${value}}`;
  if (a?.type === "json") return `${prop}={${value}}`;
  return `${prop}=${JSON.stringify(value)}`;
}

function toJsx(node, depth, byTag, used) {
  const pad = "  ".repeat(depth);
  if (node.nodeType === NodeType.TEXT_NODE) {
    const raw = node.rawText;
    // multi-line text (a diff, a log) keeps its line breaks as a template literal
    if (/\n\s*\S[\s\S]*\n/.test(raw)) {
      const body = raw.replace(/^\n+|\s+$/g, "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
      return `${pad}{\`${body}\`}`;
    }
    const t = raw.replace(/\s+/g, " ").trim();
    return t ? `${pad}${t.replace(/[{}]/g, (c) => `{"${c}"}`)}` : "";
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const tag = node.rawTagName.toLowerCase();
  const meta = byTag.get(tag);
  const name = meta ? meta.component : tag;
  if (meta) used.add(meta);
  const attrs = Object.entries(node.attributes)
    .filter(([k]) => k !== "id")
    .map(([k, v]) => jsxAttr(k, v, meta))
    .filter(Boolean);
  const open = `<${name}${attrs.length ? " " + attrs.join(" ") : ""}`;
  const kids = node.childNodes.map((c) => toJsx(c, depth + 1, byTag, used)).filter(Boolean);
  if (!kids.length) return `${pad}${open} />`;
  if (kids.length === 1 && !kids[0].includes("\n") && kids[0].trim().length < 48) return `${pad}${open}>${kids[0].trim()}</${name}>`;
  return `${pad}${open}>\n${kids.join("\n")}\n${pad}</${name}>`;
}

/** Drop demo-only layout wrappers and keep the components (and forms) themselves. */
function usageNodes(root, byTag) {
  const out = [];
  const visit = (n) => {
    if (n.nodeType !== NodeType.ELEMENT_NODE) return;
    const tag = n.rawTagName?.toLowerCase();
    if (tag && (byTag.has(tag) || tag === "form")) out.push(n);
    else n.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return out;
}

export function usageFor(meta, byTag) {
  const source = stripArt(meta.markup || meta.stage);
  const root = parse(source, { comment: false });
  const nodes = usageNodes(root, byTag);
  const used = new Set();
  const list = nodes.length ? nodes : root.childNodes;
  const single = list.filter((n) => n.nodeType === NodeType.ELEMENT_NODE).length === 1;
  const body = list.map((n) => toJsx(n, single ? 2 : 3, byTag, used)).filter(Boolean).join("\n");
  const comps = [...used];
  if (!comps.length) comps.push(meta);
  const tags = comps.map((c) => c.tag);
  const imports = comps.map((c) => `import { ${c.component} } from "@/components/lumesec/${c.tag}";`).join("\n");
  const jsx = single ? body : `    <>\n${body}\n    </>`;
  const react = `${imports}\n\nexport function Example() {\n  return (\n${jsx}\n  );\n}\n`;

  const markup = meta.markup
    ? stripArt(meta.markup).trim()
    : list
        .map((n) => {
          if (n.nodeType !== NodeType.ELEMENT_NODE) return n.rawText.trim();
          n.removeAttribute("id");
          return n.outerHTML.trim();
        })
        .filter(Boolean)
        .join("\n");
  const scripts = tags.map((t) => `<script type="module" src="${SITE_URL}/cdn/${t}.js"></script>`).join("\n");
  return { react, html: `${scripts}\n\n${markup}\n`, uses: tags };
}

// Screen Line code themes: zinc ink, Electric for keywords, the SecureGrid mark colours
// for literals. Shared by MDX code blocks and server-rendered snippets.
import type { ThemeRegistrationRaw } from "shiki";

function theme(name: string, type: "light" | "dark", c: Record<string, string>): ThemeRegistrationRaw {
  return {
    name,
    type,
    colors: { "editor.background": c.bg, "editor.foreground": c.fg },
    settings: [
      { settings: { foreground: c.fg, background: c.bg } },
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.comment } },
      { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "variable.language"], settings: { foreground: c.keyword } },
      { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: c.string } },
      { scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"], settings: { foreground: c.number } },
      { scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"], settings: { foreground: c.fn } },
      { scope: ["entity.name.tag", "support.class.component", "meta.tag.custom"], settings: { foreground: c.tag } },
      { scope: ["entity.other.attribute-name", "meta.attribute"], settings: { foreground: c.attr } },
      { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"], settings: { foreground: c.type } },
      { scope: ["variable", "variable.other", "meta.object-literal.key", "support.type.property-name"], settings: { foreground: c.fg } },
      { scope: ["punctuation", "meta.brace", "keyword.operator", "punctuation.separator", "punctuation.terminator"], settings: { foreground: c.punct } },
      { scope: ["markup.inserted"], settings: { foreground: c.string } },
      { scope: ["markup.deleted"], settings: { foreground: c.deleted } },
      { scope: ["markup.heading"], settings: { foreground: c.fn, fontStyle: "bold" } },
    ],
  };
}

export const lumesecLight = theme("lumesec-light", "light", {
  bg: "#fafafa",
  fg: "#27272a",
  comment: "#9f9fa9",
  keyword: "#6219f3",
  string: "#18794e",
  number: "#a5560b",
  fn: "#09090b",
  tag: "#0369a1",
  attr: "#6219f3",
  type: "#0369a1",
  punct: "#71717b",
  deleted: "#c41d1d",
});

export const lumesecDark = theme("lumesec-dark", "dark", {
  bg: "#111113",
  fg: "#e4e4e7",
  comment: "#6c6c74",
  keyword: "#a685ff",
  string: "#6fc884",
  number: "#eeb154",
  fn: "#fafafa",
  tag: "#4ab8e8",
  attr: "#a685ff",
  type: "#4ab8e8",
  punct: "#9f9fa9",
  deleted: "#fd736d",
});

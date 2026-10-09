/**
 * <px-minimap> · Code minimap
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/minimap
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-minimap.tsx.
 *
 * Demo data: The code is generated sample JavaScript; only the search query can be set with `find()`. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import { PxBase, clamp, css, define, escapeHtml, hash, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

const WORDS = [
  "token",
  "agent",
  "stream",
  "buffer",
  "route",
  "cache",
  "model",
  "frame",
  "queue",
  "trace",
  "span",
  "retry",
  "limit",
  "batch",
  "vector",
] as const;

/**
 * Token kind; the letters double as CSS classes of the code view: `c` comment, `s` string, `k` keyword,
 * `n` number, `i` identifier, `w` whitespace, `p` punctuation.
 */
type TokenKind = "c" | "s" | "k" | "n" | "i" | "w" | "p";

/** A lexed token: its text and kind. */
type Token = [text: string, kind: TokenKind];

/** Number of lines of sample code. */
const LINE_COUNT = 140;

const capitalize = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Deterministic sample code: small async functions built from {@link WORDS}. */
function genCode(n: number): string[] {
  const lines: string[] = [];
  let seed = 1;
  while (lines.length < n) {
    const a = WORDS[(seed * 7) % 15];
    const b = WORDS[(seed * 11 + 3) % 15];
    const c = WORDS[(seed * 5 + 8) % 15];
    seed++;
    lines.push(`// ${capitalize(a)} ${b} handling`);
    lines.push(`export async function ${a}${capitalize(b)}(${b}, opts = {}) {`);
    lines.push(`  const ${a} = new Map();`);
    lines.push(`  if (!${b}) return null;`);
    if (hash(seed) > 0.4) lines.push(`  const ${c} = opts.${c} ?? ${Math.round(hash(seed * 3) * 900) + 100};`);
    lines.push(`  for (const item of ${b}.items) {`);
    lines.push(`    ${a}.set(item.id, '${b}:' + item.key);`);
    if (hash(seed * 7) > 0.5) lines.push(`    await ${a}.flush({ limit: ${Math.round(hash(seed * 5) * 60) + 4} });`);
    lines.push("  }");
    lines.push(`  return ${a};`);
    lines.push("}");
    lines.push("");
  }
  return lines.slice(0, n);
}

/** One alternative per token kind, in the order of {@link kindOf}. */
const TOK =
  /(\/\/.*$)|('[^']*')|\b(export|async|function|const|if|return|for|of|new|await|null)\b|(\b\d+\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;

/** The kind of a {@link TOK} match, from the group that matched. */
function kindOf(m: RegExpExecArray): TokenKind {
  if (m[1]) return "c";
  if (m[2]) return "s";
  if (m[3]) return "k";
  if (m[4]) return "n";
  if (m[5]) return "i";
  if (m[6]) return "w";
  return "p";
}

/** Split a line into tokens for highlighting. */
function lex(line: string): Token[] {
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) out.push([m[0], kindOf(m)]);
  return out;
}

/** HTML of a line: highlighted tokens in spans, the rest as escaped text. */
function lineHtml(tokens: readonly Token[]): string {
  const body = tokens
    .map(([text, kind]) => {
      const escaped = escapeHtml(text);
      return kind === "w" || kind === "i" || kind === "p" ? escaped : `<span class="${kind}">${escaped}</span>`;
    })
    .join("");
  return `<span class="ln">${body}</span>`;
}

/**
 * Syntax-coloured pixel minimap beside a code view with the visible window outlined; search hits pulse in the margin
 * and dragging scrolls.
 */
class Minimap extends PxBase {
  private readonly lines: Token[][] = genCode(LINE_COUNT).map(lex);
  /** Indices of the lines that match the search. */
  private hits: number[] = [];
  /** Index into {@link Minimap.hits} of the current match, -1 before the first Enter. */
  private hitIndex = -1;
  private drag = false;
  /** Pointer y over the minimap, or null. */
  private hoverY: number | null = null;
  private readonly code = this.$("pre");

  constructor() {
    super(
      `
      :host { display: block; }
      .find { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
      .find input { flex: 1; min-width: 0; height: 32px; border-radius: 8px; border: 1px solid var(--_border); background: var(--_surface); padding: 0 10px; font-family: var(--_mono); font-size: 12.5px; }
      .find input:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
      .cnt { font-size: 12px; color: var(--_muted); white-space: nowrap; }
      .wrap { display: flex; gap: 10px; height: 220px; }
      .code { flex: 1; min-width: 0; contain: inline-size; overflow: auto; margin: 0; padding: 6px 0; font-family: var(--_mono); font-size: 12px; line-height: 18px; border-radius: 10px; background: color-mix(in srgb, var(--_track) 55%, transparent); scrollbar-width: none; }
      .code::-webkit-scrollbar { display: none; }
      .ln { display: block; white-space: pre; padding: 0 10px; min-height: 18px; }
      .ln.hit { background: color-mix(in srgb, var(--_warn) 22%, transparent); }
      .k { color: var(--_accent); } .s { color: var(--_ok); } .c { color: var(--_muted); font-style: italic; } .n { color: var(--_warn); }
      canvas.px { width: 66px; height: 220px; flex: none; cursor: pointer; touch-action: none; border-radius: 8px; }
      `,
      `<div class="find"><input class="q" type="search" placeholder="Find in file" aria-label="Find in file" spellcheck="false" value="flush"><span class="rollslot cnt" aria-live="polite"></span></div>
        <div class="wrap"><pre class="code" tabindex="0" role="region" aria-label="Sample code"></pre><canvas class="px" aria-hidden="true"></canvas></div>`,
    );
    const code = this.code;
    code.addEventListener("scroll", () => this.kick());
    const canvas = this.$("canvas");
    /** Scroll the code so the line under the pointer is centred. */
    const scrollToPointer = (e: PointerEvent, smoothScroll: boolean): void => {
      const r = canvas.getBoundingClientRect();
      const u = clamp((e.clientY - r.top) / r.height, 0, 1);
      const top = u * code.scrollHeight - code.clientHeight / 2;
      code.scrollTo({ top, behavior: smoothScroll && !reduced() ? "smooth" : "auto" });
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = true;
      scrollToPointer(e, true);
    });
    canvas.addEventListener("pointermove", (e) => {
      this.hoverY = e.clientY - canvas.getBoundingClientRect().top;
      if (this.drag) scrollToPointer(e, false);
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverY = null;
      this.kick();
    });
    const up = (): void => {
      this.drag = false;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    const query = this.$<HTMLInputElement>(".q");
    query.addEventListener("input", (e) => {
      // the native event stays inside the shadow root
      e.stopPropagation();
      this.search(query.value, false);
    });
    query.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      this.next();
    });
  }

  protected override init(): void {
    this.code.innerHTML = this.lines.map(lineHtml).join("");
    this.search(this.$<HTMLInputElement>(".q").value, true);
  }

  /**
   * Highlights every line containing `query` (case-insensitive), marks it in the minimap and shows it in the
   * search box.
   */
  find(query: string): void {
    this.$<HTMLInputElement>(".q").value = query;
    this.search(query, false);
  }

  /** Run a search; `first` (connect) shows the count without the roll. */
  private search(query: string, first: boolean): void {
    const q = query.trim().toLowerCase();
    this.hits = [];
    this.$$(".ln").forEach((line, i) => {
      const hit = !!q && (line.textContent ?? "").toLowerCase().includes(q);
      line.classList.toggle("hit", hit);
      if (hit) this.hits.push(i);
    });
    this.hitIndex = -1;
    const count = this.hits.length;
    const text = q ? `${count} match${count === 1 ? "" : "es"}` : `${LINE_COUNT} lines`;
    rollText(this.$(".cnt"), text, 1, !first);
    this.kick();
  }

  /** Scrolls to the next match, wrapping around. */
  next(): void {
    if (!this.hits.length) return;
    this.hitIndex = (this.hitIndex + 1) % this.hits.length;
    const line = this.$$(".ln")[this.hits[this.hitIndex]];
    const code = this.code;
    code.scrollTo({ top: line.offsetTop - code.clientHeight / 2, behavior: reduced() ? "auto" : "smooth" });
  }

  protected override render(t: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const code = this.code;
    const lineH = this.h / this.lines.length;
    const still = reduced();
    const colorOf: Record<Exclude<TokenKind, "w">, RGB> = {
      k: P.accent,
      s: P.ok,
      c: P.muted,
      n: P.warn,
      i: P.fg,
      p: P.fg,
    };
    this.clear();
    // the visible window of the code view
    const viewTop = (code.scrollTop / code.scrollHeight) * this.h;
    const viewH = (code.clientHeight / code.scrollHeight) * this.h;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = css(P.accent);
    ctx.fillRect(0, viewTop, this.w, viewH);
    ctx.globalAlpha = 1;
    for (let x = 0; x < this.w; x += 3) {
      this.dot(x, viewTop, P.accent, 0.7, 1.6);
      this.dot(x, viewTop + viewH - 1.6, P.accent, 0.7, 1.6);
    }
    const hitSet = new Set(this.hits);
    this.lines.forEach((tokens, i) => {
      let x = 4;
      const y = i * lineH;
      for (const [text, kind] of tokens) {
        const width = text.length * 0.95;
        if (kind !== "w") {
          ctx.globalAlpha = kind === "c" ? 0.35 : 0.6;
          ctx.fillStyle = css(colorOf[kind]);
          ctx.fillRect(x, y, Math.max(0.8, width - 0.4), Math.max(1, lineH * 0.7));
        }
        x += width;
        if (x > this.w - 8) break;
      }
      if (hitSet.has(i)) {
        const pulse = still ? 1 : 0.6 + 0.4 * Math.sin(t * 5 - i * 0.2);
        this.dot(this.w - 5, y - 0.5, P.warn, pulse, 4);
      }
    });
    if (this.hoverY != null && !this.drag) {
      const y = this.hoverY;
      for (let x = 0; x < this.w; x += 3) this.dot(x, y - 0.5, P.fg, 0.35, 1.6);
    }
    ctx.globalAlpha = 1;
    return this.hits.length > 0 && !still;
  }
}

define("px-minimap", Minimap);

export { Minimap };

declare global {
  interface HTMLElementTagNameMap {
    "px-minimap": Minimap;
  }
}

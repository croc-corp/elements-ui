/**
 * <px-tokenize> · Token view
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/tokenize
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-tokenize.tsx.
 */
import { PxBase, clamp, define, ease3, mix, now, reduced, rollText, type PaletteKey } from "@/lib/lumesec/pixel";

/** Events fired by `<px-tokenize>`. */
export interface TokenizeEventMap {
  /** Fires on every edit with the token count. It does not fire when the element first connects. */
  change: CustomEvent<{ tokens: number }>;
}

/** Token tints, cycled. */
const TK_COLS: readonly PaletteKey[] = ["accent", "ok", "warn", "danger", "shine"];

/** Pause in typing, in ms, before the token count is announced. */
const ANNOUNCE_DELAY = 700;

/** Dot pitch of the strip: columns 4px apart, rows 6px. */
const COL_W = 4;
const ROW_H = 6;

/**
 * A rough tokenizer for illustration: words, groups of up to three digits and single symbols, each with its
 * leading whitespace. Words longer than six letters lose a common suffix and are cut into four-letter chunks.
 */
function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /\s*[A-Za-z]+|\s*\d{1,3}|\s*[^\sA-Za-z\d]|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const tok = m[0];
    const lead = /^\s*/.exec(tok)?.[0] ?? "";
    const word = tok.slice(lead.length);
    if (/^[A-Za-z]+$/.test(word) && word.length > 6) {
      let rest = word;
      let tail = "";
      const suffix = /(ing|tion|ers|ment|ness|izer|izers|ized|able|ally|ly|ed|es|s)$/.exec(rest);
      if (suffix && rest.length - suffix[0].length >= 3) {
        tail = suffix[0];
        rest = rest.slice(0, -tail.length);
      }
      const parts: string[] = [];
      while (rest.length > 6) {
        parts.push(rest.slice(0, 4));
        rest = rest.slice(4);
      }
      parts.push(rest);
      if (tail) parts.push(tail);
      parts[0] = lead + parts[0];
      out.push(...parts);
    } else {
      out.push(tok);
    }
  }
  return out;
}

/** Where a token sits on the strip: its first column, its row and its width in dots. */
interface TokenSlot {
  col: number;
  row: number;
  n: number;
}

/**
 * Live token view: typed text splits into tinted spans and a strip of pixels where new tokens drop in, using a rough
 * tokenizer.
 */
class Tokenize extends PxBase {
  private tokens: string[] = [];
  /** Time each token starts dropping in. */
  private appear: number[] = [];
  /** Highlighted token index, or -1. */
  private highlight = -1;
  /** Token positions on the strip; null until the first layout. */
  private slots: TokenSlot[] | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 10px; border: 1px solid var(--_border); background: var(--_surface); padding: 10px 12px; font: inherit; font-size: 13.5px; line-height: 1.5; color: var(--_fg); }
      textarea:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
      .toks { margin: 10px 0 0; font-size: 13.5px; line-height: 1.85; white-space: pre-wrap; word-break: break-word; }
      .toks span { border-radius: 3px; padding: 1px 0; transition: box-shadow .15s; }
      .toks span.on { box-shadow: 0 0 0 1.5px var(--_fg); }
      canvas.px { height: 20px; margin-top: 10px; }
      .st { font-size: 12.5px; color: var(--_muted); margin-top: 8px; display: block; }
      .st .roll { white-space: normal; }
      `,
      `<textarea aria-label="Text to tokenize" spellcheck="false">Tokenizers split text into pieces. Ultracode, xhigh effort, and 1,280,000 tokens!</textarea>
        <p class="toks" aria-hidden="true"></p><canvas class="px" role="img"></canvas><span class="st"><span class="rollslot cnt"></span></span><span class="sr" aria-live="polite"></span>`,
    );
    this.$("textarea").addEventListener("input", (e) => {
      // the native event stays inside the shadow root; `change` reports edits
      e.stopPropagation();
      this.update(true);
    });
    const box = this.$(".toks");
    box.addEventListener("pointerover", (e) => {
      const index = e.target instanceof HTMLElement ? e.target.dataset.i : undefined;
      this.setHighlight(index == null ? -1 : Number(index));
    });
    box.addEventListener("pointerleave", () => this.setHighlight(-1));
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.setHighlight(this.tokenAt(e.clientX - r.left, e.clientY - r.top));
    });
    canvas.addEventListener("pointerleave", () => this.setHighlight(-1));
  }

  protected override init(): void {
    this.update(false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.announceTimer);
  }

  /** Re-tokenize the text; tokens that changed drop in one after another. */
  private update(animate: boolean): void {
    const text = this.$("textarea").value;
    const next = tokenize(text);
    const start = now();
    // tokens up to the first change keep their appearance time
    let same = 0;
    while (same < next.length && same < this.tokens.length && next[same] === this.tokens[same]) same++;
    this.appear = next.map((_, i) => {
      if (i < same) return this.appear[i] ?? -9;
      return animate && !reduced() ? start + (i - same) * 0.03 : -9;
    });
    this.tokens = next;
    const spans = next.map((token, i) => {
      const span = document.createElement("span");
      span.dataset.i = String(i);
      span.textContent = token;
      span.style.background = `color-mix(in srgb, var(--_${TK_COLS[i % 5]}) 20%, transparent)`;
      return span;
    });
    this.$(".toks").replaceChildren(...spans);
    const n = next.length;
    const chars = text.length;
    const ratio = n ? (chars / n).toFixed(1) : "0";
    rollText(
      this.$(".cnt"),
      `${n} tokens · ${chars} characters · ≈${ratio} chars per token (rough, for illustration)`,
      1,
      animate,
    );
    this.canvas.setAttribute("aria-label", `${n} tokens`);
    // the count is announced once typing pauses, not after every keystroke
    clearTimeout(this.announceTimer);
    if (animate) {
      this.announceTimer = setTimeout(() => {
        this.$(".sr").textContent = `${n} tokens, ${chars} characters`;
      }, ANNOUNCE_DELAY);
    }
    this.placeTokens();
    if (animate) this.emit<{ tokens: number }>("change", { tokens: n });
    this.kick();
  }

  /** Lay the tokens out in rows of dots, one dot per character, and grow the strip to fit. */
  private placeTokens(): void {
    if (!this.w) return;
    const perRow = Math.floor(this.w / COL_W);
    let col = 0;
    let row = 0;
    this.slots = this.tokens.map((token) => {
      const n = Math.max(1, token.trim().length || 1);
      if (col + n > perRow) {
        col = 0;
        row++;
      }
      const slot = { col, row, n };
      col += n + 1;
      return slot;
    });
    const height = (row + 1) * ROW_H + 2;
    if (Math.abs(this.canvas.clientHeight - height) > 1) this.canvas.style.height = `${height}px`;
  }

  protected override resized(): void {
    this.placeTokens();
  }

  private tokenAt(x: number, y: number): number {
    if (!this.slots) return -1;
    const c = Math.floor(x / COL_W);
    const r = Math.floor(y / ROW_H);
    return this.slots.findIndex((slot) => slot.row === r && c >= slot.col && c < slot.col + slot.n);
  }

  private setHighlight(index: number): void {
    this.highlight = index;
    this.mark();
    this.kick();
  }

  /** Outline the highlighted token's span. */
  private mark(): void {
    for (const span of this.$$(".toks span")) span.classList.toggle("on", Number(span.dataset.i) === this.highlight);
  }

  protected override render(t: number): boolean {
    if (!this.slots) this.placeTokens();
    const slots = this.slots;
    if (!slots) return false;
    const P = this.P;
    let busy = false;
    this.clear();
    slots.forEach((slot, i) => {
      const a = clamp((t - this.appear[i]) / 0.3, 0, 1);
      if (a < 1) busy = true;
      const color = P[TK_COLS[i % 5]];
      const on = i === this.highlight;
      const dim = this.highlight >= 0 && !on ? 0.35 : 1;
      // new tokens drop in from above
      const y = slot.row * ROW_H + 1 - (1 - ease3(a)) * 10;
      for (let k = 0; k < slot.n; k++) {
        this.dot((slot.col + k) * COL_W, y, on ? mix(color, P.shine, 0.4) : color, a * dim, on ? 3.4 : 2.8);
      }
    });
    return busy;
  }
}

define("px-tokenize", Tokenize);

export { Tokenize };

declare global {
  interface HTMLElementTagNameMap {
    "px-tokenize": Tokenize;
  }
}

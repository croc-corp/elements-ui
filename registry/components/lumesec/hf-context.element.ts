/**
 * <hf-context> · Context window
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/context
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-context.tsx.
 *
 * Demo data: The 200k window and its four segment sizes are invented; only `addTo()` and `compact()` change
 * them. It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { HF, bayer, clamp, define, h2, mix, now, reduced, rollText, shake, type PaletteKey } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-context>`. */
export interface HContextEventMap {
  /** Fires after `addTo()` or a built-in add button grows the context. `used` is in thousands of tokens. */
  change: CustomEvent<{ used: number }>;
  /** Fires after compaction with the new total, in thousands of tokens. */
  compact: CustomEvent<{ used: number }>;
}

/** A slice of the context window. */
interface Segment {
  name: string;
  color: PaletteKey;
  /** Size in thousands of tokens. */
  size: number;
  /** Size as drawn, easing toward `size`. */
  shown: number;
}

/** Built-in demo data: a 200k window holding System, Tools, Files and Conversation. */
const SEGMENTS: readonly Omit<Segment, "shown">[] = [
  { name: "System", color: "muted", size: 8 },
  { name: "Tools", color: "warn", size: 14 },
  { name: "Files", color: "ok", size: 46 },
  { name: "Conversation", color: "accent", size: 62 },
];

/** Window size in thousands of tokens. */
const CAPACITY = 200;
/** Index of the Conversation segment, the one compaction shrinks. */
const CONVERSATION = 3;

/**
 * Context-window meter with four dithered segments, warnings at 80% and 95% and a compaction sweep; runs on
 * built-in demo data.
 */
class HContext extends HF {
  private readonly seg: Segment[] = SEGMENTS.map((s) => ({ ...s, shown: s.size }));
  /** Index of the segment highlighted from the legend, or null. */
  private highlight: number | null = null;
  /** Time of the last compaction; starts the sweep. */
  private sweep = -9;

  constructor() {
    super(
      `
      :host { display: block; }
      .head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .pct { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
      :host([data-zone="warn"]) .pct { color: var(--_warn); }
      :host([data-zone="full"]) .pct { color: var(--_danger); }
      .tok { margin-left: auto; font-family: var(--_mono); font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      canvas.px { height: 48px; border-radius: 8px; }
      ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 12px; }
      li { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 2px 4px; border-radius: 6px; cursor: default; }
      li:hover, li:focus-visible { background: color-mix(in srgb, var(--_fg) 7%, transparent); }
      li i { width: 8px; height: 8px; border-radius: 2px; }
      li b { font-weight: 500; font-family: var(--_mono); font-size: 11.5px; color: var(--_muted); }
      .bar { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      `,
      `<div class="head"><span class="lab">Context window</span><span class="rollslot pct" aria-live="polite"></span><span class="rollslot tok"></span></div><canvas class="px" role="meter" aria-label="Context window" aria-valuemin="0" aria-valuemax="100"></canvas><ul></ul>
        <div class="bar"><button class="pbtn turn" type="button">Send a message (+6k)</button><button class="pbtn file" type="button">Attach file (+18k)</button><button class="pbtn cmp" type="button">Compact</button></div>`,
      2,
      0.72,
    );
    this.$(".turn").addEventListener("click", () => this.addTo(CONVERSATION, 6));
    this.$(".file").addEventListener("click", () => this.addTo(2, 18));
    this.$(".cmp").addEventListener("click", () => this.compact());
  }

  /** Total tokens in use, in thousands. */
  get used(): number {
    return this.seg.reduce((sum, s) => sum + s.size, 0);
  }

  protected override init(): void {
    const list = this.$("ul");
    this.seg.forEach((s, i) => {
      const item = document.createElement("li");
      item.tabIndex = 0;
      item.innerHTML = `<i style="background:var(--_${s.color})"></i><span>${s.name}</span><b></b>`;
      const on = (): void => {
        this.highlight = i;
        this.kick();
      };
      const off = (): void => {
        this.highlight = null;
        this.kick();
      };
      item.addEventListener("pointerenter", on);
      item.addEventListener("pointerleave", off);
      item.addEventListener("focus", on);
      item.addEventListener("blur", off);
      list.appendChild(item);
    });
    this.sync(false, 1);
  }

  /**
   * Adds `k` thousand tokens to segment `index` (0 System, 1 Tools, 2 Files, 3 Conversation), capped at the free
   * space. When the window is full the bar shakes and nothing is emitted. An unknown index or a `k` that is not
   * a positive number is ignored.
   */
  addTo(index: number, k: number): void {
    const segment = this.seg[index];
    if (!segment || !(k > 0)) return;
    const room = CAPACITY - this.used;
    if (room <= 0) {
      shake(this.$("canvas"));
      return;
    }
    segment.size += Math.min(k, room);
    this.sync(true, 1);
    this.emit<{ used: number }>("change", { used: this.used });
  }

  /**
   * Shrinks Conversation to a quarter of its size, at least 6k, with a sweep. Does nothing if it is already that
   * small.
   */
  compact(): void {
    const conversation = this.seg[CONVERSATION];
    const keep = Math.max(6, Math.round(conversation.size * 0.25));
    if (conversation.size <= keep) return;
    conversation.size = keep;
    this.sweep = reduced() ? -9 : now();
    this.sync(true, -1);
    this.emit<{ used: number }>("compact", { used: this.used });
  }

  private sync(animate: boolean, dir: number): void {
    const used = this.used;
    const pct = Math.round((used / CAPACITY) * 100);
    this.dataset.zone = pct >= 95 ? "full" : pct >= 80 ? "warn" : "ok";
    rollText(this.$(".pct"), `${pct}%`, dir, animate);
    rollText(this.$(".tok"), `${used}k / ${CAPACITY}k tokens`, dir, animate);
    this.$$("li b").forEach((b, i) => {
      b.textContent = `${this.seg[i].size}k`;
    });
    const canvas = this.$("canvas");
    canvas.setAttribute("aria-valuenow", String(pct));
    canvas.setAttribute("aria-valuetext", `${pct}% used, ${used}k of ${CAPACITY}k tokens`);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const w = this.w;
    let moving = false;
    for (const s of this.seg) {
      const d = s.size - s.shown;
      s.shown = reducedMotion ? s.size : s.shown + d * Math.min(1, dt * 4);
      if (Math.abs(d) > 0.02) moving = true;
    }
    // left edge of each segment in px
    const starts: number[] = [];
    let acc = 0;
    for (const s of this.seg) {
      starts.push((acc / CAPACITY) * w);
      acc += s.shown;
    }
    const end = (acc / CAPACITY) * w;
    const frac = acc / CAPACITY;
    const sweep = (t - this.sweep) / 0.8;
    const edgeCol = frac >= 0.95 ? P.danger : frac >= 0.8 ? P.warn : P.shine;
    F.clear();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const [x] = F.xy(i, j);
        // dotted markers at 80% and 95%
        if (Math.abs(x - w * 0.8) < 1 || Math.abs(x - w * 0.95) < 1) {
          if (j % 3 === 0) F.put(i, j, x > w * 0.9 ? P.danger : P.warn, 0.55);
          continue;
        }
        // free space, lit by the compaction sweep
        if (x > end + 1.5) {
          let a = 0.09;
          if (sweep >= 0 && sweep <= 1.2) {
            const fx = (1 - sweep) * w;
            a += Math.exp(-((x - fx) ** 2) / 300) * 0.7 * (1 - sweep / 1.2);
          }
          F.put(i, j, P.fg, a, a > 0.2 ? a * 0.6 : 0);
          continue;
        }
        let si = 0;
        for (let k = 0; k < starts.length; k++) {
          if (x >= starts[k]) si = k;
        }
        // dither the first 5px of a segment into the previous one
        const start = starts[si];
        if (si > 0 && x - start < 5 && bayer(i, j) > (x - start) / 5) si -= 1;
        const s = this.seg[si];
        const shade = 0.72 + 0.28 * (1 - j / R);
        const dim = this.highlight != null && this.highlight !== si ? 0.28 : 1;
        const fromEnd = end - x;
        const edge = fromEnd < 10 ? 1 - fromEnd / 10 : 0;
        const flicker = reducedMotion ? 0 : 0.15 * edge * h2(i + Math.floor(t * 18), j);
        const alarm = frac >= 0.95 && !reducedMotion ? 0.25 * (0.5 + 0.5 * Math.sin(t * 8)) : 0;
        F.put(i, j, mix(P[s.color], edgeCol, edge * 0.7), clamp(shade * dim + flicker, 0, 1), edge * 0.85 + alarm);
      }
    }
    this.flush(0.9, 6);
    return !reducedMotion || moving || sweep < 1.3;
  }
}

define("hf-context", HContext);

declare global {
  interface HTMLElementTagNameMap {
    "hf-context": HContext;
  }
}

export { HContext };

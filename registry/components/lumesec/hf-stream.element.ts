/**
 * <hf-stream> · Streaming reply
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/stream
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-stream.tsx.
 *
 * Demo data: The streaming, its timing and the tokens-per-second figures are simulated; only the `text` can be
 * set. It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { HF, bayer, clamp, clientScale, define, h2, mix, now, reduced, sparkSdf } from "@/lib/lumesec/pixel";

/** Detail of the `done` event. */
export interface HStreamDoneDetail {
  /** Number of words streamed. */
  tokens: number;
  /** True when the stream was stopped before the end. */
  stopped: boolean;
}

/** Events fired by `<hf-stream>`. */
export interface HStreamEventMap {
  /** Fires when a stream starts. */
  start: CustomEvent<Record<string, never>>;
  /** Fires when a stream completes or is stopped. */
  done: CustomEvent<HStreamDoneDetail>;
}

const STREAM_TXT =
  "Here’s the plan. First I’ll map every call site of the legacy auth helper and group them by module. Then I’ll migrate one group at a time behind a feature flag, run the suite after each step, and only delete the old helper once all 128 tests pass on both paths.";

/** A streamed word and when it arrived. */
interface StreamSpan {
  el: HTMLSpanElement;
  t0: number;
}

/** The edges of a box in client coordinates. */
type Edges = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

/** Called per cell of a box; `u` and `v` run from 0 to 1 across it. */
type CellVisitor = (i: number, j: number, u: number, v: number) => void;

/**
 * Visit every field cell covering `box`, given the canvas rectangle `origin`, both in client coordinates. `pitch` is
 * the cell pitch on screen.
 */
function eachCell(pitch: number, origin: DOMRect, box: Edges, visit: CellVisitor): void {
  const i0 = Math.floor((box.left - origin.left) / pitch);
  const i1 = Math.ceil((box.right - origin.left) / pitch);
  const j0 = Math.floor((box.top - origin.top) / pitch);
  const j1 = Math.ceil((box.bottom - origin.top) / pitch);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      visit(i, j, (i - i0) / Math.max(1, i1 - i0 - 1), (j - j0) / Math.max(1, j1 - j0 - 1));
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Streaming reply where each word resolves out of noise behind a glowing block caret, with a dotted
 * tokens-per-second sparkline.
 */
class HStream extends HF {
  /** The most recent words, for the decode shimmer and the rate; at most 40. */
  private spans: StreamSpan[] = [];
  /** Tokens per second, sampled every 0.1 s. */
  private readonly hist: number[] = new Array<number>(28).fill(0);
  private streaming = false;
  /** Incremented to cancel the stream in progress. */
  private gen = 0;
  /** Time of the last rate sample. */
  private lastS = 0;
  /** Words streamed so far. */
  private count = 0;
  /** Start time of the stream. */
  private st0 = 0;
  /** Time the stream ended; the caret fades from here. */
  private endT = -9;
  /** Pending automatic start: the first one after `delay`, then each `loop` restart. */
  private startTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .w { position: relative; }
      canvas.px { position: absolute; left: -6px; top: -6px; width: calc(100% + 12px); height: calc(100% + 12px); pointer-events: none; }
      .who { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; margin-bottom: 8px; }
      .av { width: 20px; height: 20px; flex: none; }
      .tx { font-size: 14.5px; line-height: 1.62; min-height: 6.5em; }
      .tx span { animation: tin .38s ease-out both; }
      @keyframes tin { from { opacity: 0; } to { opacity: 1; } }
      .ft { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px; color: var(--_muted); }
      .sp { display: block; width: 84px; height: 20px; flex: none; }
      .rate { font-family: var(--_mono); font-variant-numeric: tabular-nums; }
      .bt { margin-left: auto; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); border-radius: 8px; padding: 5px 11px; font: 600 12px var(--_font); cursor: pointer; }
      .bt:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { .tx span { animation: none; } }
      `,
      `<div class="w"><canvas class="px" aria-hidden="true"></canvas><div class="who"><span class="av"></span><span>Assistant</span></div><div class="tx" aria-live="polite"></div><div class="ft"><span class="sp" aria-hidden="true"></span><span class="rate"></span><button class="bt" type="button">Stop</button></div></div>`,
      2,
      0.7,
    );
    this.$(".bt").addEventListener("click", () => (this.streaming ? this.stop() : this.start()));
  }

  protected override init(): void {
    this.schedule(this.num("delay", 500));
  }

  override connectedCallback(): void {
    const reinserted = this.initialized;
    super.connectedCallback();
    // the stream was cancelled when the element left the page; start it again
    if (reinserted) this.schedule(this.num("delay", 500));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // a detached element must not keep streaming or looping
    clearTimeout(this.startTimer);
    if (this.streaming) {
      this.gen++;
      this.streaming = false;
      this.$(".tx").setAttribute("aria-busy", "false");
    }
  }

  /** Start a stream after `ms`, unless one is running by then. */
  private schedule(ms: number): void {
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      if (!this.streaming) void this.start();
    }, ms);
  }

  /** Clears the text and streams it again, cancelling a stream in progress. */
  async start(): Promise<void> {
    const gen = ++this.gen;
    clearTimeout(this.startTimer);
    const tx = this.$(".tx");
    tx.innerHTML = "";
    // screen readers wait for the whole reply instead of reading every word as it arrives
    tx.setAttribute("aria-busy", "true");
    this.spans = [];
    this.count = 0;
    this.streaming = true;
    this.st0 = now();
    this.hist.fill(0);
    this.$(".bt").textContent = "Stop";
    this.emit("start");
    this.kick();
    const toks = (this.getAttribute("text") || STREAM_TXT).match(/\S+\s*/g) || [];
    for (const tk of toks) {
      if (gen !== this.gen) return;
      const span = document.createElement("span");
      span.textContent = tk;
      tx.append(span);
      this.spans.push({ el: span, t0: now() });
      if (this.spans.length > 40) this.spans.shift();
      this.count++;
      this.kick();
      // pause after punctuation, and now and then for longer, like a real stream
      const pause = /[.,;:]\s*$/.test(tk) ? 160 : 0;
      await sleep(reduced() ? 10 : 18 + Math.random() * 46 + pause + (Math.random() < 0.05 ? 260 : 0));
    }
    if (gen === this.gen) this.finish(false);
  }

  /**
   * Stops the current stream and fires `done` with `stopped: true`. Also cancels a pending automatic start; does
   * nothing else while no stream runs.
   */
  stop(): void {
    clearTimeout(this.startTimer);
    if (!this.streaming) return;
    this.gen++;
    this.finish(true);
  }

  private finish(stopped: boolean): void {
    this.streaming = false;
    this.$(".tx").setAttribute("aria-busy", "false");
    this.endT = now();
    const secs = now() - this.st0;
    this.$(".rate").textContent = `${this.count} tokens · ${secs.toFixed(1)}s${stopped ? " · stopped" : ""}`;
    this.$(".bt").textContent = "Regenerate";
    this.emit<HStreamDoneDetail>("done", { tokens: this.count, stopped });
    this.kick();
    if (this.hasAttribute("loop") && !stopped) this.schedule(3500);
  }

  protected override render(t: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const origin = canvas.getBoundingClientRect();
    // the boxes below stay in client coordinates, so the cell pitch is taken to on-screen pixels
    const scale = clientScale(canvas, origin);
    const pitch = F.pitch * scale;
    if (this.streaming && t - this.lastS > 0.1) {
      this.lastS = t;
      this.hist.shift();
      const recent = this.spans.filter((s) => t - s.t0 < 0.5).length * 2;
      this.hist.push(recent);
      this.$(".rate").textContent = `${String(Math.round(recent)).padStart(2, " ")} tok/s`;
    }
    let busy = this.streaming;
    F.clear();
    // decode shimmer over fresh tokens
    for (const s of this.spans) {
      const age = (t - s.t0) / 0.42;
      if (age >= 1 || reducedMotion) continue;
      busy = true;
      for (const r of s.el.getClientRects()) {
        eachCell(pitch, origin, r, (i, j) => {
          if (h2(i, j + Math.floor(t * 40)) < age * 1.15 || bayer(i, j) > 0.7) return;
          F.put(i, j, mix(P.accent, P.shine, h2(j, i)), 0.75 * (1 - age), 0.35 * (1 - age));
        });
      }
    }
    // caret
    const last = this.spans[this.spans.length - 1];
    const caretA = this.streaming ? 1 : reducedMotion ? 0 : clamp(1 - (t - this.endT) / 0.6, 0, 1);
    if (caretA > 0) {
      busy = true;
      let rx: number;
      let ry: number;
      const tx = this.$(".tx").getBoundingClientRect();
      if (last) {
        const rects = last.el.getClientRects();
        const r = rects[rects.length - 1];
        rx = r.right + scale;
        ry = r.top + (r.height - 16 * scale) / 2;
        if (/\s$/.test(last.el.textContent ?? "")) rx -= 3 * scale;
      } else {
        rx = tx.left;
        ry = tx.top + 3 * scale;
      }
      const w = 7 * scale;
      const h = 16 * scale;
      const pulse = this.streaming ? (reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 12)) : caretA;
      eachCell(pitch, origin, { left: rx, right: rx + w, top: ry, bottom: ry + h }, (i, j, _u, v) =>
        F.put(i, j, mix(P.accent, P.shine, v * 0.6), pulse, 0.8 * pulse),
      );
    }
    // avatar sparkle
    const avatar = this.$(".av").getBoundingClientRect();
    eachCell(pitch, origin, avatar, (i, j, u, v) => {
      const dx = (u - 0.5) * 20;
      const dy = (v - 0.5) * 20;
      const s = 9 * (this.streaming && !reducedMotion ? 0.85 + 0.15 * Math.sin(t * 6) : 1);
      if (sparkSdf(dx, dy, s) < 1) F.put(i, j, mix(P.accent, P.shine, 0.3), 1, this.streaming ? 0.7 : 0.25);
    });
    // tokens/s sparkline
    const sparkRect = this.$(".sp").getBoundingClientRect();
    const n = this.hist.length;
    const mx = Math.max(60, ...this.hist);
    eachCell(pitch, origin, sparkRect, (i, j, u, v) => {
      const k = Math.min(n - 1, Math.floor(u * n));
      const hgt = this.hist[k] / mx;
      if (1 - v > hgt) {
        if (((i + j) & 1) === 0) F.put(i, j, P.track, 0.9);
        return;
      }
      const top = 1 - v > hgt - 0.12;
      F.put(
        i,
        j,
        top ? mix(P.accent, P.shine, 0.5) : P.accent,
        top ? 1 : bayer(i, j) < 0.7 ? 0.85 : 0.5,
        top ? 0.4 : 0.05,
      );
    });
    this.flush(0.85, 4);
    return (busy && !reducedMotion) || this.streaming;
  }
}

define("hf-stream", HStream);

declare global {
  interface HTMLElementTagNameMap {
    "hf-stream": HStream;
  }
}

export { HStream };

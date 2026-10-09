/**
 * <hf-countdown> · Countdown
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/countdown
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-countdown.tsx.
 */
import {
  HF,
  Sparks,
  bayer,
  boxMapper,
  clamp,
  define,
  h2,
  mix,
  pad2,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-countdown>`. */
export interface HCountdownEventMap {
  /** Fires once when the countdown reaches zero. */
  done: CustomEvent<Record<string, never>>;
}

/** A digit tile behind one character of the `HH:MM:SS` display, in canvas pixels. */
interface Tile {
  x: number;
  w: number;
  /** The character shown, to spot a change. */
  ch: string;
  /** Time of the last change; the tile prints a bright front top to bottom after it. */
  t0: number;
}

/** 2 h 14 min 9 s. */
const DEFAULT_SECONDS = 2 * 3600 + 14 * 60 + 9;

/** `HH:MM:SS` for a number of seconds. */
const clock = (seconds: number): string =>
  `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}`;

/** Indices of the digits in `HH:MM:SS`. */
const DIGITS = [0, 1, 3, 4, 6, 7] as const;

/**
 * HH:MM:SS countdown set in type over a dot grid; changed digits roll over while their tile reprints, the last ten
 * seconds turn red and zero bursts.
 */
class HCountdown extends HF {
  static observedAttributes = ["seconds", "label"];

  /** Digit tiles; measured again on the next frame after a resize. */
  private tiles: Tile[] = [];
  /** End time in ms since the epoch; the countdown runs against the wall clock. */
  private end = 0;
  /** Whether `done` fired for the current run. */
  private fired = false;
  private readonly sparks = new Sparks();
  /** The text last written to the digits. */
  private shown = "";
  /** Font size of the digits in CSS pixels, measured with the tiles. */
  private glyphH = 48;
  /** Timer that wakes the loop for the next whole second while nothing animates. */
  private tick = 0;
  /** Timer for zero, so `done` fires on time while the render loop is paused off screen. */
  private endTimer = 0;
  /** Timer for the restart after zero with `loop`. */
  private loopTimer = 0;
  private readonly clockObserver: ResizeObserver | null =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.layout());

  constructor() {
    super(
      `
      :host { display: block; }
      .lab { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: var(--_muted); margin-bottom: 4px; gap: 10px; }
      .box { position: relative; height: 76px; display: grid; place-items: center; container-type: inline-size; }
      .box canvas.px { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
      .clk {
        position: relative; display: flex; align-items: center; gap: 0.12em;
        font-family: var(--_mono); font-size: min(48px, 13cqi); font-weight: 600; letter-spacing: -.02em; line-height: 1;
        font-variant-numeric: tabular-nums; color: var(--_fg); transition: color .3s;
      }
      .clk[data-tone="urgent"] { color: var(--_danger); }
      .clk[data-tone="done"] { color: var(--_ok); }
      .d { width: 0.62em; justify-items: center; }
      .c { width: 0.36em; display: flex; justify-content: center; animation: breathe 1s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .55; } }
      @media (prefers-reduced-motion: reduce) { .c { animation: none; } }
      `,
      `<div class="lab"><span class="l" id="l"></span><span class="rollslot at"></span></div><div class="box"><canvas class="px" aria-hidden="true"></canvas><div class="clk" role="timer" aria-labelledby="l"><span class="rollslot d"></span><span class="rollslot d"></span><span class="c">:</span><span class="rollslot d"></span><span class="rollslot d"></span><span class="c">:</span><span class="rollslot d"></span><span class="rollslot d"></span></div></div>`,
      2,
      0.74,
    );
  }

  /** Whole seconds left. */
  get remaining(): number {
    return Math.max(0, Math.ceil((this.end - Date.now()) / 1000));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.clockObserver?.observe(this.$(".clk"));
    // re-inserted: restart the timers stopped on disconnect
    if (this.fired && this.hasAttribute("loop")) this.restart();
    else this.armEnd();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clockObserver?.disconnect();
    clearTimeout(this.tick);
    this.tick = 0;
    clearTimeout(this.endTimer);
    this.endTimer = 0;
    clearTimeout(this.loopTimer);
    this.loopTimer = 0;
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads both attributes
    if (!this.initialized) return;
    if (name === "label") this.$(".l").textContent = this.labelText;
    else this.restart();
  }

  protected override init(): void {
    this.$(".l").textContent = this.labelText;
    this.restart();
  }

  /**
   * Starts again from `seconds`, or from the `seconds` attribute when omitted, and updates the end time in the
   * header. A negative duration counts as zero.
   */
  restart(seconds?: number): void {
    const s = seconds !== undefined && Number.isFinite(seconds) ? seconds : this.num("seconds", DEFAULT_SECONDS);
    this.end = Date.now() + Math.max(0, s) * 1000;
    this.fired = false;
    clearTimeout(this.loopTimer);
    this.loopTimer = 0;
    const at = new Date(this.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    rollText(this.$(".at"), `at ${at}`, 1, this.initialized && this.shown !== "");
    this.armEnd();
    this.kick();
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Usage resets in";
  }

  protected override layout(): void {
    this.tiles = [];
    this.kick();
  }

  /** Measure the digit tiles and the font size from the laid-out text, relative to the canvas. */
  private measure(): Tile[] {
    const local = boxMapper(this.$("canvas"));
    this.glyphH = parseFloat(getComputedStyle(this.$(".clk")).fontSize) || 48;
    const slots = this.$$(".d");
    return slots.map((slot, k) => {
      const { x, w } = local(slot);
      return { x, w, ch: this.shown[DIGITS[k]] ?? "", t0: -9 };
    });
  }

  /** Write the clock text; changed digits roll over. */
  private show(text: string, animate: boolean): void {
    if (text === this.shown) return;
    const slots = this.$$(".d");
    DIGITS.forEach((index, k) => rollText(slots[k], text[index], 1, animate));
    this.shown = text;
  }

  /** Set the timer for zero; `setTimeout` holds at most 2^31 - 1 ms, so a longer wait re-arms on the way. */
  private armEnd(): void {
    clearTimeout(this.endTimer);
    this.endTimer = 0;
    if (this.fired || !this.isConnected) return;
    const ms = clamp(this.end - Date.now(), 0, 2 ** 31 - 1);
    this.endTimer = window.setTimeout(() => {
      this.endTimer = 0;
      if (this.remaining > 0) this.armEnd();
      else this.finish();
    }, ms + 15);
  }

  /** Zero: fire `done` once, burst when on screen and, with `loop`, start again 1.6 s later. */
  private finish(): void {
    if (this.fired) return;
    this.fired = true;
    clearTimeout(this.endTimer);
    this.endTimer = 0;
    this.emit("done");
    if (this.onScreen) {
      const P = this.P;
      for (const tile of this.tiles) {
        this.sparks.add(tile.x + tile.w / 2, this.h / 2, 6, [P.ok, P.shine], {
          speed: [40, 160],
          life: [0.4, 0.9],
        });
      }
    }
    if (this.hasAttribute("loop")) this.loopTimer = window.setTimeout(() => this.restart(), 1600);
    this.kick();
  }

  /** Wake the loop at the next whole second of the countdown. */
  private scheduleTick(): void {
    if (this.tick) return;
    const ms = (((this.end - Date.now()) % 1000) + 1000) % 1000;
    this.tick = window.setTimeout(() => {
      this.tick = 0;
      this.kick();
    }, ms + 15);
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const rem = this.remaining;
    this.show(clock(rem), this.shown !== "");
    if (!this.tiles.length) this.tiles = this.measure();
    // the last ten seconds turn red, zero turns green
    const urgent = rem <= 10;
    const warm: RGB | null = urgent ? (rem === 0 ? P.ok : P.danger) : null;
    this.$(".clk").dataset.tone = urgent ? (rem === 0 ? "done" : "urgent") : "";
    // normally the end timer gets there first; a frame can see zero a few milliseconds earlier
    if (rem === 0) this.finish();
    const pitch = F.pitch;
    const glyphH = this.glyphH;
    // each tile spans the digit's box plus a margin, centred on the row
    const tileTop = Math.round((this.h - glyphH * 1.12) / 2 / pitch);
    const tileRows = Math.round((glyphH * 1.12) / pitch);
    let busy = false;
    F.clear();
    this.tiles.forEach((tile, k) => {
      const ch = this.shown[DIGITS[k]] ?? "";
      if (tile.ch !== ch) {
        tile.ch = ch;
        tile.t0 = t;
      }
      const e = reducedMotion ? 1 : clamp((t - tile.t0) / 0.5, 0, 1);
      if (e < 1) busy = true;
      // the bright front prints top-down through the tile while the digit rolls over
      const frontRow = e * (tileRows + 8) - 4;
      const i0 = Math.round((tile.x - 2) / pitch);
      const i1 = Math.round((tile.x + tile.w + 2) / pitch);
      for (let lj = 0; lj < tileRows; lj++) {
        const j = tileTop + lj;
        const v = lj / tileRows;
        for (let i = i0; i < i1; i++) {
          const li = i - i0;
          // rounded corners
          const cx = Math.min(li, i1 - 1 - i);
          const cy = Math.min(lj, tileRows - 1 - lj);
          if (cx < 2 && cy < 2 && cx + cy < 2) continue;
          const noise = h2(i, j) * 3;
          if (e < 1 && Math.abs(lj + noise - frontRow) < 2.5) {
            F.put(i, j, mix(P.accent, P.shine, 0.5), 1, 0.9);
            continue;
          }
          // a dither that thickens towards the bottom, sparse behind the top of the digit
          if (bayer(i, j) > 0.1 + v * 0.42) continue;
          let col: RGB;
          let glow = 0;
          if (warm) {
            // the tile glows in the warning colour; the digit on top carries the full colour
            col = mix(warm, P.muted, 0.35 + 0.3 * v);
            glow = reducedMotion ? 0.2 : 0.2 + 0.15 * Math.sin(t * 8);
          } else col = mix(P.muted, P.accent, 0.35 + v * 0.5);
          F.put(i, j, col, (this.dark ? 0.5 : 0.4) * (0.5 + 0.5 * v), glow);
        }
      }
    });
    this.flush(0.8, 4);
    const sparking = this.sparks.step(ctx, dt);
    const animating = !reducedMotion && (busy || sparking || (urgent && rem > 0));
    // between changes the loop sleeps until the next second
    if (!animating && rem > 0) this.scheduleTick();
    return animating;
  }
}

define("hf-countdown", HCountdown);

declare global {
  interface HTMLElementTagNameMap {
    "hf-countdown": HCountdown;
  }
}

export { HCountdown };

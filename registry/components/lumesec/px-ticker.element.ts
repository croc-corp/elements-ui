/**
 * <px-ticker> · LED ticker
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/ticker
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-ticker.tsx.
 *
 * Demo data: The ticker items (model, latency, errors, agents, uptime) are invented; nothing can be set. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import { PxBase, define, reduced, type PaletteKey } from "@/lib/lumesec/pixel";

/** A ticker segment: its text and colour. */
type TickerItem = readonly [text: string, color: PaletteKey];

const TICKS: readonly TickerItem[] = [
  ["LARGE MODEL", "fg"],
  ["▲ 2.4%", "ok"],
  ["·", "muted"],
  ["LATENCY 182MS", "fg"],
  ["▼ 12%", "ok"],
  ["·", "muted"],
  ["ERRORS 0.02%", "fg"],
  ["▲ 0.01", "danger"],
  ["·", "muted"],
  ["AGENTS 1,284", "fg"],
  ["▲ 64", "accent"],
  ["·", "muted"],
  ["UPTIME 99.98%", "fg"],
  ["·", "muted"],
];

/** Scroll speed in px/s. */
const SPEED = 46;

/** One pass of the message as spans, each item tinted with its palette colour. */
function buildRun(): HTMLSpanElement {
  const run = document.createElement("span");
  run.className = "run";
  for (const [text, color] of TICKS) {
    const item = document.createElement("span");
    item.className = `it ${color}`;
    item.textContent = text;
    run.appendChild(item);
  }
  return run;
}

/**
 * LED-style marquee: glowing text over a grid of unlit dots, coloured up and down arrows and soft edges; hovering
 * eases it to a stop.
 */
class Ticker extends PxBase {
  /** Scroll offset in px. */
  private offset = 0;
  /** Current speed in px/s, easing towards {@link SPEED} or 0. */
  private velocity = SPEED;
  private paused = false;
  private hovered = false;
  /** Width of one pass of the message in px; 0 until measured. */
  private runWidth = 0;
  private readonly board = this.$(".board");
  private readonly track = this.$(".track");

  constructor() {
    super(
      `
      :host { display: block; }
      .board { position: relative; height: 50px; overflow: hidden; cursor: pointer; border-radius: 8px; background: color-mix(in srgb, var(--_track) 70%, transparent); }
      .screen {
        position: absolute; inset: 0;
        background-image: radial-gradient(circle, color-mix(in srgb, var(--_fg) 9%, transparent) 0 1px, transparent 1.5px);
        background-size: 5px 5px;
        background-position: 0 2px;
        -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
                mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
      }
      .track { position: absolute; left: 0; top: 0; height: 100%; display: flex; align-items: center; white-space: nowrap; will-change: transform; }
      .run { display: flex; align-items: center; gap: 12px; padding-right: 12px; }
      .it { font-family: var(--_mono); font-size: 15px; font-weight: 600; letter-spacing: .04em; font-variant-numeric: tabular-nums; text-shadow: 0 0 8px color-mix(in srgb, currentColor 45%, transparent); }
      .fg { color: var(--_fg); }
      .ok { color: var(--_ok); }
      .danger { color: var(--_danger); }
      .accent { color: var(--_accent); }
      .muted { color: var(--_muted); text-shadow: none; }
      .hint { font-size: 12px; color: var(--_muted); margin-top: 8px; display: block; }
      `,
      `<div class="board" role="marquee" tabindex="0" aria-label="Status ticker"><div class="screen"><div class="track"></div></div></div><span class="hint">Hover or tap to pause.</span>`,
    );
    const board = this.board;
    board.addEventListener("pointerenter", (e) => {
      // touch has no hover; a tap toggles the pause instead
      if (e.pointerType !== "mouse") return;
      this.hovered = true;
      this.kick();
    });
    board.addEventListener("pointerleave", () => {
      this.hovered = false;
      this.kick();
    });
    board.addEventListener("click", () => this.togglePause());
    board.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      this.togglePause();
    });
  }

  /** Pause or resume, and say so in the board's label. */
  private togglePause(): void {
    this.paused = !this.paused;
    this.board.setAttribute("aria-label", this.paused ? "Status ticker, paused" : "Status ticker");
    this.kick();
  }

  protected override init(): void {
    // with reduced motion the ticker starts and stays still instead of easing to a stop
    if (reduced()) this.velocity = 0;
    const first = buildRun();
    // the second pass only fills the gap while the first one scrolls out, so it is hidden from assistive technology
    const second = buildRun();
    second.setAttribute("aria-hidden", "true");
    this.track.append(first, second);
  }

  /** Copies of the message needed to cover the board at every offset. */
  private fill(): void {
    const runs = this.track.children;
    const runWidth = runs[0] instanceof HTMLElement ? runs[0].offsetWidth : 0;
    this.runWidth = runWidth;
    if (!runWidth) return;
    const needed = Math.ceil(this.board.clientWidth / runWidth) + 1;
    while (runs.length < needed) {
      const extra = buildRun();
      extra.setAttribute("aria-hidden", "true");
      this.track.appendChild(extra);
    }
  }

  protected override render(_t: number, dt: number): boolean {
    this.fill();
    const target = this.paused || this.hovered || reduced() ? 0 : SPEED;
    this.velocity += (target - this.velocity) * Math.min(1, dt * 5);
    if (this.runWidth) this.offset = (this.offset + this.velocity * dt) % this.runWidth;
    this.track.style.transform = `translateX(${(-this.offset).toFixed(2)}px)`;
    return this.velocity > 0.01 || target > 0;
  }
}

define("px-ticker", Ticker);

export { Ticker };

declare global {
  interface HTMLElementTagNameMap {
    "px-ticker": Ticker;
  }
}

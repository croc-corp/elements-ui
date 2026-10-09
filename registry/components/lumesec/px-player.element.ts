/**
 * <px-player> · Waveform player
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/player
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-player.tsx.
 *
 * Demo data: The track, its length and its waveform are invented and no audio plays; nothing can be set. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import { PxBase, clamp, define, hash, mix, now, reduced } from "@/lib/lumesec/pixel";

/** Events fired by `<px-player>`. */
export interface PlayerEventMap {
  /** Fires when playback starts. */
  play: CustomEvent<Record<string, never>>;
  /** Fires when playback pauses, including when the track reaches the end. */
  pause: CustomEvent<Record<string, never>>;
}

const PLAY = '<path d="M5 3.5v9l7.5-4.5z"/>';
const PAUSE = '<path d="M5 3.5v9M11 3.5v9"/>';

/** Track length in seconds. */
const DURATION = 222;
/** Bar pitch in px. */
const PITCH = 4;
/** Lifetime of a click ripple in seconds. */
const RIPPLE_TIME = 0.7;

/** A click ripple: track position (0 to 1) and start time. */
interface Ripple {
  at: number;
  start: number;
}

/** `m:ss` for a time in seconds. */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Demo waveform height (0 to 1) at track position `u`: loudness per song section plus per-bar variation. */
function amplitude(u: number): number {
  const section = u < 0.12 ? 0.35 : u < 0.4 ? 0.6 : u < 0.62 ? 0.95 : u < 0.78 ? 0.55 : u < 0.93 ? 1 : 0.3;
  return clamp(section * (0.55 + 0.45 * hash(Math.floor(u * 400) * 1.7)) + 0.08, 0, 1);
}

/**
 * Pixel waveform player that fills as it plays, previews ahead of the playhead on hover and ripples from wherever you
 * click.
 */
class Player extends PxBase {
  /** Playhead position from 0 to 1. */
  private position = 0.32;
  private playing = false;
  /** Pointer x over the waveform, or null. */
  private hoverX: number | null = null;
  private ripples: Ripple[] = [];
  private drag = false;
  /** Time readout last written. */
  private lastReadout = "";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      .top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .pl { width: 38px; height: 38px; border-radius: 50%; border: 0; background: var(--_accent); color: var(--_on-accent); display: grid; place-items: center; cursor: pointer; flex: none; padding: 0; transition: transform .15s; }
      .pl:active { transform: scale(.92); }
      .pl svg { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .ttl { display: grid; gap: 1px; min-width: 0; flex: 1; }
      .ttl b { font-size: 13.5px; font-weight: 600; }
      .ttl span { font-size: 12px; color: var(--_muted); }
      .tm { font-family: var(--_mono); font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      canvas.px { height: 64px; cursor: pointer; }
      .tip { position: absolute; pointer-events: none; padding: 3px 7px; border-radius: 5px; background: var(--_fg); color: var(--_surface); font-family: var(--_mono); font-size: 11px; transform: translate(-50%, -110%); z-index: 3; }
      `,
      `<div class="top"><button class="pl" type="button" aria-label="Play"><svg viewBox="0 0 16 16" aria-hidden="true">${PLAY}</svg></button><span class="ttl"><b>Night Drive</b><span>Demo track · silent</span></span><span class="tm"></span></div>
        <canvas class="px" tabindex="0" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="222"></canvas><div class="tip" hidden></div>`,
    );
    this.$(".pl").addEventListener("click", () => this.toggle());
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = clamp(e.clientX - r.left, 0, r.width);
      if (this.drag) this.moveTo(this.hoverX / r.width, false);
      this.updateTip();
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.updateTip();
      this.kick();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = true;
      const r = canvas.getBoundingClientRect();
      this.moveTo((e.clientX - r.left) / r.width, true);
    });
    const up = (): void => {
      this.drag = false;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.moveTo(this.position + (e.key === "ArrowRight" ? 5 : -5) / DURATION, true);
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        this.moveTo(e.key === "End" ? 1 : 0, true);
      }
      if (e.key === " ") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /** Starts or pauses playback and fires `play` or `pause`. Playing at the end starts over. */
  toggle(): void {
    this.playing = !this.playing;
    if (this.playing && this.position >= 1) this.position = 0;
    this.$<SVGSVGElement>(".pl svg").innerHTML = this.playing ? PAUSE : PLAY;
    this.$(".pl").setAttribute("aria-label", this.playing ? "Pause" : "Play");
    this.emit(this.playing ? "play" : "pause");
    this.kick();
  }

  /** Moves the playhead to a position from 0 to 1 of the track. A value that is not a finite number is ignored. */
  seek(position: number): void {
    if (Number.isFinite(position)) this.moveTo(position, false);
  }

  /** Move the playhead; `ripple` sends a ripple out from the new position. */
  private moveTo(position: number, ripple: boolean): void {
    this.position = clamp(position, 0, 1);
    if (ripple) this.ripples.push({ at: this.position, start: now() });
    this.kick();
  }

  /** Show the time under the pointer, or hide the tooltip. */
  private updateTip(): void {
    const tip = this.$(".tip");
    if (this.hoverX == null) {
      tip.hidden = true;
      return;
    }
    tip.textContent = formatTime((this.hoverX / this.w) * DURATION);
    tip.style.left = `${clamp(this.hoverX, 20, this.w - 20)}px`;
    tip.style.top = `${this.canvas.offsetTop}px`;
    tip.hidden = false;
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const w = this.w;
    const h = this.h;
    const bars = Math.floor(w / PITCH);
    const cy = h / 2;
    if (this.playing) {
      this.position += dt / DURATION;
      if (this.position >= 1) {
        this.position = 1;
        this.toggle();
      }
    }
    const readout = `${formatTime(this.position * DURATION)} / ${formatTime(DURATION)}`;
    if (readout !== this.lastReadout) {
      this.lastReadout = readout;
      this.$(".tm").textContent = readout;
      this.canvas.setAttribute("aria-valuenow", String(Math.round(this.position * DURATION)));
      this.canvas.setAttribute("aria-valuetext", readout);
    }
    this.ripples = this.ripples.filter((ripple) => t - ripple.start < RIPPLE_TIME);
    this.clear();
    const head = this.position * bars;
    const hoverBar = this.hoverX != null ? this.hoverX / PITCH : null;
    for (let i = 0; i < bars; i++) {
      const u = i / bars;
      const x = i * PITCH;
      let a = amplitude(u);
      // the bars at the playhead pulse while playing
      if (this.playing && !still && Math.abs(i - head) < 4) a = clamp(a * (1 + 0.3 * Math.sin(t * 18 + i)), 0, 1);
      let glow = 0;
      for (const ripple of this.ripples) {
        const age = t - ripple.start;
        const front = Math.abs(i - ripple.at * bars) - age * 90;
        glow += Math.exp(-(front ** 2) / 8) * (1 - age / RIPPLE_TIME);
      }
      const cells = Math.max(1, Math.round(a * 7));
      const played = i < head;
      const ahead = hoverBar != null && i >= head && i < hoverBar;
      const color = played ? mix(P.accent, P.shine, Math.min(1, glow)) : mix(P.fg, P.accent, Math.min(1, glow));
      const alpha = played ? 0.95 : ahead ? 0.45 : 0.2 + glow * 0.6;
      for (let r = 0; r < cells; r++) {
        this.dot(x, cy - 2 - r * 4, color, alpha, 2.6);
        // the lower half is a dimmer reflection
        this.dot(x, cy + 2 + r * 4 - 2.6 + 1, color, alpha * 0.6, 2.6);
      }
    }
    for (let y = 2; y < h - 2; y += 4) this.dot(head * PITCH - 1, y, P.fg, 0.9, 2);
    return this.playing || this.ripples.length > 0;
  }
}

define("px-player", Player);

export { Player };

declare global {
  interface HTMLElementTagNameMap {
    "px-player": Player;
  }
}

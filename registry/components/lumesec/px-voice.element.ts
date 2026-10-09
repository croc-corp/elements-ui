/**
 * <px-voice> · Voice input
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/voice
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-voice.tsx.
 *
 * Demo data: No microphone is used and the audio levels are generated; only the transcript can be set with
 * `text`. It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { PxBase, clamp, define, hash, mix, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Phase of the dictation; the host carries it as `data-state` while listening or closing. */
export type VoiceState = "idle" | "listening" | "closing";

/** Events fired by `<px-voice>`. */
export interface VoiceEventMap {
  /** Fires when listening stops, with the words recognised so far joined by spaces. */
  transcript: CustomEvent<{ text: string }>;
}

/** Sentence used when the `text` attribute is missing. */
const DEFAULT_SENTENCE =
  "Make the trail grow out of the thumb toward the left and stop at three quarters of the track.";

/** Spacing of the spectrum columns and rows in px. */
const PITCH = 5;
/** Rows above and below the centre line at full level. */
const ROWS = 4;
/** Size of a spectrum dot. */
const DOT = 2.6;

/** Simulated dictation control with a mirrored pixel spectrum. */
class Voice extends PxBase {
  private phase: VoiceState = "idle";
  /** Smoothed level per column. */
  private readonly levels: number[] = [];
  /** Falling peak per column, in rows. */
  private readonly peaks: number[] = [];
  /** Time listening started. */
  private startedAt = 0;
  /** Time the closing animation started. */
  private closedAt = 0;
  private words: string[] = [];
  /** Number of words recognised so far. */
  private wordCount = 0;
  private nextWordAt = 0;
  /** Stops listening shortly after the last word. */
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .row { display: flex; align-items: center; gap: 14px; }
      .mic {
        position: relative; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--_border);
        background: var(--_surface); color: var(--_fg); display: grid; place-items: center; cursor: pointer; flex: none; padding: 0;
        transition: background-color .25s, color .25s, transform .15s, border-color .25s;
      }
      .mic:active { transform: scale(.92); }
      .mic svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      :host([data-state="listening"]) .mic { background: var(--_accent); color: var(--_on-accent); border-color: transparent; animation: pulse 1.4s ease-out infinite; }
      @keyframes pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--_accent) 55%, transparent); } to { box-shadow: 0 0 0 14px color-mix(in srgb, var(--_accent) 0%, transparent); } }
      canvas.px { height: 48px; flex: 1; min-width: 0; }
      .tx { margin: 14px 0 0; min-height: 3em; font-size: 14px; line-height: 1.5; }
      .ghost { color: var(--_muted); }
      .w { display: inline-block; animation: win .35s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes win { from { opacity: 0; filter: blur(4px); transform: translateY(4px); } }
      .meta { font-size: 12px; color: var(--_muted); display: flex; justify-content: space-between; margin-top: 6px; }
      @media (prefers-reduced-motion: reduce) { :host([data-state="listening"]) .mic, .w { animation: none; } }
      `,
      `<div class="row"><button class="mic" type="button" aria-label="Start dictation"><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="6.2" y="2" width="5.6" height="9" rx="2.8"/><path d="M3.6 8.6a5.4 5.4 0 0 0 10.8 0M9 14v2.2"/></svg></button><canvas class="px" aria-hidden="true"></canvas></div>
        <p class="tx" aria-live="polite"><span class="ghost">Tap the mic and talk. The audio in this demo is simulated.</span></p>
        <div class="meta"><span class="rollslot st"></span><span class="mono tm"></span></div>`,
    );
    this.$(".mic").addEventListener("click", () => (this.phase === "listening" ? this.stop() : this.start()));
  }

  /** The sentence the simulated recognition types out: the `text` attribute, or the default sentence. */
  get sentence(): string {
    return this.getAttribute("text")?.trim() || DEFAULT_SENTENCE;
  }

  set sentence(value: string) {
    this.setAttribute("text", value);
  }

  protected override init(): void {
    rollText(this.$(".st"), "Ready", 1, false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.stopTimer);
    // a removed control starts over idle; it fires no event while it is out of the page
    if (this.phase === "idle") return;
    this.phase = "idle";
    delete this.dataset.state;
    this.$(".mic").setAttribute("aria-label", "Start dictation");
    rollText(this.$(".st"), "Ready", -1, false);
  }

  /** Clears the transcript and starts the simulated listening. Ignored while the closing animation runs. */
  start(): void {
    if (this.phase === "closing") return;
    clearTimeout(this.stopTimer);
    this.phase = "listening";
    this.dataset.state = "listening";
    this.startedAt = this.t;
    this.wordCount = 0;
    this.nextWordAt = this.t + 0.5;
    this.words = this.sentence.split(/\s+/);
    this.$(".tx").textContent = "";
    this.$(".mic").setAttribute("aria-label", "Stop dictation");
    rollText(this.$(".st"), "Listening…", 1);
    this.kick();
  }

  /** Stops listening and fires `transcript`. Only acts while listening. */
  stop(): void {
    if (this.phase !== "listening") return;
    clearTimeout(this.stopTimer);
    this.phase = "closing";
    this.dataset.state = "closing";
    this.closedAt = this.t;
    this.$(".mic").setAttribute("aria-label", "Start dictation");
    rollText(this.$(".st"), this.wordCount ? `Sent · ${this.wordCount} words` : "Nothing heard", 1);
    this.emit<{ text: string }>("transcript", { text: this.words.slice(0, this.wordCount).join(" ") });
    this.kick();
  }

  /** Simulated speech envelope in `[0, 1]`: syllable pulses with pauses. */
  private envelope(t: number): number {
    let e = (0.5 + 0.5 * Math.sin(t * 9.5)) * (0.6 + 0.4 * Math.sin(t * 2.3 + 1)) + rand(-0.1, 0.1);
    if (Math.sin(t * 0.9) < -0.65) e *= 0.15;
    return clamp(e, 0, 1);
  }

  /** Reveal the next word of the transcript; stop 0.7 seconds after the last one. */
  private addWord(t: number): void {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = this.words[this.wordCount];
    this.$(".tx").append(span, " ");
    this.wordCount++;
    this.nextWordAt = t + 0.17 + Math.random() * 0.2;
    if (this.wordCount === this.words.length) this.stopTimer = setTimeout(() => this.stop(), 700);
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const { w, h } = this;
    const columns = Math.max(8, Math.floor(w / PITCH));
    const cy = Math.round(h / 2 / PITCH) * PITCH - 1;
    while (this.levels.length < columns) {
      this.levels.push(0);
      this.peaks.push(0);
    }
    const listening = this.phase === "listening";
    const e = listening ? this.envelope(t) : 0;
    if (listening) {
      this.$(".tm").textContent = `0:${String(Math.floor(t - this.startedAt)).padStart(2, "0")}`;
      if (t > this.nextWordAt && e > 0.3 && this.wordCount < this.words.length) this.addWord(t);
    }
    let close = 0;
    if (this.phase === "closing") {
      close = (t - this.closedAt) / 0.7;
      if (close >= 1) {
        this.phase = "idle";
        delete this.dataset.state;
        close = 0;
      }
    }
    const closing = this.phase === "closing";
    const still = reduced();
    this.clear();
    for (let i = 0; i < columns; i++) {
      const u = i / (columns - 1);
      const x = i * PITCH;
      // voice energy sits left of centre, like a speech spectrum
      const shape = Math.exp(-(((u - 0.34) / 0.24) ** 2)) * 0.85 + 0.2;
      const target = e * shape * (0.55 + 0.45 * hash(i * 3.3 + Math.floor(t * 18)));
      const rate = target > this.levels[i] ? 20 : 7;
      this.levels[i] += (target - this.levels[i]) * Math.min(1, dt * rate);
      let level = this.levels[i];
      if (closing) level *= Math.max(0, 1 - close * 2.2);
      const height = Math.round(level * ROWS * 1.15);
      this.peaks[i] = Math.max(height, this.peaks[i] - dt * 4);
      // while closing, the centre line shrinks to a point
      if (closing && close > 0.45 && Math.abs(u - 0.5) >= (1 - (close - 0.45) / 0.55) / 2) continue;
      // a slow wave runs along the idle line; under reduced motion it holds still
      const wave = still ? 0.5 : Math.max(0, Math.sin(t * 2 - u * 8));
      const idleGlow = this.phase === "idle" ? 0.12 + 0.12 * wave : 0.3;
      this.dot(x, cy, height ? mix(P.accent, P.shine, 0.2) : P.fg, height ? 0.95 : idleGlow, DOT);
      for (let r = 1; r <= height; r++) {
        const color = mix(P.accent, P.shine, (r / (ROWS + 1)) * 0.7);
        const alpha = 1 - r * 0.13;
        this.dot(x, cy - r * PITCH, color, alpha, DOT);
        this.dot(x, cy + r * PITCH, color, alpha, DOT);
      }
      const peak = Math.round(this.peaks[i]);
      if (peak > height && listening) {
        this.dot(x, cy - peak * PITCH, P.shine, 0.6, DOT);
        this.dot(x, cy + peak * PITCH, P.shine, 0.6, DOT);
      }
    }
    return !still || this.phase !== "idle";
  }
}

define("px-voice", Voice);

export { Voice };

declare global {
  interface HTMLElementTagNameMap {
    "px-voice": Voice;
  }
}

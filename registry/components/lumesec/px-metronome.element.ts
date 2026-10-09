/**
 * <px-metronome> · Metronome
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/metronome
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-metronome.tsx.
 */
import { PxBase, Sparks, clamp, define, lerp, mix, now, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-metronome>`. */
export interface MetronomeEventMap {
  /**
   * Fires whenever the tempo is set by the buttons, tap tempo or `setBpm()`. It does not fire when the element
   * first connects or when the `bpm` attribute changes.
   */
  change: CustomEvent<{ bpm: number }>;
}

/** Upper tempo bound (exclusive) of each tempo marking. */
const TEMPI: readonly (readonly [below: number, name: string])[] = [
  [60, "Largo"],
  [76, "Adagio"],
  [108, "Andante"],
  [120, "Moderato"],
  [156, "Allegro"],
  [176, "Vivace"],
  [999, "Presto"],
];

const MIN_BPM = 40;
const MAX_BPM = 208;
/** Pendulum length in px. */
const ARM = 150;
/** Swing amplitude in radians. */
const AMPLITUDE = 0.44;

/** Safari before 14.1 only has the prefixed constructor. */
interface LegacyAudioWindow {
  webkitAudioContext?: typeof AudioContext;
}

/** Replace the text of a roll slot and hide the outgoing line from assistive technology. */
function roll(slot: Element, text: string, dir: number, animate: boolean): void {
  rollText(slot, text, dir, animate);
  for (const child of slot.children) {
    if (child !== slot.lastElementChild) child.setAttribute("aria-hidden", "true");
  }
}

/** A Web Audio context, or null where the browser has none or refuses to create one. */
function createAudioContext(): AudioContext | null {
  const Context = window.AudioContext ?? (window as LegacyAudioWindow).webkitAudioContext;
  try {
    return Context ? new Context() : null;
  } catch {
    return null;
  }
}

/**
 * Pixel metronome with a swinging pendulum whose weight slides with tempo, four beat lamps, tap tempo and optional
 * click sound.
 */
class Metronome extends PxBase {
  static readonly observedAttributes = ["bpm"] as const;

  /** Tempo in beats per minute; read from the `bpm` attribute on connect. */
  private bpm = 96;
  private playing = false;
  /** Beats elapsed since start, fractional. */
  private phase = 0;
  /** Index of the last beat played, -1 before the first. */
  private beat = -1;
  /** Flash per beat light, 1 on the beat, fading to 0. */
  private flash = [0, 0, 0, 0];
  /** Pendulum angle in radians. */
  private angle = 0;
  /** Recent tap times in seconds. */
  private taps: number[] = [];
  private readonly sparks = new Sparks();
  private sound = false;
  private audio: AudioContext | null = null;
  private readonly numeral = this.$(".num");
  private readonly playButton = this.$<HTMLButtonElement>(".play");

  constructor() {
    super(
      `
      :host { display: block; }
      .face { position: relative; }
      canvas.px { height: 214px; }
      .bpm { position: absolute; top: 10px; right: 14px; display: grid; justify-items: end; gap: 5px; pointer-events: none; }
      .num { justify-items: end; font-family: var(--_mono); font-size: 40px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .unit { font-family: var(--_mono); font-size: 11px; line-height: 1; color: var(--_muted); }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      .ctl { display: flex; gap: 6px; flex-wrap: wrap; }
      .ctl .pbtn { min-width: 34px; }
      .tn { font-size: 12.5px; color: var(--_muted); }
      `,
      `<div class="face"><canvas class="px" aria-hidden="true"></canvas><div class="bpm" aria-live="polite" aria-atomic="true"><span class="rollslot num"></span><span class="unit">BPM</span></div></div><div class="row"><span class="rollslot tn" aria-live="polite"></span><div class="ctl">
        <button class="pbtn dn" type="button" aria-label="Slower">−</button><button class="pbtn play" type="button">Start</button><button class="pbtn upb" type="button" aria-label="Faster">+</button>
        <button class="pbtn tap" type="button">Tap</button><button class="pbtn snd" type="button" aria-pressed="false">Sound</button></div></div>`,
    );
    this.$(".dn").addEventListener("click", () => this.setBpm(this.bpm - 2));
    this.$(".upb").addEventListener("click", () => this.setBpm(this.bpm + 2));
    this.playButton.addEventListener("click", () => this.toggle());
    this.$(".tap").addEventListener("click", () => this.tap());
    const soundButton = this.$<HTMLButtonElement>(".snd");
    soundButton.addEventListener("click", () => {
      // the context is created on this click, so the browser lets it play
      if (!this.sound) this.audio ??= createAudioContext();
      this.sound = !this.sound && this.audio !== null;
      soundButton.setAttribute("aria-pressed", String(this.sound));
    });
  }

  protected override init(): void {
    this.applyBpm(this.bpmAttribute(), true, false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // release the audio device; the next beat with Sound on creates a new context
    void this.audio?.close();
    this.audio = null;
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute
    if (this.initialized) this.applyBpm(this.bpmAttribute(), false, false);
  }

  /** The `bpm` attribute, or 96 when it is missing or invalid. */
  private bpmAttribute(): number {
    return this.num("bpm", 96);
  }

  private word(bpm: number): string {
    const match = TEMPI.find(([below]) => bpm < below) ?? TEMPI[TEMPI.length - 1];
    return match[1];
  }

  private statusText(): string {
    return `${this.word(this.bpm)} · ${this.playing ? "playing" : "stopped"}`;
  }

  /**
   * Sets the tempo, rounded and clamped to 40 to 208, and fires `change`. A value that is not a finite number is
   * ignored.
   */
  setBpm(bpm: number): void {
    this.applyBpm(bpm, false, true);
  }

  /** Apply a tempo; on `first` (connect) without the roll. `notify` fires `change`. */
  private applyBpm(value: number, first: boolean, notify: boolean): void {
    if (!Number.isFinite(value)) return;
    const bpm = clamp(Math.round(value), MIN_BPM, MAX_BPM);
    const dir = bpm >= this.bpm ? 1 : -1;
    this.bpm = bpm;
    rollText(this.$(".tn"), this.statusText(), dir, !first);
    roll(this.numeral, String(bpm), dir, !first);
    if (notify) this.emit<{ bpm: number }>("change", { bpm });
    this.kick();
  }

  /** Starts or stops the metronome from beat one. */
  toggle(): void {
    this.playing = !this.playing;
    this.playButton.textContent = this.playing ? "Stop" : "Start";
    if (this.playing) {
      this.phase = 0;
      this.beat = -1;
      void this.audio?.resume();
    }
    rollText(this.$(".tn"), this.statusText(), 1);
    this.kick();
  }

  /** Registers a tap; from the second tap on, the tempo is set from the average interval of the last five taps. */
  tap(): void {
    const time = now();
    // a pause of more than two seconds starts a new measurement
    if (this.taps.length && time - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps.push(time);
    this.taps = this.taps.slice(-5);
    this.flash[0] = 1;
    if (this.taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      this.setBpm(60 / mean);
    }
    this.kick();
  }

  /** Keep the tempo numeral clear of the pendulum arc on narrow layouts. */
  protected override resized(): void {
    this.numeral.style.fontSize = `${Math.round(clamp(this.w / 9, 32, 40))}px`;
  }

  /** A short sine click, higher on the first beat of the bar. */
  private beep(accent: boolean): void {
    if (!this.sound) return;
    this.audio ??= createAudioContext();
    const audio = this.audio;
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    oscillator.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.06);
  }

  protected override render(_t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const w = this.w;
    const h = this.h;
    const px = w / 2;
    const py = h - 22;
    if (this.playing) {
      this.phase += (this.bpm / 60) * dt;
      const beat = Math.floor(this.phase);
      if (beat !== this.beat) {
        this.beat = beat;
        const i = beat % 4;
        this.flash[i] = 1;
        this.beep(i === 0);
        const tipAngle = AMPLITUDE * Math.cos(Math.PI * this.phase);
        const tipX = px + Math.sin(tipAngle) * ARM;
        const tipY = py - Math.cos(tipAngle) * ARM;
        this.sparks.add(tipX, tipY, i === 0 ? 14 : 6, [P.accent, P.shine], { speed: [30, 110] });
      }
      if (still) this.angle = beat % 2 ? AMPLITUDE : -AMPLITUDE;
      else this.angle = AMPLITUDE * Math.cos(Math.PI * this.phase);
    } else {
      this.angle *= Math.exp(-dt * 4);
    }
    this.flash = this.flash.map((f) => Math.max(0, f - dt * 3));

    this.clear();
    for (let k = -10; k <= 10; k++) {
      const a = k * 0.05;
      this.dot(px + Math.sin(a) * (ARM + 10) - 1, py - Math.cos(a) * (ARM + 10) - 1, P.fg, k % 5 === 0 ? 0.5 : 0.2, 2);
    }
    const s = Math.sin(this.angle);
    const c = Math.cos(this.angle);
    for (let d = 6; d <= ARM; d += 5) this.dot(px + s * d - 1.2, py - c * d - 1.2, P.fg, 0.75, 2.4);
    // the sliding weight sits lower at faster tempos
    const weight = lerp(132, 54, (this.bpm - MIN_BPM) / (MAX_BPM - MIN_BPM));
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -2; xx <= 2; xx++) {
        const lx = xx * 4;
        const ly = yy * 4;
        this.dot(px + s * weight + c * lx - s * ly - 1.8, py - c * weight + s * lx - c * ly - 1.8, P.accent, 1, 3.6);
      }
    }
    this.dot(px + s * ARM - 2, py - c * ARM - 2, mix(P.accent, P.shine, 0.6), 1, 4);
    for (let k = -3; k <= 3; k++) this.dot(px + k * 4 - 1.5, py + 4, P.fg, 0.6, 3);

    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 18;
      const f = this.flash[i];
      const on = this.playing && this.beat % 4 === i;
      const color = i === 0 ? mix(P.accent, P.shine, f) : mix(P.fg, P.accent, Math.max(f, on ? 0.5 : 0));
      const alpha = 0.2 + 0.8 * Math.max(f, on ? 0.4 : 0);
      for (let yy = 0; yy < 3; yy++) {
        for (let xx = 0; xx < 3; xx++) this.dot(x + xx * 4, 14 + yy * 4, color, alpha, 3.2);
      }
    }
    const sparking = this.sparks.step(ctx, dt);
    return this.playing || Math.abs(this.angle) > 0.001 || this.flash.some((f) => f > 0) || sparking;
  }
}

define("px-metronome", Metronome);

export { Metronome };

declare global {
  interface HTMLElementTagNameMap {
    "px-metronome": Metronome;
  }
}

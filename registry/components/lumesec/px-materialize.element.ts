/**
 * <px-materialize> · Materializing stream
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/materialize
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-materialize.tsx.
 */
import { PxBase, clamp, css, define, mix, rand, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-materialize>`. */
export interface MaterializeEventMap {
  /** Fires once every word has settled into text. */
  done: CustomEvent<Record<string, never>>;
}

/** Text used when the `text` attribute is missing. */
const DEFAULT_TEXT =
  "Ultracode runs at xhigh effort and lets the agent plan multi-agent workflows on its own, so big tasks fan out across parallel agents.";

/** Line height in px. */
const LINE_HEIGHT = 23;
/** Left and right padding of the text in px. */
const PAD = 4;

/** A particle flying to its pixel of a word. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Target position. */
  tx: number;
  ty: number;
  /** Time the particle starts moving. */
  d: number;
  /** Spring stiffness. */
  k: number;
}

/** A laid-out word and the particles that build it. */
interface StreamWord {
  word: string;
  /** Baseline start of the word. */
  x: number;
  y: number;
  /** Measured width. */
  w: number;
  /** Lit pixels of the word relative to its baseline start. */
  pts: Point[];
  arrived: boolean;
  /** Time the word arrived. */
  t0: number;
  /** Time every particle came to rest, or -1 while they are moving. */
  settleT: number;
  parts: Particle[];
}

/** Streams a sentence word by word, each word condensing from particles sampled from its own glyphs. */
class Materialize extends PxBase {
  static readonly observedAttributes = ["text"] as const;

  private words: StreamWord[] = [];
  /** Index of the next word to stream. */
  private wordIndex = 0;
  private nextAt = 0;
  private finished = false;
  /** Canvas font for the text; set on each restart. */
  private font = "";
  /** Width of the last layout. */
  private layoutWidth = 0;
  /** Scratch canvas the words are sampled from. */
  private sampler: HTMLCanvasElement | null = null;

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 128px; }
      .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; }
      .st { font-size: 12.5px; color: var(--_muted); }
      `,
      `<canvas class="px" role="img"></canvas><div class="bar"><span class="rollslot st" aria-live="polite"></span><button class="pbtn again" type="button">Replay</button></div>`,
    );
    this.$(".again").addEventListener("click", () => this.restart());
  }

  /** The text to stream: the `text` attribute, or the default sentence. */
  get text(): string {
    return this.getAttribute("text")?.trim() || DEFAULT_TEXT;
  }

  set text(value: string) {
    this.setAttribute("text", value);
  }

  attributeChangedCallback(): void {
    // before the first connect, the first layout starts the stream
    if (this.initialized) this.restart();
  }

  protected override init(): void {
    rollText(this.$(".st"), "Waiting", 1, false);
    // the glyphs are sampled from the real font, so wait for it
    document.fonts?.ready?.then(() => this.restart());
  }

  protected override resized(): void {
    if (Math.abs(this.w - this.layoutWidth) > 2) {
      this.layoutWidth = this.w;
      this.restart();
    }
  }

  /** Lays out the current `text` again and replays the stream from the first word. */
  restart(): void {
    const g = this.ctx;
    const canvas = this.cv;
    if (!this.w || !g || !canvas) return;
    const text = this.text;
    this.font = `500 15px ${getComputedStyle(this).fontFamily}`;
    g.font = this.font;
    canvas.setAttribute("aria-label", text);
    const space = g.measureText(" ").width;
    const maxW = this.w - 8;
    let x = PAD;
    let y = 20;
    this.words = text.trim().split(/\s+/).map((word) => {
      const width = g.measureText(word).width;
      if (x + width > maxW && x > PAD) {
        x = PAD;
        y += LINE_HEIGHT;
      }
      const laid: StreamWord = {
        word,
        x,
        y,
        w: width,
        pts: this.sample(word, width),
        arrived: false,
        t0: 0,
        settleT: -1,
        parts: [],
      };
      x += width + space;
      return laid;
    });
    this.wordIndex = 0;
    this.nextAt = this.t + 0.35;
    this.finished = false;
    rollText(this.$(".st"), "Streaming…", 1);
    this.kick();
  }

  /** Lit pixels of `word` on a 2px grid, relative to its baseline start. */
  private sample(word: string, width: number): Point[] {
    this.sampler ??= document.createElement("canvas");
    const sampler = this.sampler;
    const W = Math.ceil(width) + 4;
    const H = 26;
    sampler.width = W;
    sampler.height = H;
    const c = sampler.getContext("2d", { willReadFrequently: true });
    if (!c) return [];
    c.clearRect(0, 0, W, H);
    c.font = this.font;
    c.fillStyle = "#fff";
    c.textBaseline = "alphabetic";
    c.fillText(word, 2, 19);
    const data = c.getImageData(0, 0, W, H).data;
    const pts: Point[] = [];
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (data[(y * W + x) * 4 + 3] > 100) pts.push([x - 2, y - 19]);
      }
    }
    return pts;
  }

  /** Launch the next word's particles from just after the previous word. */
  private launch(t: number, still: boolean): void {
    const word = this.words[this.wordIndex];
    const prev: StreamWord | undefined = this.words[this.wordIndex - 1];
    const hx = prev ? prev.x + prev.w : 4;
    const hy = prev ? prev.y - 6 : 14;
    word.arrived = true;
    word.t0 = t;
    word.parts = [];
    for (const [px, py] of word.pts) {
      const particle: Particle = {
        x: hx + rand(-6, 28),
        y: hy + rand(-14, 12),
        vx: 0,
        vy: 0,
        tx: word.x + px,
        ty: word.y + py,
        d: t + rand(0, 0.12),
        k: rand(130, 210),
      };
      if (still) {
        particle.x = particle.tx;
        particle.y = particle.ty;
      }
      word.parts.push(particle);
    }
    this.wordIndex++;
    this.nextAt = t + 0.06 + word.word.length * 0.012 + Math.random() * 0.06;
  }

  /** Spring a word's particles towards their targets and note when all of them are at rest. */
  private settle(word: StreamWord, t: number, dt: number): void {
    let still = true;
    for (const p of word.parts) {
      if (t < p.d) {
        still = false;
        continue;
      }
      const damping = 2 * Math.sqrt(p.k) * 0.62;
      p.vx += (p.k * (p.tx - p.x) - damping * p.vx) * dt;
      p.x += p.vx * dt;
      p.vy += (p.k * (p.ty - p.y) - damping * p.vy) * dt;
      p.y += p.vy * dt;
      if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.6) still = false;
    }
    if (still && t - word.t0 > 0.3) word.settleT = t;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    if (this.wordIndex < this.words.length && t >= this.nextAt) this.launch(t, reduced());
    this.clear();
    g.font = this.font;
    g.textBaseline = "alphabetic";
    let settled = 0;
    for (const word of this.words) {
      if (!word.arrived) continue;
      if (word.settleT < 0) this.settle(word, t, dt);
      // once at rest, the particles fade into crisp text
      const f = word.settleT < 0 ? 0 : clamp((t - word.settleT) / 0.28, 0, 1);
      if (f < 1) {
        for (const p of word.parts) {
          const speed = Math.min(1, Math.hypot(p.vx, p.vy) / 260);
          this.dot(p.x, p.y, mix(mix(P.accent, P.shine, speed), P.fg, f), (t < p.d ? 0.35 : 0.95) * (1 - f), 1.7);
        }
      } else {
        settled++;
      }
      if (f > 0) {
        g.globalAlpha = f;
        g.fillStyle = css(P.fg);
        g.fillText(word.word, word.x, word.y);
        g.globalAlpha = 1;
      }
    }
    const streaming = this.wordIndex < this.words.length;
    if (streaming || settled < this.words.length) {
      // caret after the last word: solid while streaming, blinking while the last words settle
      const last: StreamWord | undefined = this.words[Math.max(0, this.wordIndex - 1)];
      if (last && (Math.floor(t * 3) % 2 === 0 || streaming)) {
        const x = last.x + last.w + 3;
        this.dot(x, last.y - 13, P.accent, 0.9, 2.4);
        this.dot(x, last.y - 8, P.accent, 0.9, 2.4);
        this.dot(x, last.y - 3, P.accent, 0.9, 2.4);
      }
    }
    if (!this.finished && this.words.length && settled === this.words.length) {
      this.finished = true;
      rollText(this.$(".st"), `Done · ${this.words.length} words`, 1);
      this.emit("done");
    }
    return !this.finished;
  }
}

define("px-materialize", Materialize);

export { Materialize };

declare global {
  interface HTMLElementTagNameMap {
    "px-materialize": Materialize;
  }
}

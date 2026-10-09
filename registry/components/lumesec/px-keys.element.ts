/**
 * <px-keys> · Typing heatmap
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/keys
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-keys.tsx.
 */
import { PxBase, Sparks, css, define, mix, now, rollText } from "@/lib/lumesec/pixel";

/** Detail of the `done` event: words per minute and accuracy as a whole percentage. */
export interface KeysDoneDetail {
  wpm: number;
  accuracy: number;
}

/** Events fired by `<px-keys>`. */
export interface KeysEventMap {
  /** Fires when the typed text matches the target line. `accuracy` is a whole percentage. */
  done: CustomEvent<KeysDoneDetail>;
}

const TARGET = "pixels glow when you type them";

const KB = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

/** Every key on the heatmap: the letters, then the space bar. */
const ALL_KEYS: readonly string[] = [...KB.join(""), "space"];

/** A key's box on the canvas. */
interface KeyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The last press of a key: when, and whether it was the expected character. */
interface KeyFlash {
  t: number;
  ok: boolean;
}

/** Dot pitch and dot size of the key caps. */
const KEY_PITCH = 3.5;
const KEY_DOT = 2.6;

/** Extent of a row of key-cap dots filling `length` px, from the first dot's edge to the last one's. */
const dotSpan = (length: number): number => (Math.ceil(length / KEY_PITCH) - 1) * KEY_PITCH + KEY_DOT;

/**
 * Typing test over a pixel keyboard where each key flashes, ripples to its neighbours, builds heat with use and turns
 * red on a miss.
 */
class Keys extends PxBase {
  /** Heat per key from 0 to 1, built up by presses. */
  private readonly heat = new Map<string, number>();
  private readonly flash = new Map<string, KeyFlash>();
  /** Keystrokes counted. */
  private keystrokes = 0;
  /** Keystrokes that matched the target. */
  private correct = 0;
  /** Time of the first keystroke, or null before it. */
  private startTime: number | null = null;
  private readonly sparks = new Sparks();
  /** The host's font stack for the key labels, read on layout. */
  private sans = "sans-serif";
  private readonly input = this.$<HTMLInputElement>(".in");

  constructor() {
    super(
      `
      :host { display: block; }
      .target { font-family: var(--_mono); font-size: 15px; line-height: 1.5; margin: 0 0 10px; letter-spacing: .02em; word-break: break-word; }
      .target span { color: var(--_muted); }
      .target .ok { color: var(--_fg); }
      .target .bad { color: var(--_danger); text-decoration: underline; }
      .target .cur { box-shadow: inset 0 -2px 0 var(--_accent); }
      .in { width: 100%; height: 36px; border-radius: 9px; border: 1px solid var(--_border); background: var(--_surface); padding: 0 12px; font-family: var(--_mono); font-size: 13.5px; }
      .in:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
      canvas.px { height: 104px; margin-top: 12px; }
      .bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 10px; }
      .st { font-size: 12.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      :host([data-done]) .st { color: var(--_ok); font-weight: 500; }
      `,
      `<p class="target"><span class="sr" id="line">Type this: ${TARGET}</span><span class="chars" aria-hidden="true"></span></p><input class="in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the line above" aria-label="Typing test" aria-describedby="line">
        <canvas class="px" role="img" aria-label="Keyboard heatmap"></canvas><div class="bar"><span class="rollslot st"></span><button class="pbtn again" type="button">Reset</button></div><span class="sr result" aria-live="polite"></span>`,
    );
    const input = this.input;
    input.addEventListener("keydown", (e) => {
      if (e.key.length !== 1 || this.dataset.done != null) return;
      const key = e.key.toLowerCase();
      const expected = TARGET[input.value.length];
      this.startTime ??= now();
      this.keystrokes++;
      const ok = e.key === expected;
      if (ok) this.correct++;
      this.press(key === " " ? "space" : key, ok);
    });
    input.addEventListener("input", (e) => {
      // the native event stays inside the shadow root
      e.stopPropagation();
      this.update();
    });
    this.$(".again").addEventListener("click", () => this.reset());
  }

  protected override init(): void {
    this.update();
  }

  /** Clears the input, the timer, the score and the key heat, makes the field editable again and focuses it. */
  reset(): void {
    const input = this.input;
    input.value = "";
    input.readOnly = false;
    delete this.dataset.done;
    this.keystrokes = 0;
    this.correct = 0;
    this.startTime = null;
    this.heat.clear();
    this.$(".result").textContent = "";
    this.update();
    input.focus();
    this.kick();
  }

  protected override resized(): void {
    this.sans = getComputedStyle(this).fontFamily || "sans-serif";
  }

  /** The box of a key, or null for keys not on the heatmap. */
  private keyRect(key: string): KeyRect | null {
    const kw = Math.min(26, (this.w - 8) / 10);
    const kh = 22;
    const ox = (this.w - kw * 10) / 2;
    if (key === "space") return { x: ox + kw * 2.5, y: 3 * (kh + 4), w: kw * 5 - 4, h: kh - 4 };
    for (let r = 0; r < 3; r++) {
      const i = KB[r].indexOf(key);
      // each row is staggered a little to the right of the one above
      if (i >= 0) return { x: ox + i * kw + r * kw * 0.45, y: r * (kh + 4), w: kw - 4, h: kh - 4 };
    }
    return null;
  }

  private press(key: string, ok: boolean): void {
    if (!this.keyRect(key)) return;
    this.heat.set(key, Math.min(1, (this.heat.get(key) ?? 0) + 0.4));
    this.flash.set(key, { t: now(), ok });
    this.kick();
  }

  /** Re-render the target line and the score; celebrate when the line is complete. */
  private update(): void {
    const value = this.input.value;
    // one span per character, coloured by what was typed; assistive technology reads the line in one piece
    const chars = [...TARGET].map((ch, i) => {
      const span = document.createElement("span");
      span.textContent = ch;
      if (i < value.length) span.className = value[i] === ch ? "ok" : "bad";
      else if (i === value.length) span.className = "cur";
      return span;
    });
    this.$(".chars").replaceChildren(...chars);
    const minutes = this.startTime == null ? 0 : (now() - this.startTime) / 60;
    // five characters count as a word
    const wpm = minutes > 0.02 ? Math.round(this.correct / 5 / minutes) : 0;
    const accuracy = this.keystrokes ? Math.round((this.correct / this.keystrokes) * 100) : 100;
    if (value === TARGET) {
      this.dataset.done = "";
      // read-only rather than disabled, so the field keeps focus
      this.input.readOnly = true;
      rollText(this.$(".st"), `${wpm} WPM · ${accuracy}% accuracy`, 1);
      // the score is announced once, at the end, rather than after every keystroke
      this.$(".result").textContent = `Done: ${wpm} words per minute, ${accuracy}% accuracy`;
      const P = this.P;
      for (let k = 0; k < 6; k++) {
        this.sparks.add((this.w * (k + 0.5)) / 6, 50, 12, [P.accent, P.shine, P.ok], { speed: [40, 170] });
      }
      this.emit<KeysDoneDetail>("done", { wpm, accuracy });
      this.kick();
    } else {
      const text = this.startTime == null ? "Start typing to begin" : `${wpm} WPM · ${accuracy}%`;
      rollText(this.$(".st"), text, 1, this.startTime != null);
    }
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    let busy = false;
    this.clear();
    ctx.font = `500 11px ${this.sans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // cap height of the label font, to centre the letters on their keys
    const capHeight = ctx.measureText("H").actualBoundingBoxAscent;
    for (const key of ALL_KEYS) {
      const rect = this.keyRect(key);
      if (!rect) continue;
      const flash = this.flash.get(key);
      const flashAmount = flash ? Math.max(0, 1 - (t - flash.t) / 0.45) : 0;
      if (flashAmount > 0) busy = true;
      // presses send a ring outwards that brightens the neighbouring keys
      let ripple = 0;
      for (const [other, otherFlash] of this.flash) {
        const age = t - otherFlash.t;
        if (age > 0.6 || other === key) continue;
        const source = this.keyRect(other);
        if (!source) continue;
        const d = Math.hypot(rect.x - source.x, rect.y - source.y);
        ripple = Math.max(ripple, Math.exp(-((d - age * 160) ** 2) / 160) * (1 - age / 0.6));
      }
      if (ripple > 0.01) busy = true;
      const heat = this.heat.get(key) ?? 0;
      const base = mix(P.fg, P.accent, Math.min(1, heat * 1.2));
      let color = base;
      if (flash && flashAmount > 0) color = flash.ok ? mix(P.accent, P.shine, flashAmount) : P.danger;
      const alpha = 0.1 + heat * 0.6 + flashAmount * 0.6 + ripple * 0.35;
      for (let yy = 0; yy < rect.h; yy += KEY_PITCH) {
        for (let xx = 0; xx < rect.w; xx += KEY_PITCH) this.dot(rect.x + xx, rect.y + yy, color, alpha, KEY_DOT);
      }
      if (key !== "space") {
        ctx.globalAlpha = 0.8 + flashAmount * 0.2;
        ctx.fillStyle = css(P.fg);
        ctx.fillText(key.toUpperCase(), rect.x + dotSpan(rect.w) / 2, rect.y + (dotSpan(rect.h) + capHeight) / 2);
      }
    }
    const sparking = this.sparks.step(ctx, dt);
    return busy || sparking;
  }
}

define("px-keys", Keys);

export { Keys };

declare global {
  interface HTMLElementTagNameMap {
    "px-keys": Keys;
  }
}

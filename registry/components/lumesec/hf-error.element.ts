/**
 * <hf-error> · Error state
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/error
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-error.tsx.
 */
import {
  HF,
  bayer,
  boxMapper,
  clamp,
  css,
  define,
  ease3,
  h2,
  localPoint,
  mix,
  now,
  reduced,
  rrSdf,
  smooth,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-error>`. */
export interface HErrorEventMap {
  /** Try again was pressed. */
  retry: CustomEvent<Record<string, never>>;
  /** Go home was pressed. */
  home: CustomEvent<Record<string, never>>;
}

/** Title and message per built-in code, keyed in lower case. A Map, so codes such as `constructor` are not found. */
const MESSAGES = new Map<string, readonly [title: string, message: string]>([
  [
    "404",
    ["This page drifted off the grid", "The link may be old, or the page moved. Check the address or head back home."],
  ],
  ["500", ["Something broke on our side", "We’ve been alerted and are on it. Trying again usually works."]],
  ["offline", ["You’re offline", "We’ll reconnect automatically when your network is back."]],
]);

const FALLBACK_MESSAGE: readonly [title: string, message: string] = ["Something went wrong", "Please try again."];

/** Error state: the code is set in large mono type over a dotted scanline halo that glitches now and then. */
class HError extends HF {
  /** Pointer position over the canvas, or null. */
  private pointer: Point | null = null;
  /** Start of the scatter-and-reassemble animation. */
  private assembleAt = -9;
  private readonly canvas = this.$("canvas");
  /** The code as text; the accessible value. */
  private readonly codeText = this.$(".cv");
  /** A copy of the code that shows the slice torn sideways during a glitch. */
  private readonly sliceText = this.$(".sl");

  static get observedAttributes(): readonly string[] {
    return ["code"];
  }

  constructor() {
    super(
      `
      :host { display: block; text-align: center; }
      .st { position: relative; height: 128px; }
      canvas.px { position: absolute; inset: 0; height: 100%; touch-action: pan-y; }
      .code { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; pointer-events: none; font-family: var(--_mono); font-size: 56px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; text-transform: uppercase; color: var(--c, var(--_accent)); }
      .code.long { font-size: 40px; }
      .cv, .sl { grid-area: 1 / 1; white-space: nowrap; }
      .sl { visibility: hidden; }
      h3 { margin: 6px 0 4px; font-size: 16px; font-weight: 650; }
      p { margin: 0 auto 14px; max-width: 40ch; font-size: 13px; color: var(--_muted); line-height: 1.5; }
      .ac { display: flex; gap: 8px; justify-content: center; }
      .ac button { height: 36px; padding: 0 14px; border-radius: 9px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); font-size: 13px; font-weight: 600; cursor: pointer; }
      .ac .pri { background: var(--_accent); border-color: transparent; color: var(--_on-accent); }
      `,
      `<div class="st"><canvas class="px" aria-hidden="true"></canvas><div class="code"><span class="sr">Error </span><span class="cv"></span><span class="sl" aria-hidden="true"></span></div></div><h3></h3><p></p><div class="ac"><button type="button" class="pri rt">Try again</button><button type="button" class="hm">Go home</button></div>`,
      3,
      0.74,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this.pointer = localPoint(canvas, e);
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
    });
    this.$(".rt").addEventListener("click", () => {
      this.assembleAt = now();
      this.emit("retry");
      this.kick();
    });
    this.$(".hm").addEventListener("click", () => this.emit("home"));
  }

  /** A new `code` updates the text and replays the assembly. */
  attributeChangedCallback(): void {
    if (this.initialized) {
      this.init();
      this.assembleAt = now();
      this.kick();
    }
  }

  private get errorCode(): string {
    return this.getAttribute("code") || "404";
  }

  protected override init(): void {
    const code = this.errorCode;
    const [title, message] = MESSAGES.get(code.toLowerCase()) ?? FALLBACK_MESSAGE;
    this.$("h3").textContent = title;
    this.$("p").textContent = message;
    this.codeText.textContent = code;
    this.sliceText.textContent = code;
    const block = this.$(".code");
    block.classList.toggle("long", code.length > 3);
    const upper = code.toUpperCase();
    block.style.setProperty(
      "--c",
      upper === "500" ? "var(--_danger)" : upper === "OFFLINE" ? "var(--_muted)" : "var(--_accent)",
    );
  }

  /** The code's colour: danger for 500, muted for offline, the accent otherwise. */
  private get mainColor(): RGB {
    const upper = this.errorCode.toUpperCase();
    return upper === "500" ? this.P.danger : upper === "OFFLINE" ? this.P.muted : this.P.accent;
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const C = F.cols;
    const R = F.rows;
    const pp = F.pitch;
    // glitches grow as the pointer nears the horizontal centre
    const pointer = this.pointer;
    const near = pointer ? clamp(1 - Math.abs(pointer[0] - this.w / 2) / (this.w / 2), 0, 1) : 0;
    const burst = R0 ? 0 : (Math.sin(t * 1.3) > 0.94 ? 1 : 0) + near * 0.6;
    const assemble = R0 ? 1 : clamp((t - this.assembleAt) / 0.9, 0, 1);
    const main = this.mainColor;
    // the halo keeps clear of the text box, so the code stays legible
    const box = boxMapper(this.canvas)(this.codeText);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const halfW = box.w / 2 + 10;
    const halfH = box.h / 2 + 4;
    const rx = box.w / 2 + 90;
    const ry = 54;
    F.clear();
    // scanlines: every other row of cells
    for (let j = 0; j < R; j += 2) {
      // slices of three rows shift sideways during a burst
      const slice = Math.floor(j / 3);
      const off = burst > 0 ? Math.round((h2(slice, Math.floor(t * 12)) - 0.5) * 8 * burst) : 0;
      for (let i = 0; i < C; i++) {
        const si = i - off;
        const [x, y] = F.xy(si, j);
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const falloff = Math.exp(-(dx * dx + dy * dy) * 2.2);
        if (falloff < 0.03) continue;
        const clear = smooth(-10, 8, rrSdf(x, y, cx, cy, halfW, halfH, 8));
        const f = falloff * (0.12 + 0.88 * clear);
        if (bayer(si, j) > f * 0.8) continue;
        let px = (i + 0.5) * pp;
        let py = (j + 0.5) * pp;
        if (assemble < 1) {
          // scattered dots fly back into place
          const k = 1 - ease3(clamp(assemble * 1.3 - h2(i, j) * 0.3, 0, 1));
          px += (h2(i, j) - 0.5) * 300 * k;
          py += (h2(j, i) - 0.5) * 160 * k;
        }
        F.plot(px, py, mix(main, P.shine, (j / R) * 0.4), 0.3 + 0.55 * f, 0.2 + burst * 0.4);
        // chromatic ghosts
        if (burst > 0) {
          F.plot(px - 2 * pp, py, P.danger, 0.4, 0.2);
          F.plot(px + 2 * pp, py, P.ok, 0.4, 0.2);
        }
      }
    }
    this.flush(0.85, 5);
    this.styleText(t, burst, assemble);
    return !R0;
  }

  /** Glitch and assembly on the text: a jitter, colour fringes, a torn slice, and a blur-in after Try again. */
  private styleText(t: number, burst: number, assemble: number): void {
    const P = this.P;
    const text = this.codeText;
    const slice = this.sliceText;
    const frame = Math.floor(t * 12);
    const settle = ease3(assemble);
    const jitter = burst > 0 ? (h2(frame, 3) - 0.5) * 6 * burst : 0;
    text.style.transform = `translateX(${jitter.toFixed(1)}px) scale(${(1 + (1 - settle) * 0.06).toFixed(3)})`;
    text.style.opacity = assemble < 1 ? smooth(0.25, 1, assemble).toFixed(3) : "";
    text.style.filter = assemble < 1 ? `blur(${((1 - settle) * 6).toFixed(1)}px)` : "";
    const fringe = (2 + 2 * burst).toFixed(1);
    const shadow = burst > 0 ? `-${fringe}px 0 ${css(P.danger, 0.55)}, ${fringe}px 0 ${css(P.ok, 0.55)}` : "none";
    text.style.textShadow = shadow;
    if (burst > 0 && assemble >= 1) {
      // one band of the code is cut out and drawn shifted by the copy
      const top = Math.round(h2(frame, 11) * 70);
      const bottom = top + 16;
      text.style.clipPath = `polygon(0 0, 100% 0, 100% ${top}%, 0 ${top}%, 0 ${bottom}%, 100% ${bottom}%, 100% 100%, 0 100%)`;
      slice.style.visibility = "visible";
      slice.style.clipPath = `inset(${top}% 0 ${100 - bottom}% 0)`;
      slice.style.transform = `translateX(${((h2(frame, 5) - 0.5) * 22 * burst).toFixed(1)}px)`;
      slice.style.textShadow = shadow;
    } else {
      text.style.clipPath = "";
      slice.style.visibility = "";
    }
  }
}

define("hf-error", HError);

export { HError };

declare global {
  interface HTMLElementTagNameMap {
    "hf-error": HError;
  }
}

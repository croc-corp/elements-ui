/**
 * <hf-compare> · Before and after
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/compare
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-compare.tsx.
 *
 * Demo data: The document and its personal data are invented; nothing can be set. It cannot show your own data
 * yet; use it as a template and replace the invented data before it shows anything real.
 */
import { HF, bayer, clamp, define, h2, mix, reduced, segDist, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-compare>`. */
export interface HCompareEventMap {
  /** The divider moved, from 0 (left) to 1 (right). Also fires once on connect with the start position. */
  input: CustomEvent<{ position: number }>;
}

/** A word of the mock document: left edge and width as fractions of the width, top in px, personal data or not. */
interface DocWord {
  x: number;
  y: number;
  w: number;
  p: boolean;
}

/** Divider steps per key; Home and End overshoot and are clamped. */
const STEP_KEYS: Partial<Record<string, number>> = { ArrowLeft: -0.05, ArrowRight: 0.05, Home: -1, End: 1 };

/** Park–Miller generator: the same seed gives the same sequence in `(0, 1)`. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Before-and-after slider over a mock document: personal data is highlighted on the left, blacked out on the right. */
class HCompare extends HF {
  /** Divider position, 0..1. */
  private position = 0.55;
  /** Drawn divider position, easing after {@link HCompare.position}. */
  private shownPosition = 0.55;
  private dragging = false;
  /** 1 while the pointer is over the image; the knob grows. */
  private hover = 0;
  private doc: DocWord[] = [];
  private readonly handle = this.$(".h");

  constructor() {
    super(
      `
      :host { display: block; }
      .w { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--_border); touch-action: pan-y; cursor: ew-resize; }
      canvas.px { height: 236px; }
      .lb { position: absolute; top: 10px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; background: rgba(10,10,20,.6); color: #fff; pointer-events: none; }
      .lb.a { left: 10px; } .lb.b { right: 10px; }
      .h { position: absolute; top: 0; bottom: 0; width: 44px; margin-left: -22px; cursor: ew-resize; }
      .h:focus-visible { outline: 2px solid var(--_accent); outline-offset: -8px; border-radius: 12px; }
      `,
      `<div class="w"><canvas class="px" role="img"></canvas><span class="lb a">Original</span><span class="lb b">Redacted</span><div class="h" tabindex="0" role="slider" aria-label="Compare position" aria-valuemin="0" aria-valuemax="100"></div></div>`,
      2,
      0.72,
    );
    const area = this.$(".w");
    const at = (e: PointerEvent): number => {
      const r = area.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    area.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      area.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.position = at(e);
      this.sync();
    });
    area.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.position = at(e);
      this.sync();
    });
    const up = (): void => {
      this.dragging = false;
      this.kick();
    };
    area.addEventListener("pointerup", up);
    area.addEventListener("pointercancel", up);
    area.addEventListener("pointerenter", () => {
      this.hover = 1;
      this.kick();
    });
    area.addEventListener("pointerleave", () => {
      this.hover = 0;
      this.kick();
    });
    this.handle.addEventListener("keydown", (e) => {
      const step = STEP_KEYS[e.key];
      if (step == null) return;
      e.preventDefault();
      this.position = clamp(this.position + step, 0, 1);
      this.sync();
    });
  }

  protected override init(): void {
    // nine lines of seeded words; a few of them are personal data
    const rnd = seededRandom(3);
    const pii = new Set([1, 5, 9, 14, 20]);
    this.doc = [];
    let y = 52;
    let n = 0;
    for (let line = 0; line < 9; line++, y += 17) {
      let x = 0.06;
      while (x < 0.94) {
        const w = 0.04 + rnd() * 0.1;
        if (x + w > 0.94) break;
        this.doc.push({ x, y, w, p: pii.has(n) || (line === 7 && n % 3 === 0) });
        x += w + 0.015;
        n++;
      }
    }
    this.$("canvas").setAttribute("aria-label", "Document before and after redaction");
    this.sync();
  }

  /** Move the handle and fire `input`. */
  private sync(): void {
    const handle = this.handle;
    handle.style.left = `${this.position * 100}%`;
    handle.setAttribute("aria-valuenow", String(Math.round(this.position * 100)));
    this.emit<{ position: number }>("input", { position: this.position });
    this.kick();
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const W = this.w;
    const H = this.h;
    const dark = this.dark;
    this.shownPosition += (this.position - this.shownPosition) * Math.min(1, R0 ? 1 : dt * 16);
    const sx = this.shownPosition * W;
    const paper: RGB = dark ? [38, 37, 35] : [252, 252, 250];
    const ink: RGB = dark ? [150, 148, 142] : [120, 118, 112];
    const heading: RGB = dark ? [220, 218, 212] : [40, 38, 36];
    const blackout: RGB = dark ? [8, 8, 10] : [20, 20, 24];
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const after = x > sx;
        let col = paper;
        let g = 0;
        if (y > 18 && y < 34 && x > W * 0.06 && x < W * 0.46) col = heading;
        for (const d of this.doc) {
          const x0 = d.x * W;
          const x1 = x0 + d.w * W;
          if (x < x0 || x > x1 || y < d.y || y > d.y + 7) continue;
          if (!d.p) {
            col = bayer(i, j) < 0.7 ? ink : paper;
          } else if (after) {
            // blacked out, with a faint accent strike
            col = blackout;
            if (Math.abs(y - (d.y + 3.5)) < 1 && h2(i, 1) < 0.5) col = P.accent;
          } else {
            // highlighted, with solid top and bottom edges
            col = mix(P.danger, paper, bayer(i, j) < 0.6 ? 0.2 : 0.7);
            if (y < d.y + 1 || y > d.y + 6) {
              col = P.danger;
              g = 0.3;
            }
          }
        }
        // a signature scribble that the redacted side removes
        if (y > 210 && y < 216 && x > W * 0.06 && x < W * 0.3) {
          col = after ? paper : Math.sin(x * 0.3) > 0 ? ink : paper;
        }
        if (Math.abs(x - sx) < 1.6) {
          col = dark ? [255, 255, 255] : P.fg;
          g = 0.6;
        }
        F.put(i, j, col, 1, g);
      }
    }
    // handle knob with two arrows
    const cy = H / 2;
    const rr = 15 + this.hover * 2;
    for (let j = Math.floor((cy - rr - 2) / pp); j <= (cy + rr + 2) / pp; j++) {
      for (let i = Math.floor((sx - rr - 2) / pp); i <= (sx + rr + 2) / pp; i++) {
        const [x, y] = F.xy(i, j);
        const d = Math.hypot(x - sx, y - cy);
        if (d > rr) continue;
        // a chevron pointing each way
        const arrow = [-1, 1].some((s) => {
          const ax = (x - sx) * s;
          return Math.min(segDist(ax, y - cy, 3, -4.5, 7.5, 0), segDist(ax, y - cy, 7.5, 0, 3, 4.5)) < 1.3;
        });
        const rim = d > rr - 1.8;
        F.put(i, j, arrow ? P.surface : rim ? mix(P.accent, P.shine, 0.4) : P.accent, 1, rim ? 0.6 : 0.2);
      }
    }
    this.flush(0.8, 4);
    return Math.abs(this.position - this.shownPosition) > 0.0005 || this.dragging;
  }
}

define("hf-compare", HCompare);

export { HCompare };

declare global {
  interface HTMLElementTagNameMap {
    "hf-compare": HCompare;
  }
}

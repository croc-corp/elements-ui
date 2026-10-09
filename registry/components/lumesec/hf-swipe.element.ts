/**
 * <hf-swipe> · Slide to confirm
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/swipe
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-swipe.tsx.
 */
import {
  HF,
  Sparks,
  bayer,
  clamp,
  css,
  define,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  segDist,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-swipe>`. */
export interface HSwipeEventMap {
  /**
   * Fires once when the handle reaches the end, when it is released past 94% of the track, or when `confirm()` is
   * called.
   */
  confirm: CustomEvent<Record<string, never>>;
}

type SwipeState = "idle" | "done";

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** Size of the square handle and its inset from the track edge, in pixels. */
const THUMB = 48;
const INSET = 5;

const DEFAULT_HINT = "Drag the handle all the way, or hold Enter";

/**
 * Slide-to-confirm track for deliberate actions: the handle must reach the end, keyboard users hold Enter, and it
 * re-arms after a delay.
 */
class HSwipe extends HF {
  static readonly observedAttributes = ["label", "hint", "done-label", "done-hint"] as const;

  /** Handle offset in pixels from the start of its travel. */
  private x = 0;
  /** Handle velocity of the spring back, px/s. */
  private vx = 0;
  private drag = false;
  /** True while Enter, Space or ArrowRight is held; the handle slides on its own. */
  private keyHold = false;
  private state: SwipeState = "idle";
  /** Time the current state began. */
  private t0 = -9;
  private readonly sparks = new Sparks();
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .tr { position: relative; height: 58px; border-radius: 17px; background: var(--_track); touch-action: none; -webkit-user-select: none; user-select: none; }
      canvas.px { position: absolute; inset: 0; height: 100%; border-radius: 17px; }
      .th { position: absolute; top: 5px; left: 5px; width: 48px; height: 48px; border-radius: 13px; border: 0; padding: 0; background: transparent; cursor: grab; }
      .th:active { cursor: grabbing; }
      .lb { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-left: 52px; overflow: hidden; pointer-events: none; white-space: nowrap; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; opacity: var(--fade, 1);
        -webkit-mask-image: linear-gradient(90deg, transparent calc(var(--hx, 5px) + 52px), #000 calc(var(--hx, 5px) + 102px)); mask-image: linear-gradient(90deg, transparent calc(var(--hx, 5px) + 52px), #000 calc(var(--hx, 5px) + 102px)); }
      .lt { justify-items: center; }
      .lt .roll { color: transparent; background: linear-gradient(90deg, var(--_muted) 0 40%, var(--_fg) 50%, var(--_muted) 60% 100%) 100% 0 / 300% 100% no-repeat; -webkit-background-clip: text; background-clip: text; animation: sheen 2.9s linear infinite; }
      @keyframes sheen { from { background-position: 100% 0; } to { background-position: 0 0; } }
      .tr.done .lb { opacity: 1; -webkit-mask-image: none; mask-image: none; }
      .tr.done .lt .roll { background: none; color: var(--done-ink, #fff); animation: none; }
      @media (prefers-reduced-motion: reduce) { .lt .roll { animation: none; } }
      .hint { display: grid; font-size: 12px; color: var(--_muted); margin-top: 8px; }
      `,
      `<div class="tr"><canvas class="px" aria-hidden="true"></canvas><span class="lb" aria-hidden="true"><span class="rollslot lt"></span></span><button class="th" type="button"></button></div><span class="rollslot hint"></span><span class="sr" aria-live="polite"></span>`,
      2,
      0.72,
    );
    const thumb = this.$("button");
    const track = this.$(".tr");
    // pointer offset inside the handle while dragging
    let grabX = 0;
    thumb.addEventListener("pointerdown", (e) => {
      if (this.state === "done" || e.button !== 0) return;
      try {
        thumb.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; dragging works without capture
      }
      this.drag = true;
      const [x] = localPoint(track, e);
      grabX = x - this.x;
      this.kick();
    });
    thumb.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const [x] = localPoint(track, e);
      this.x = clamp(x - grabX, 0, this.maxX);
      if (this.x >= this.maxX - 1) this.confirm();
      this.kick();
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = false;
      if (this.x > this.maxX * 0.94) this.confirm();
      this.kick();
    };
    thumb.addEventListener("pointerup", up);
    thumb.addEventListener("pointercancel", up);
    thumb.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " " || e.key === "ArrowRight") && this.state !== "done") {
        e.preventDefault();
        this.keyHold = true;
        this.kick();
      }
    });
    const release = (): void => {
      this.keyHold = false;
      this.kick();
    };
    thumb.addEventListener("keyup", release);
    thumb.addEventListener("blur", release);
  }

  /** Travel of the handle in pixels. */
  private get maxX(): number {
    return Math.max(1, this.w - 58);
  }

  /** The `label` attribute, or `Slide to deploy`. */
  get label(): string {
    return this.getAttribute("label") || "Slide to deploy";
  }

  private get hintText(): string {
    return this.getAttribute("hint") || DEFAULT_HINT;
  }

  private get doneLabel(): string {
    return this.getAttribute("done-label") || "Deployed";
  }

  private get doneHint(): string {
    return this.getAttribute("done-hint") || "Deploy started · production";
  }

  protected override init(): void {
    this.syncText(false);
  }

  attributeChangedCallback(): void {
    if (this.initialized) this.syncText(false);
  }

  /** The handle's label and the texts for the current state; `animate` rolls them. */
  private syncText(animate: boolean, dir = 1): void {
    const done = this.state === "done";
    this.$("button").setAttribute("aria-label", `${this.label}. Press and hold Enter to confirm.`);
    rollText(this.$(".lt"), done ? this.doneLabel : this.label, dir, animate);
    rollText(this.$(".hint"), done ? this.doneHint : this.hintText, dir, animate);
  }

  /** Confirms at once, as if the handle had reached the end. Does nothing if already confirmed. */
  confirm(): void {
    if (this.state === "done") return;
    this.state = "done";
    this.t0 = now();
    this.drag = false;
    this.keyHold = false;
    const P = this.P;
    this.sparks.add(this.w - 29, 29, 34, [P.ok, P.shine, WHITE], { speed: [50, 200], life: [0.35, 0.8] });
    this.$(".tr").classList.add("done");
    this.syncText(true);
    this.$(".sr").textContent = this.doneLabel;
    this.emit("confirm");
    const resetMs = this.num("reset", 2800);
    if (resetMs > 0) {
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.reset(), resetMs);
    }
    this.kick();
  }

  /** Returns to the idle state and restores `hint`. */
  reset(): void {
    clearTimeout(this.resetTimer);
    this.state = "idle";
    this.t0 = now();
    this.$(".tr").classList.remove("done");
    this.syncText(true, -1);
    // cleared, so the next confirmation is announced again
    this.$(".sr").textContent = "";
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const pitch = F.pitch;
    const W = this.w;
    const H = this.h;
    const mx = this.maxX;
    const done = this.state === "done";
    // under reduced motion the handle jumps to the end, so it cannot stay behind on a zero-length first frame
    if (done) this.x = reducedMotion ? mx : this.x + (mx - this.x) * Math.min(1, dt * 14);
    else if (this.keyHold) {
      this.x = Math.min(mx, this.x + dt * mx * 0.9);
      if (this.x >= mx - 0.5) this.confirm();
    } else if (!this.drag) {
      // spring back to the start
      if (reducedMotion) {
        this.x = 0;
        this.vx = 0;
      } else {
        const k = 220;
        const damping = 2 * Math.sqrt(k) * 0.75;
        this.vx += (k * (0 - this.x) - damping * this.vx) * dt;
        this.x += this.vx * dt;
      }
    }
    this.$("button").style.transform = `translateX(${this.x}px)`;
    const u = this.x / mx;
    const age = t - this.t0;
    const okF = done ? (reducedMotion ? 1 : clamp(age * 3, 0, 1)) : 0;
    const thX = this.x + INSET;
    // the label is text with a CSS sheen; it fades out ahead of the handle through a mask that follows it
    const label = this.$(".lb");
    label.style.setProperty("--hx", `${thX.toFixed(1)}px`);
    label.style.setProperty("--fade", (1 - u * 0.8).toFixed(3));
    // the confirm fill is dithered over the track, so a light theme needs dark ink on it
    label.style.setProperty("--done-ink", this.dark ? "#fff" : css(mix(P.ok, BLACK, 0.55)));
    F.clear();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const [x, y] = F.xy(i, j);
        // rounded track corners
        const lx = Math.min(x, W - x);
        const ly = Math.min(y, H - y);
        const r2 = 17;
        if (lx < r2 && ly < r2 && Math.hypot(r2 - lx, r2 - ly) > r2) continue;
        // trail fill behind the thumb
        if (x < thX + 24 && (u > 0.002 || done)) {
          const f = x / Math.max(1, thX + 24);
          const dens = done ? 0.6 : 0.18 + 0.6 * f * f;
          if (bayer(i, j) < dens) {
            F.put(
              i,
              j,
              done ? mix(P.ok, P.shine, (1 - okF) * 0.5) : mix(P.accent, P.shine, f * 0.4),
              done ? 0.85 : 0.5 + 0.5 * f,
              (done ? 0.25 : f * 0.3) * (1 - Math.abs(y - H / 2) / H),
            );
          }
        }
      }
    }
    // thumb
    const tx = thX;
    const ty = INSET;
    const rr = 13;
    for (let j = Math.floor(ty / pitch); j < (ty + THUMB) / pitch; j++) {
      for (let i = Math.floor(tx / pitch); i < (tx + THUMB) / pitch; i++) {
        const [x, y] = F.xy(i, j);
        const lx = x - tx;
        const ly = y - ty;
        const qx = Math.max(rr - lx, lx - (THUMB - rr), 0);
        const qy = Math.max(rr - ly, ly - (THUMB - rr), 0);
        if (Math.hypot(qx, qy) > rr) continue;
        const cx = lx - THUMB / 2;
        const cy = ly - THUMB / 2;
        // a check once confirmed, two chevrons before
        const glyph = done
          ? Math.min(segDist(cx, cy, -8, 0, -2.5, 6), segDist(cx, cy, -2.5, 6, 9, -6)) < 2
          : [-4, 4].some((o) => Math.min(segDist(cx, cy, o - 4, -7, o + 3, 0), segDist(cx, cy, o + 3, 0, o - 4, 7)) < 1.6);
        const base = done ? P.ok : P.accent;
        const lit = 0.86 + 0.14 * clamp((-cx - cy) / 24, -1, 1);
        F.put(
          i,
          j,
          glyph ? (done ? WHITE : P.surface) : mix(base, WHITE, (lit - 0.86) * 2 + (this.dark ? 0.1 : 0)),
          1,
          glyph ? 0.2 : 0.18 + u * 0.4,
        );
      }
    }
    this.flush(0.85, 5);
    const ctx = this.ctx;
    const sparking = ctx ? this.sparks.step(ctx, dt) : false;
    // the sheen runs in CSS, so the canvas rests once the handle and the confirm fill have settled
    const moving = done ? Math.abs(mx - this.x) > 0.2 || okF < 1 : Math.abs(this.x) > 0.2 || Math.abs(this.vx) > 0.2;
    return this.drag || this.keyHold || moving || sparking;
  }
}

define("hf-swipe", HSwipe);

declare global {
  interface HTMLElementTagNameMap {
    "hf-swipe": HSwipe;
  }
}

export { HSwipe };

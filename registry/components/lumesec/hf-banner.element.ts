/**
 * <hf-banner> · Announcement
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/banner
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-banner.tsx.
 */
import { HF, bayer, clamp, define, h2, inRR, lerp, mix, now, reduced, type RGB } from "@/lib/lumesec/pixel";

/** Colour scheme: `ok` (green) or `warn` (amber); without `variant` the accent colour is used. */
export type HBannerVariant = "ok" | "warn";

/** Events fired by `<hf-banner>`. */
export interface HBannerEventMap {
  /** Fires when the action button is clicked. */
  action: CustomEvent<Record<string, never>>;
  /**
   * Fires when the disintegration ends and the collapse begins: about 0.95 s after dismissing, or at once with
   * reduced motion.
   */
  dismiss: CustomEvent<Record<string, never>>;
}

const WHITE: RGB = [255, 255, 255];

/** The canvas overhangs the banner by this much on the left, top and bottom (and 72px on the right). */
const OVERHANG = 24;
const RADIUS = 12;
/** Seconds each dot flies before it fades out. */
const FLIGHT = 0.62;

/**
 * Announcement banner on a dithered gradient with a passing sheen; dismissing breaks it into dots that blow away
 * before it collapses.
 */
class HBanner extends HF {
  /** It also draws on the canvas outside the field, so every flush redraws the whole canvas. */
  protected override partialFlush = false;

  static observedAttributes = ["action", "variant"];

  /** `in` while shown (and materialising), `out` once dismissed. */
  private state: "in" | "out" = "in";
  /** Time of the last show or dismiss. */
  private t0 = now();
  private goneTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .col { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .45s cubic-bezier(.2,.8,.2,1); }
      :host([data-gone]) .col { grid-template-rows: 0fr; }
      .clip { min-height: 0; }
      :host([data-gone]) .clip { overflow: hidden; }
      .bn { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 10px 12px 46px; border-radius: 12px; --c: var(--_accent); }
      :host([variant="ok"]) .bn { --c: var(--_ok); }
      :host([variant="warn"]) .bn { --c: var(--_warn); }
      canvas.px { position: absolute; left: -24px; top: -24px; width: calc(100% + 96px); height: calc(100% + 48px); pointer-events: none; }
      .ct, .act, .x { position: relative; transition: opacity .25s, transform .35s; }
      :host([data-dying]) .ct, :host([data-dying]) .act, :host([data-dying]) .x { opacity: 0; transform: translateX(10px); }
      .ct { flex: 1; min-width: 0; display: grid; gap: 1px; }
      .tt { font-weight: 600; font-size: 13.5px; }
      .ds { font-size: 12.5px; color: var(--_muted); }
      .act { flex: none; border: 0; border-radius: 8px; padding: 7px 12px; font: 600 12.5px var(--_font); background: var(--c); color: var(--_on-accent); cursor: pointer; }
      .act:focus-visible, .x:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; }
      .x { flex: none; width: 28px; height: 28px; border: 0; border-radius: 7px; background: none; color: var(--_muted); cursor: pointer; display: grid; place-items: center; }
      .x:hover { background: color-mix(in srgb, var(--_fg) 8%, transparent); color: var(--_fg); }
      @media (max-width: 420px) { .bn { flex-wrap: wrap; } .ct { flex-basis: calc(100% - 40px); } .act { margin-left: 0; } }
      @media (prefers-reduced-motion: reduce) { .col, .ct, .act, .x { transition: none; } }
      `,
      `<div class="col"><div class="clip"><div class="bn" role="status"><canvas class="px" aria-hidden="true"></canvas>
        <div class="ct"><span class="tt"><slot name="title">Ultracode is here</slot></span><span class="ds"><slot>Plan and run multi-agent workflows right from the composer.</slot></span></div>
        <button class="act" type="button"></button>
        <button class="x" type="button" aria-label="Dismiss"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div></div></div>`,
      2,
      0.7,
    );
    this.$(".x").addEventListener("click", () => this.dismiss());
    this.$(".act").addEventListener("click", () => this.emit("action"));
  }

  attributeChangedCallback(name: string): void {
    if (name === "action") this.renderAction();
    // the colour is read while drawing
    else this.kick();
  }

  protected override init(): void {
    this.renderAction();
  }

  private renderAction(): void {
    const action = this.getAttribute("action");
    const button = this.$(".act");
    button.textContent = action || "Try it";
    button.hidden = action === "";
  }

  /** Plays the disintegration, then collapses the banner. Same as the dismiss button. */
  dismiss(): void {
    if (this.state === "out") return;
    this.state = "out";
    this.t0 = now();
    this.setAttribute("data-dying", "");
    // collapsed content leaves the tab order
    this.$(".col").inert = true;
    clearTimeout(this.goneTimer);
    this.goneTimer = setTimeout(
      () => {
        this.setAttribute("data-gone", "");
        this.emit("dismiss");
      },
      reduced() ? 0 : 950,
    );
    this.kick();
  }

  /** Restores a dismissed banner and replays the entrance. */
  show(): void {
    clearTimeout(this.goneTimer);
    this.removeAttribute("data-gone");
    this.removeAttribute("data-dying");
    this.$(".col").inert = false;
    this.state = "in";
    this.t0 = now();
    this.kick();
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pp = F.pitch;
    const ox = OVERHANG;
    const oy = OVERHANG;
    const bw = this.w - 96;
    const bh = this.h - 48;
    const variant = this.getAttribute("variant");
    const c = variant === "ok" ? P.ok : variant === "warn" ? P.warn : P.accent;
    const dark = this.dark;
    const age = t - this.t0;
    const out = this.state === "out";
    const ft = reducedMotion ? 0 : t;
    if (out && (reducedMotion || age > 1.2)) {
      this.clear();
      return false;
    }
    const sweep = ((ft * 0.22) % 1.6) - 0.3;
    // entrance progress, 0 to 1
    const appear = out || reducedMotion ? 1 : clamp(age * 2.2, 0, 1);
    F.clear();
    const I0 = Math.floor(ox / pp);
    const I1 = Math.ceil((ox + bw) / pp);
    const J0 = Math.floor(oy / pp);
    const J1 = Math.ceil((oy + bh) / pp);
    for (let j = J0; j < J1; j++) {
      for (let i = I0; i < I1; i++) {
        const [x, y] = F.xy(i, j);
        const lx = x - ox;
        const ly = y - oy;
        const sd = inRR(lx, ly, bw, bh, RADIUS);
        if (sd > 0) continue;
        const u = lx / bw;
        const b = bayer(i, j);
        const hz = h2(i, j);
        const edge = sd > -pp * 1.1;
        const sx = u + (ly / bh) * 0.12 - sweep;
        const sheen = Math.exp(-(sx * sx) / 0.004);
        // dither density falls off to the right
        const dens = 0.05 + 0.34 * Math.pow(1 - u, 2.2) + sheen * 0.4;
        let A = dark ? 0.4 : 0.3;
        let glow = sheen * 0.3;
        if (!out && u > appear * 1.3 - 0.15 + hz * 0.15) continue; // materialise left → right
        let lit = edge || b < dens;
        if (edge) A = 0.55;
        let px = x;
        let py = y;
        let col = mix(c, P.shine, sheen * 0.5);
        if (out) {
          // each dot leaves after a delay that grows to the right, then blows away up and to the right
          const delay = u * 0.42 + hz * 0.22;
          const a2 = age - delay;
          if (a2 > 0) {
            if (a2 > FLIGHT) continue;
            const k = a2 / FLIGHT;
            lit = lit || b < 0.6;
            A = (a2 < 0.08 ? 1 : 0.9) * (1 - k);
            glow = (1 - k) * 0.9;
            col = mix(c, WHITE, (1 - k) * (dark ? 0.45 : 0.15));
            px = x + a2 * a2 * 260 + a2 * 30 * (hz - 0.2);
            py = y - a2 * 42 * (h2(j, i) - 0.35) - a2 * a2 * 30;
          } else if (age > 0) {
            // brighten just before leaving
            const pre = clamp(1 - (delay - age) / 0.12, 0, 1);
            A = lerp(A, 0.9, pre);
            lit = lit || b < 0.6 * pre;
            glow = Math.max(glow, pre * 0.3);
          }
        }
        if (!lit) continue;
        F.plot(px, py, col, A, glow);
      }
    }
    // sparkle icon
    if (!out || age < 0.3) {
      const cx = ox + 23;
      const cy = oy + bh / 2;
      const twinkle = reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(t * 3.1);
      const s = 11 * twinkle;
      const col = mix(c, WHITE, dark ? 0.5 : 0.1);
      for (let j = Math.floor((cy - 13) / pp); j <= (cy + 13) / pp; j++) {
        for (let i = Math.floor((cx - 13) / pp); i <= (cx + 13) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const dx = Math.abs(x - cx);
          const dy = Math.abs(y - cy);
          if (Math.pow(dx / s, 0.8) + Math.pow(dy / s, 0.8) <= 1) F.put(i, j, col, out ? 1 - age / 0.3 : appear, 0.85);
        }
      }
    }
    this.flush(0.85, 5);
    return !reducedMotion || out || appear < 1;
  }
}

define("hf-banner", HBanner);

declare global {
  interface HTMLElementTagNameMap {
    "hf-banner": HBanner;
  }
}

export { HBanner };

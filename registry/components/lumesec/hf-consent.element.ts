/**
 * <hf-consent> · Privacy choices
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/consent
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-consent.tsx.
 */
import { HF, bayer, boxMapper, clamp, define, h2, mix, now, reduced, segDist, type RGB } from "@/lib/lumesec/pixel";

/** The optional categories; Necessary is always on and not reported. */
export interface ConsentChoices {
  analytics: boolean;
  personalisation: boolean;
}

/** Events fired by `<hf-consent>`. */
export interface HConsentEventMap {
  /** Reject all, Save choices or Accept all was pressed. */
  consent: CustomEvent<ConsentChoices>;
}

const WHITE: RGB = [255, 255, 255];

/** Privacy choices card whose shield fills as categories are allowed; saving stamps it and folds the card. */
class HConsent extends HF {
  static observedAttributes = ["label", "description"];

  /** Eased fill level of the shield, the share of categories on. */
  private level = 1 / 3;
  /** Time of the last save. */
  private stampedAt = -9;
  /** Asking with the full card, or saved and folded into the pill. */
  private phase: "ask" | "saved" = "ask";
  /** Folds the card into the pill after a save; cleared by Change. */
  private foldTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly full = this.$(".full");
  private readonly pill = this.$(".pill");

  constructor() {
    super(
      `
      :host { display: block; }
      .c { position: relative; border: 1px solid var(--_border); border-radius: 16px; background: var(--_surface); padding: 16px; overflow: hidden; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; }
      .top { position: relative; display: flex; gap: 14px; align-items: flex-start; }
      .em { width: 52px; height: 58px; flex: none; }
      .top b { display: block; font-size: 14.5px; font-weight: 650; margin: 2px 0 3px; }
      .top p { margin: 0; font-size: 12.5px; color: var(--_muted); line-height: 1.45; }
      .opts { position: relative; display: grid; gap: 2px; margin: 12px 0; }
      .op { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-top: 1px solid var(--_border); font-size: 13px; cursor: pointer; }
      .op span { flex: 1; } .op small { display: block; font-size: 11.5px; color: var(--_muted); }
      .op input { appearance: none; -webkit-appearance: none; width: 34px; height: 20px; border-radius: 10px; background: var(--_track); position: relative; cursor: pointer; transition: background .2s; flex: none; margin: 0; }
      .op input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .25s cubic-bezier(.3,1.4,.5,1); }
      .op input:checked { background: var(--_accent); } .op input:checked::after { transform: translateX(14px); }
      .op input:disabled { opacity: .6; cursor: default; }
      .ac { position: relative; display: flex; gap: 8px; flex-wrap: wrap; }
      .ac button { flex: 1 1 auto; height: 36px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .ac .all { background: var(--_accent); border-color: transparent; color: var(--_on-accent); }
      .pill { position: relative; display: flex; align-items: center; gap: 10px; font-size: 13px; }
      .pill .em { width: 28px; height: 31px; }
      .pill button { margin-left: auto; }
      `,
      `<div class="c" role="region" aria-labelledby="ti"><canvas class="px" aria-hidden="true"></canvas>
        <div class="full"><div class="top"><span class="em"></span><div><b class="ti" id="ti"></b><p class="ds"></p></div></div>
        <div class="opts"><label class="op"><span>Necessary<small>Sign-in, security, your settings</small></span><input type="checkbox" checked disabled></label><label class="op"><span>Analytics<small>Anonymous usage to improve the product</small></span><input type="checkbox" data-k="analytics"></label><label class="op"><span>Personalisation<small>Remember layout and suggestions</small></span><input type="checkbox" data-k="personalisation"></label></div>
        <div class="ac"><button type="button" class="no">Reject all</button><button type="button" class="sv">Save choices</button><button type="button" class="all">Accept all</button></div></div>
        <div class="pill" hidden><span class="em"></span><span class="pt"></span><button type="button" class="pbtn ch">Change</button></div></div>`,
      2,
      0.72,
    );
    this.toggles().forEach((input) => input.addEventListener("change", () => this.kick()));
    this.$(".no").addEventListener("click", () => this.save(false, false));
    this.$(".all").addEventListener("click", () => this.save(true, true));
    this.$(".sv").addEventListener("click", () => {
      const [analytics, personalisation] = this.toggles().map((input) => input.checked);
      this.save(analytics, personalisation);
    });
    this.$(".ch").addEventListener("click", () => {
      clearTimeout(this.foldTimer);
      this.phase = "ask";
      this.full.hidden = false;
      this.pill.hidden = true;
      this.$(".sv").focus();
      this.kick();
    });
  }

  attributeChangedCallback(): void {
    this.renderText();
  }

  protected override init(): void {
    this.renderText();
  }

  private renderText(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Your privacy choices";
    this.$(".ds").textContent =
      this.getAttribute("description") || "We only use what you allow. You can change this any time in Settings.";
  }

  /** The Analytics and Personalisation checkboxes. */
  private toggles(): HTMLInputElement[] {
    return this.$$<HTMLInputElement>(".op input[data-k]");
  }

  /** Apply the choices, stamp the shield, fold the card after 700 ms and fire `consent`. */
  private save(analytics: boolean, personalisation: boolean): void {
    this.toggles().forEach((input, k) => {
      input.checked = k ? personalisation : analytics;
    });
    this.stampedAt = now();
    this.phase = "saved";
    // the focused button is about to be hidden; keep keyboard focus in the card
    const hadFocus = this.root.activeElement !== null;
    clearTimeout(this.foldTimer);
    this.foldTimer = setTimeout(
      () => {
        this.full.hidden = true;
        this.pill.hidden = false;
        const n = 1 + Number(analytics) + Number(personalisation);
        this.$(".pt").textContent = `Saved · ${n} of 3 categories on`;
        if (hadFocus) this.$(".ch").focus();
        this.kick();
      },
      reduced() ? 0 : 700,
    );
    this.emit<ConsentChoices>("consent", { analytics, personalisation });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const local = boxMapper(canvas);
    const target = (1 + this.toggles().filter((input) => input.checked).length) / 3;
    this.level += (target - this.level) * Math.min(1, R0 ? 1 : dt * 5);
    const stamp = R0 ? 0 : clamp(1 - (t - this.stampedAt) / 0.7, 0, 1);
    F.clear();
    // the shield sits in the card until it folds, then in the pill
    const emblem =
      (this.phase === "ask" || stamp > 0) && !this.full.hidden ? this.$(".full .em") : this.$(".pill .em");
    const { x: x0, y: y0, w, h } = local(emblem);
    const cx = x0 + w / 2;
    const scale = 1 + stamp * 0.15 * Math.sin(stamp * Math.PI);
    for (let j = Math.floor((y0 - 4) / pp); j < (y0 + h + 4) / pp; j++) {
      for (let i = Math.floor((x0 - 4) / pp); i < (x0 + w + 4) / pp; i++) {
        const [x, y] = F.xy(i, j);
        const lx = (x - cx) / scale;
        const ly = (y - y0 - h / 2) / scale + h / 2;
        const u = ly / h;
        // shield outline: straight sides that taper to a point below 55%, and a shallow notch at the top
        const half = (w / 2) * (u < 0.55 ? 1 : 1 - ((u - 0.55) / 0.45) ** 1.6);
        const notch = (Math.abs(lx) / (w / 2)) * h * 0.06;
        if (ly < 0 || ly > h || Math.abs(lx) > half || !(ly > notch)) continue;
        const edge = Math.abs(lx) > half - 2.2 || ly < notch + 2.2;
        const filled = u > 1 - this.level + 0.04 * Math.sin(lx * 0.4 + t * 3);
        const check =
          Math.min(
            segDist(lx, ly - h * 0.45, -w * 0.2, 0, -w * 0.04, h * 0.16),
            segDist(lx, ly - h * 0.45, -w * 0.04, h * 0.16, w * 0.24, -h * 0.14),
          ) <
          w * 0.055;
        if (check && this.level > 0.5) {
          F.put(i, j, WHITE, 1, 0.5);
          continue;
        }
        if (edge) {
          F.put(i, j, mix(P.accent, P.shine, stamp * 0.6), 1, 0.3 + stamp * 0.7);
          continue;
        }
        if (filled && bayer(i, j) < 0.8) {
          F.put(i, j, mix(P.accent, P.ok, this.level > 0.9 ? 0.6 : 0), 0.9, 0.15 + stamp * 0.5);
        } else if (!filled && bayer(i, j) < 0.15) {
          F.put(i, j, P.accent, 0.5);
        }
      }
    }
    // stamp ring
    if (stamp > 0) {
      const radius = (1 - stamp) * 120;
      const cy = y0 + h / 2;
      for (let j = 0; j < F.rows; j++) {
        for (let i = 0; i < F.cols; i++) {
          const [x, y] = F.xy(i, j);
          if (Math.abs(Math.hypot(x - cx, y - cy) - radius) < 2 && h2(i, j) < 0.7) F.put(i, j, P.ok, stamp, stamp);
        }
      }
    }
    this.flush(0.8, 4);
    return stamp > 0 || Math.abs(target - this.level) > 0.003 || !R0;
  }
}

define("hf-consent", HConsent);

export { HConsent };

declare global {
  interface HTMLElementTagNameMap {
    "hf-consent": HConsent;
  }
}

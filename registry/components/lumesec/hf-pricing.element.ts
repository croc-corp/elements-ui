/**
 * <hf-pricing> · Pricing
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/pricing
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-pricing.tsx.
 *
 * Demo data: The `−20%` badge on Yearly is fixed text, not computed; plan, prices, currency and features can
 * be set. It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import {
  HF,
  bayer,
  checkRadio,
  define,
  escapeHtml,
  h2,
  mix,
  now,
  radioKeys,
  reduced,
  rollText,
} from "@/lib/lumesec/pixel";

// elements rendered inside this one
import "@/components/lumesec/hf-button.element";

/** Billing period. */
export type HPricingPeriod = "monthly" | "yearly";

/** Events fired by `<hf-pricing>`. */
export interface HPricingEventMap {
  /** Fires when the user switches billing period. `price` is the per-month price for that period. */
  change: CustomEvent<{ period: HPricingPeriod; price: number }>;
}

const DEFAULT_FEATURES =
  "Ultracode and multi-agent workflows|Priority access at peak times|Projects with shared context";

/** A price for display: whole amounts as they are, others with two decimals (`16`, `16.50`). */
const amount = (value: number): string => {
  const cents = Math.round(value * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
};

/**
 * Pricing card with a monthly and yearly toggle; the price rolls to the new number while a bright edge wipes
 * through the dot grid behind it.
 */
class HPricing extends HF {
  private period: HPricingPeriod = "yearly";
  /** Time the wipe started; -9 shows the grid at rest. */
  private t0 = -9;
  private text = "";

  constructor() {
    super(
      `
      :host { display: block; }
      .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--_track); margin-bottom: 16px; }
      .seg button { border: 0; background: none; padding: 5px 12px; border-radius: 7px; font-size: 13px; font-weight: 500; color: var(--_muted); cursor: pointer; }
      .seg button[aria-checked="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      .seg button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
      .seg em { font-style: normal; font-size: 11px; color: var(--_ok); margin-left: 4px; font-weight: 600; }
      .plan { font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--_accent); }
      .row { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; }
      .pv { position: relative; padding: 8px 14px 8px 0; }
      .pv canvas.px { position: absolute; left: -6px; top: 0; width: calc(100% + 6px); height: 100%; }
      .pr {
        position: relative; font-family: var(--_mono); font-size: 52px; font-weight: 600; letter-spacing: -.02em;
        line-height: 1; font-variant-numeric: tabular-nums; color: var(--_fg);
      }
      .per { font-size: 13px; color: var(--_muted); }
      .note { display: block; font-size: 12.5px; color: var(--_muted); margin: 6px 0 16px; }
      ul { list-style: none; margin: 0 0 18px; padding: 0; display: grid; gap: 6px; font-size: 13.5px; }
      li { display: flex; gap: 8px; align-items: center; }
      li i { width: 6px; height: 6px; background: var(--_accent); border-radius: 1px; flex: none; }
      `,
      `<div class="seg" role="radiogroup" aria-label="Billing period"><button type="button" role="radio" data-p="m">Monthly</button><button type="button" role="radio" data-p="y">Yearly<em>−20%</em></button></div>
        <div class="plan"></div><div class="row" aria-hidden="true"><span class="pv"><canvas class="px"></canvas><span class="rollslot pr"></span></span><span class="per"><span class="rollslot pp"></span></span></div><span class="sr" aria-live="polite"></span>
        <span class="note"><span class="rollslot nn"></span></span><ul></ul><hf-button class="cta">Start free trial</hf-button>`,
      2,
      0.74,
    );
    for (const button of this.periodButtons) {
      button.addEventListener("click", () => this.setPeriod(periodOf(button)));
    }
    // two options: any arrow key selects and focuses the other one
    radioKeys(
      this.$(".seg"),
      () => this.periodButtons,
      () => this.periodIndex(this.period),
      (index) => this.setPeriod(periodOf(this.periodButtons[index])),
    );
  }

  /** Per-month price for the selected period, read from `monthly` or `yearly`. */
  get price(): number {
    return this.period === "monthly" ? this.num("monthly", 20) : this.num("yearly", 16);
  }

  protected override init(): void {
    this.$(".plan").textContent = this.getAttribute("plan") || "Pro";
    const features = (this.getAttribute("features") || DEFAULT_FEATURES).split("|");
    this.$("ul").innerHTML = features.map((feature) => `<li><i></i>${escapeHtml(feature)}</li>`).join("");
    this.setPeriod(this.getAttribute("period") === "monthly" ? "monthly" : "yearly", true);
  }

  private get periodButtons(): HTMLButtonElement[] {
    return this.$$<HTMLButtonElement>(".seg button");
  }

  /** The index of the toggle button for `period`. */
  private periodIndex(period: HPricingPeriod): number {
    return this.periodButtons.findIndex((button) => periodOf(button) === period);
  }

  private setPeriod(period: HPricingPeriod, first = false): void {
    if (period === this.period && !first) return;
    const previous = this.price;
    this.period = period;
    const yearly = period === "yearly";
    checkRadio(this.periodButtons, this.periodIndex(period));
    const currency = this.getAttribute("currency") || "€";
    const price = this.price;
    this.text = `${currency}${amount(price)}`;
    this.t0 = first ? -9 : now();
    // a cheaper price rolls down, a dearer one up
    rollText(this.$(".pr"), this.text, price < previous ? -1 : 1, !first);
    rollText(this.$(".pp"), "/ month", 1, false);
    const note = yearly ? `Billed ${currency}${amount(price * 12)} once a year` : "Billed monthly · cancel anytime";
    rollText(this.$(".nn"), note, yearly ? 1 : -1, !first);
    this.$(".sr").textContent = `${this.text} per month, ${yearly ? "billed yearly" : "billed monthly"}`;
    if (!first) this.emit<{ period: HPricingPeriod; price: number }>("change", { period, price });
    this.kick();
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const dark = this.dark;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const e = reducedMotion ? 9 : (t - this.t0) * 2.4;
    F.clear();
    for (let j = 0; j < R; j++) {
      const v = j / R;
      for (let i = 0; i < C; i++) {
        const u = i / C;
        // at rest: a faint dither that thickens towards the bottom left, under the price
        const rest = v * v * v * 0.42 * (1 - u * 0.75);
        // the wipe: a bright front with a ragged, per-cell edge runs left to right while the price rolls
        const front = e < 1.5 ? Math.exp(-(((u - (e * 1.2 - 0.1) + h2(i, j) * 0.08) * 9) ** 2)) : 0;
        if (front > 0.2 && bayer(i, j) < front * 0.85) {
          F.put(i, j, mix(P.accent, P.shine, 0.5), front, front * 0.8);
        } else if (bayer(i, j) < rest) {
          F.put(i, j, mix(P.muted, P.accent, 0.35 + v * 0.4), dark ? 0.6 : 0.5);
        }
      }
    }
    this.flush(0.7, 4);
    return e < 2;
  }
}

/** The billing period a toggle button stands for. */
function periodOf(button: HTMLElement): HPricingPeriod {
  return button.dataset.p === "m" ? "monthly" : "yearly";
}

define("hf-pricing", HPricing);

declare global {
  interface HTMLElementTagNameMap {
    "hf-pricing": HPricing;
  }
}

export { HPricing };

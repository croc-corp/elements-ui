/**
 * <hf-spotlight> · Product tour
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/spotlight
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-spotlight.tsx.
 *
 * Demo data: The mock app and its four tour steps are built in; nothing can be set. It cannot show your own
 * data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { HF, TAU, bayer, boxMapper, clamp, define, inRR, mix, reduced, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-spotlight>`. */
export interface HSpotlightEventMap {
  /** A step is shown. */
  step: CustomEvent<{ index: number; title: string }>;
  /** The tour ended through Done, Skip or Escape. */
  finish: CustomEvent<Record<string, never>>;
}

/** Tour steps: the target inside the mock app, a title and a text. */
const TOUR: readonly (readonly [selector: string, title: string, text: string])[] = [
  [".nw", "Start fresh", "New chats start with an empty context, so earlier work doesn’t leak in."],
  [".md", "Pick a model", "Switch models per chat. Bigger models think longer and cost more."],
  [".cp", "Ask anything", "Type here, attach files, or drop in a screenshot."],
  [".uc", "Turn on Ultracode", "The agent plans multi-agent workflows on its own for big tasks."],
];

const SHADE_DARK: RGB = [6, 6, 10];
const SHADE_LIGHT: RGB = [30, 28, 40];

/** Product tour over a mock app: dithered dimming and a rounded cut-out with a comet on its edge. */
class HSpotlight extends HF {
  /** Current step, or -1 while the tour is not running. */
  private step = -1;
  /** Drawn cut-out as `[x, y, w, h]`, easing towards {@link HSpotlight.goal}. */
  private view = [0, 0, 0, 0];
  /** Eased 0..1 strength of the dimming. */
  private dim = 0;
  /** Cut-out around the current target; null before the first step. */
  private goal: number[] | null = null;
  private readonly tip = this.$(".tip");
  private readonly start = this.$<HTMLButtonElement>(".st");
  private readonly back = this.$<HTMLButtonElement>(".bk");
  private readonly next = this.$<HTMLButtonElement>(".nx");

  constructor() {
    super(
      `
      :host { display: block; }
      .fr { position: relative; height: 236px; border: 1px solid var(--_border); border-radius: 14px; background: var(--_surface); overflow: hidden; display: grid; grid-template-columns: 112px 1fr; }
      .sb { border-right: 1px solid var(--_border); padding: 12px 10px; display: grid; align-content: start; gap: 6px; font-size: 12px; color: var(--_muted); }
      .nw { height: 30px; border-radius: 8px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); font-size: 12px; font-weight: 600; }
      .sb i { display: block; height: 8px; border-radius: 4px; background: var(--_track); margin: 6px 4px 0; }
      .mn { padding: 12px 14px; display: grid; grid-template-rows: auto 1fr auto; gap: 10px; min-width: 0; }
      .md { justify-self: start; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--_border); background: var(--_surface); color: var(--_fg); font-size: 12px; font-weight: 600; }
      .ms { display: grid; gap: 7px; align-content: start; }
      .ms i { display: block; height: 8px; border-radius: 4px; background: var(--_track); }
      .row { display: flex; gap: 8px; align-items: center; min-width: 0; }
      .cp { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 36px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_raised); font-size: 12px; color: var(--_muted); display: flex; align-items: center; padding: 0 10px; }
      .uc { height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_surface); font-size: 12px; font-weight: 600; color: var(--_fg); white-space: nowrap; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 3; }
      .tip { position: absolute; z-index: 4; width: 230px; border-radius: 12px; border: 1px solid var(--_border); background: var(--_surface); padding: 12px 14px; box-shadow: 0 16px 40px -12px rgba(0,0,0,.45); transition: left .35s cubic-bezier(.2,.8,.2,1), top .35s cubic-bezier(.2,.8,.2,1), opacity .2s; }
      .tip .n { font-size: 11px; color: var(--_muted); font-weight: 600; letter-spacing: .04em; }
      .tip b { display: block; font-size: 13.5px; margin: 2px 0 3px; }
      .tip p { margin: 0 0 10px; font-size: 12px; color: var(--_muted); line-height: 1.45; }
      .tip .ac { display: flex; gap: 6px; } .tip .ac .pbtn:last-child { margin-left: auto; background: var(--_accent); border-color: transparent; color: var(--_on-accent); }
      .st { position: absolute; z-index: 4; left: 50%; top: 50%; transform: translate(-50%, -50%); height: 38px; padding: 0 16px; border-radius: 10px; border: 0; background: var(--_accent); color: var(--_on-accent); font-weight: 600; font-size: 13px; cursor: pointer; box-shadow: 0 10px 30px -8px rgba(0,0,0,.4); }
      @media (max-width: 460px) { .fr { grid-template-columns: 84px 1fr; } .uc { padding: 0 8px; } }
      `,
      `<div class="fr" role="region" aria-label="Product tour demo"><div class="sb"><button class="nw" type="button" tabindex="-1">+ New</button><span>Recent</span><i style="width:80%"></i><i style="width:60%"></i><i style="width:70%"></i></div><div class="mn"><button class="md" type="button" tabindex="-1">Large ▾</button><div class="ms"><i style="width:70%"></i><i style="width:90%"></i><i style="width:55%"></i></div><div class="row"><span class="cp">Ask the agent anything…</span><button class="uc" type="button" tabindex="-1">✦ Ultracode</button></div></div>
        <canvas class="px" aria-hidden="true"></canvas><button class="st" type="button">Take the tour</button><div class="tip" role="dialog" aria-labelledby="tt" aria-describedby="td" aria-live="polite" hidden><span class="n"></span><b id="tt"></b><p id="td"></p><div class="ac"><button class="pbtn sk" type="button">Skip</button><button class="pbtn bk" type="button">Back</button><button class="pbtn nx" type="button">Next</button></div></div></div>`,
      2,
      0.72,
    );
    this.start.addEventListener("click", () => this.go(0));
    this.next.addEventListener("click", () => this.go(this.step + 1));
    this.back.addEventListener("click", () => this.go(this.step - 1));
    this.$(".sk").addEventListener("click", () => this.go(TOUR.length));
    this.$(".fr").addEventListener("keydown", (e) => {
      if (this.step < 0) return;
      if (e.key === "Escape") this.go(TOUR.length);
      if (e.key === "ArrowRight") this.go(this.step + 1);
      if (e.key === "ArrowLeft") this.go(this.step - 1);
    });
  }

  /** Shows step `index` (0 to 3); 4 or more ends a running tour. Negative values are ignored. */
  go(index: number): void {
    const tip = this.tip;
    const start = this.start;
    if (index < 0) return;
    if (index >= TOUR.length) {
      if (this.step < 0) return;
      this.step = -1;
      tip.hidden = true;
      start.hidden = false;
      start.textContent = "Take the tour again";
      start.focus();
      this.emit("finish");
      this.kick();
      return;
    }
    const first = this.step < 0;
    this.step = index;
    start.hidden = true;
    tip.hidden = false;
    const [, title, text] = TOUR[index];
    this.$(".tip .n").textContent = `${index + 1} OF ${TOUR.length}`;
    this.$(".tip b").textContent = title;
    this.$(".tip p").textContent = text;
    this.back.disabled = index === 0;
    this.next.textContent = index === TOUR.length - 1 ? "Done" : "Next";
    // the first cut-out grows from the centre
    if (first) {
      const frame = this.$(".fr");
      this.view = [frame.offsetWidth / 2, frame.offsetHeight / 2, 0, 0];
    }
    this.place();
    this.next.focus({ preventScroll: true });
    this.emit<{ index: number; title: string }>("step", { index, title });
    this.kick();
  }

  /** Aim the cut-out at the current step's target and put the card below it, or above when it does not fit. */
  private place(): void {
    if (this.step < 0) return;
    const frame = this.$(".fr");
    const box = boxMapper(frame)(this.$(TOUR[this.step][0]));
    const goal = [box.x - 6, box.y - 6, box.w + 12, box.h + 12];
    const [gx, gy, gw, gh] = goal;
    this.goal = goal;
    const width = frame.offsetWidth;
    const height = frame.offsetHeight;
    const tip = this.tip;
    const below = gy + gh + 10 + 130 < height;
    const tw = Math.min(230, width - 16);
    tip.style.width = `${tw}px`;
    tip.style.left = `${clamp(gx + gw / 2 - tw / 2, 8, width - tw - 8)}px`;
    tip.style.top = below ? `${gy + gh + 10}px` : `${Math.max(8, gy - 10 - tip.offsetHeight)}px`;
  }

  /** Follow the target when the element is resized during a tour. */
  protected override layout(): void {
    this.place();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const on = this.step >= 0;
    this.dim += ((on ? 1 : 0) - this.dim) * Math.min(1, R0 ? 1 : dt * 6);
    const goal = this.goal;
    if (goal) this.view = this.view.map((v, k) => (R0 ? goal[k] : v + (goal[k] - v) * Math.min(1, dt * 9)));
    const [hx, hy, hw, hh] = this.view;
    const busy =
      Math.abs(this.dim - (on ? 1 : 0)) > 0.01 || (!!goal && goal.some((g, k) => Math.abs(g - this.view[k]) > 0.3));
    F.clear();
    if (this.dim > 0.01) {
      const head = R0 ? -1 : (t * 0.5) % 1;
      for (let j = 0; j < F.rows; j++) {
        for (let i = 0; i < F.cols; i++) {
          const [x, y] = F.xy(i, j);
          const sd = on || goal ? inRR(x - hx, y - hy, Math.max(hw, 1), Math.max(hh, 1), 10) : 1;
          if (sd < -0.5) continue;
          // the cut-out's edge, with a comet circling it
          if (sd < 1.8 && on) {
            const a = (Math.atan2(y - (hy + hh / 2), (x - (hx + hw / 2)) * (hh / Math.max(hw, 1))) / TAU + 1) % 1;
            let dd = Math.abs(a - head);
            dd = Math.min(dd, 1 - dd);
            const comet = head < 0 ? 0 : Math.exp(-(dd * dd) / 0.003);
            F.put(i, j, mix(P.accent, P.shine, comet * 0.7), this.dim, 0.4 + comet * 0.6);
            continue;
          }
          if (bayer(i, j) < 0.62 * this.dim) {
            F.put(i, j, this.dark ? SHADE_DARK : SHADE_LIGHT, this.dark ? 0.92 : 0.6);
          }
        }
      }
    }
    this.flush(0.8, 5);
    return busy || (on && !R0);
  }
}

define("hf-spotlight", HSpotlight);

export { HSpotlight };

declare global {
  interface HTMLElementTagNameMap {
    "hf-spotlight": HSpotlight;
  }
}

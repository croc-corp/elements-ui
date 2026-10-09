/**
 * <hf-run> · Agent run
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/run
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-run.tsx.
 *
 * Demo data: Step durations are random and the token count is generated; only the step labels, `label` and the
 * failing step can be set. It cannot show your own data yet; use it as a template and replace the invented
 * data before it shows anything real.
 */
import {
  HF,
  TAU,
  boxMapper,
  define,
  escapeHtml,
  fmtInt,
  mix,
  now,
  reduced,
  rollText,
  segDist,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Status of a step as reported by the `step` event. */
export type HRunStepStatus = "running" | "done" | "fail";

/** Detail of the `step` event. */
export interface HRunStepDetail {
  /** Zero-based index of the step. */
  index: number;
  label: string;
  status: HRunStepStatus;
}

/** Detail of the `done` event. */
export interface HRunDoneDetail {
  /** False when a step failed. */
  ok: boolean;
  /** Duration of the run in seconds. */
  elapsed: number;
}

/** Events fired by `<hf-run>`. */
export interface HRunEventMap {
  /** Fires when a step starts and when it finishes. */
  step: CustomEvent<HRunStepDetail>;
  /** Fires when the run ends. `ok` is `false` when a step failed; `elapsed` is in seconds. */
  done: CustomEvent<HRunDoneDetail>;
}

/** Internal state of a step; `run` while it is in progress. */
type StepState = "pending" | "run" | "done" | "fail";

interface Step {
  label: string;
  state: StepState;
  /** Time the step entered its state. */
  t0: number;
}

const DEFAULT_STEPS = "Plan the approach|Read 14 files|Edit src/auth.ts|Run test suite|Write summary";

const WHITE: RGB = [255, 255, 255];

/** Horizontal centre of the status icons in canvas pixels. */
const ICON_X = 14;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Simulated token count after `seconds` of a run: a rate of 380 + 260·sin²(2.3t) tokens per second, integrated.
 * Derived from the run time rather than summed per frame, so a run that plays off screen still counts.
 */
const tokensAt = (seconds: number): number => 510 * seconds - (130 / 4.6) * Math.sin(4.6 * seconds);

/** Whether `(dx, dy)` from the icon centre lies on the cross carved into a failed step. */
const onCross = (dx: number, dy: number): boolean =>
  (Math.abs(dx - dy) < 1.3 || Math.abs(dx + dy) < 1.3) && Math.abs(dx) < 3.6;

/** Whether `(dx, dy)` from the icon centre lies on the check mark carved into a finished step. */
const onCheck = (dx: number, dy: number): boolean =>
  Math.min(segDist(dx, dy, -3.6, 0.2, -1, 2.8), segDist(dx, dy, -1, 2.8, 3.8, -2.6)) < 1.25;

/**
 * Simulated agent run: steps show a spinning arc while running and a carved check when done, with elapsed time
 * and tokens on top.
 */
class HRun extends HF {
  private stepList: Step[] = [];
  private running = false;
  /** Incremented by `reset()`, so a run in progress notices it was cancelled. */
  private runId = 0;
  /** Start time of the current run. */
  private t0 = 0;
  /** Seconds since the run started. */
  private elapsed = 0;
  /** Simulated token count. */
  private tok = 0;
  /** Time the header text was last refreshed. */
  private lastMe = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .ti { font-weight: 600; font-size: 14px; }
      .me { margin-left: auto; font-family: var(--_mono); font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .go { border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); border-radius: 8px; padding: 6px 12px; font: 600 12.5px var(--_font); cursor: pointer; }
      .go:disabled { opacity: .55; cursor: default; }
      .go:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      .ls { position: relative; }
      canvas.px { position: absolute; left: 0; top: 0; width: 28px; height: 100%; }
      ol { list-style: none; margin: 0; padding: 0 0 0 38px; }
      li { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; font-size: 13.5px; transition: color .3s; }
      li[data-s="pending"] { color: var(--_muted); }
      li[data-s="fail"] { color: var(--_danger); }
      li[data-s="run"] .lb { background: linear-gradient(90deg, var(--_fg) 30%, var(--_accent) 50%, var(--_fg) 70%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shm 1.4s linear infinite; }
      @keyframes shm { from { background-position: 100% 0; } to { background-position: -150% 0; } }
      @media (prefers-reduced-motion: reduce) { li[data-s="run"] .lb { animation: none; } }
      .dt { margin-left: auto; font-family: var(--_mono); font-size: 11.5px; color: var(--_muted); }
      `,
      `<div class="hd"><span class="ti"></span><span class="me"></span><button class="go" type="button">Run</button></div><div class="ls"><canvas class="px" aria-hidden="true"></canvas><ol></ol></div><span class="sr" aria-live="polite"></span>`,
      1.5,
      0.74,
    );
    this.$(".go").addEventListener("click", () => this.run());
  }

  /**
   * Step labels parsed from the `steps` attribute (separated by `|`, empty labels skipped). Re-read at the start of
   * each run.
   */
  get steps(): string[] {
    const steps = (this.getAttribute("steps") || "")
      .split("|")
      .map((label) => label.trim())
      .filter(Boolean);
    return steps.length ? steps : DEFAULT_STEPS.split("|");
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Agent run";
    this.reset();
    if (this.hasAttribute("autoplay")) setTimeout(() => this.run(), 700);
  }

  /** Rebuilds the step list from `steps` and clears the header counters. Cancels a run in progress. */
  reset(): void {
    this.runId++;
    if (this.running) {
      this.running = false;
      const go = this.$<HTMLButtonElement>(".go");
      go.disabled = false;
      go.textContent = "Run";
    }
    this.stepList = this.steps.map((label): Step => ({ label, state: "pending", t0: -9 }));
    this.$("ol").innerHTML = this.stepList
      .map(
        (step, k) =>
          `<li data-s="pending" data-k="${k}"><span class="lb">${escapeHtml(step.label)}</span><span class="dt rollslot"></span></li>`,
      )
      .join("");
    this.elapsed = 0;
    this.tok = 0;
    this.$(".me").textContent = "0.0s · 0 tokens";
    this.kick();
  }

  /** Move step `k` to `state`; `dur` is the step duration in seconds, shown once it finished. */
  private setStep(k: number, state: Exclude<StepState, "pending">, dur = 0): void {
    const step = this.stepList[k];
    step.state = state;
    step.t0 = now();
    const li = this.$$("li")[k];
    li.dataset.s = state;
    if (state === "done" || state === "fail") {
      rollText(this.$$(".dt")[k], state === "fail" ? "failed" : `${dur.toFixed(1)}s`, 1, true);
    }
    // finished steps are announced; the start of each step would only add noise
    if (state !== "run") {
      const result = state === "fail" ? "failed" : `done in ${dur.toFixed(1)} seconds`;
      this.$(".sr").textContent = `${step.label}: ${result}`;
    }
    this.emit<HRunStepDetail>("step", { index: k, label: step.label, status: state === "run" ? "running" : state });
    this.kick();
  }

  /** Resets the list and plays the simulated run. Ignored while a run is in progress. Same as the Run button. */
  async run(): Promise<void> {
    if (this.running) return;
    this.reset();
    const id = this.runId;
    this.running = true;
    this.t0 = now();
    const go = this.$<HTMLButtonElement>(".go");
    go.disabled = true;
    go.textContent = "Running…";
    const fail = this.hasAttribute("fail") ? this.num("fail", -1) : -1;
    let ok = true;
    for (let k = 0; k < this.stepList.length; k++) {
      this.setStep(k, "run");
      const dur = reduced() ? 0.15 : 0.6 + Math.random() * 1.1;
      const t1 = now();
      await sleep(dur * 1000);
      // reset() during the run cancels it
      if (id !== this.runId) return;
      if (k === fail) {
        this.setStep(k, "fail", now() - t1);
        ok = false;
        break;
      }
      this.setStep(k, "done", now() - t1);
    }
    this.running = false;
    go.disabled = false;
    go.textContent = ok ? "Run again" : "Retry";
    // read the clock here: the render loop that updates `elapsed` while running pauses off screen
    this.elapsed = now() - this.t0;
    this.tok = tokensAt(this.elapsed);
    this.$(".me").textContent = `${this.elapsed.toFixed(1)}s · ${fmtInt(this.tok)} tokens`;
    this.$(".sr").textContent = ok
      ? `Run finished in ${this.elapsed.toFixed(1)} seconds`
      : `Run failed after ${this.elapsed.toFixed(1)} seconds`;
    this.emit<HRunDoneDetail>("done", { ok, elapsed: this.elapsed });
    this.kick();
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const local = boxMapper(this.$(".ls"));
    const pitch = F.pitch;
    const cx = ICON_X;
    // flowing and spinning parts hold still under reduced motion
    const ft = reducedMotion ? 0 : t;
    if (this.running) {
      this.elapsed = now() - this.t0;
      this.tok = tokensAt(this.elapsed);
      if (t - this.lastMe > 0.09) {
        this.lastMe = t;
        this.$(".me").textContent = `${this.elapsed.toFixed(1)}s · ${fmtInt(this.tok)} tokens`;
      }
    }
    const ys = this.$$("li").map((li) => {
      const { y, h } = local(li);
      return y + h / 2;
    });
    let busy = this.running;
    F.clear();
    // connectors
    for (let k = 0; k < ys.length - 1; k++) {
      const a = ys[k] + 11;
      const b = ys[k + 1] - 11;
      const next = this.stepList[k + 1].state;
      const cur = this.stepList[k].state;
      const live = cur === "done" && next === "run";
      const lit = cur === "done" && (next === "done" || next === "fail");
      for (let j = Math.floor(a / pitch); j < b / pitch; j++) {
        for (let i = Math.floor((cx - 1.5) / pitch); i <= (cx + 1.5) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          if (Math.abs(x - cx) > 1.3) continue;
          if (live) {
            const w = 0.5 + 0.5 * Math.sin((y - ft * 70) * 0.22);
            F.put(i, j, mix(P.accent, P.shine, w * 0.5), 0.45 + 0.55 * w, w * 0.7);
          } else if (lit) F.put(i, j, P.ok, 0.75);
          else if (((j / 2) | 0) % 2 === 0) F.put(i, j, P.muted, 0.35);
        }
      }
    }
    // status icons
    this.stepList.forEach((step, k) => {
      const cy = ys[k];
      const age = t - step.t0;
      const finished = step.state === "done" || step.state === "fail";
      const pop = !reducedMotion && finished ? Math.exp(-age * 7) : 0;
      if (pop > 0.01) busy = true;
      const r = 8 * (1 + 0.28 * pop);
      for (let j = Math.floor((cy - 12) / pitch); j <= (cy + 12) / pitch; j++) {
        for (let i = Math.floor((cx - 12) / pitch); i <= (cx + 12) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy);
          if (step.state === "pending") {
            if (d < r && d > r - 1.6) F.put(i, j, P.muted, 0.6);
            continue;
          }
          if (step.state === "run") {
            const a = (Math.atan2(dy, dx) - ft * 6 + TAU * 10) % TAU;
            const arc = a < 1.6;
            if (d < r && d > r - 2.2) {
              F.put(
                i,
                j,
                arc ? mix(P.accent, P.shine, 1 - a / 1.6) : mix(P.track, P.accent, 0.25),
                arc ? 1 : 0.8,
                arc ? (1 - a / 1.6) * 0.9 : 0,
              );
            } else if (d < 2.6 + Math.sin(ft * 8)) F.put(i, j, P.accent, 1, 0.6);
            continue;
          }
          if (d >= r) continue;
          const fail = step.state === "fail";
          // carve the glyph out of the disc
          if (fail ? onCross(dx, dy) : onCheck(dx, dy)) continue;
          const c = fail ? P.danger : P.ok;
          F.put(i, j, mix(c, WHITE, pop * 0.5), 1, 0.12 + pop * 0.9);
        }
      }
    });
    this.flush(0.85, 4);
    return (busy && !reducedMotion) || this.running;
  }
}

define("hf-run", HRun);

declare global {
  interface HTMLElementTagNameMap {
    "hf-run": HRun;
  }
}

export { HRun };

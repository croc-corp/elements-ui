/**
 * <hf-approve> · Permission prompt
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/approve
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-approve.tsx.
 *
 * Demo data: It starts on, and its Next request button cycles through, four built-in demo requests;
 * `request()` shows your own. It cannot show your own data yet; use it as a template and replace the invented
 * data before it shows anything real.
 */
import { HF, bayer, boxMapper, clamp, define, h2, mix, now, reduced, rollText } from "@/lib/lumesec/pixel";

/** The answer to a request. */
export type HApproveDecision = "once" | "always" | "deny";

/** Risk of a request: 1–2 Low, 3 Medium, 4 High, 5 Critical. At 4 and above, Always allow is disabled. */
export type HApproveRisk = 1 | 2 | 3 | 4 | 5;

/** A permission request shown by {@link HApprove.request}. */
export interface HApproveRequest {
  /** Tool name shown in the corner, for example `Bash`. */
  tool: string;
  /** Heading of the prompt. */
  title: string;
  /** The command, file list or URL; may span several lines. */
  cmd: string;
  /** Why the agent asks. */
  why: string;
  risk: HApproveRisk;
}

/** Detail of the `decision` event. */
export interface HApproveDecisionDetail {
  decision: HApproveDecision;
  tool: string;
  /** The full command text of the current request. */
  command: string;
}

/** Events fired by `<hf-approve>`. */
export interface HApproveEventMap {
  /** Fires when a choice is made by click or by keys 1 to 3. */
  decision: CustomEvent<HApproveDecisionDetail>;
}

const APPROVALS: readonly HApproveRequest[] = [
  {
    tool: "Bash",
    title: "The agent wants to run a command",
    cmd: "npm install --save zod",
    why: "Adds schema validation for request bodies in src/api.",
    risk: 1,
  },
  {
    tool: "Edit",
    title: "The agent wants to edit 3 files",
    cmd: "src/auth/session.ts\nsrc/auth/token.ts\ntests/auth.spec.ts",
    why: "Moves token refresh behind the new flag.",
    risk: 2,
  },
  {
    tool: "Bash",
    title: "The agent wants to run a command",
    cmd: "git push --force origin main",
    why: "Rewrites history on the shared branch.",
    risk: 5,
  },
  {
    tool: "WebFetch",
    title: "The agent wants to fetch a page",
    cmd: "https://docs.example.com/oauth/refresh",
    why: "Reads the refresh-token specification.",
    risk: 1,
  },
];

const RISK_LABEL: Readonly<Record<HApproveRisk, string>> = {
  1: "Low",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Critical",
};

/** Keyboard shortcuts for the three answers. */
const DECISION_KEYS: Partial<Record<string, HApproveDecision>> = { 1: "once", 2: "always", 3: "deny" };

/** Seconds the scan runs before the risk is shown. */
const SCAN_TIME = 1.1;

const isDecision = (value: string | undefined): value is HApproveDecision =>
  value === "once" || value === "always" || value === "deny";

/** Whether a key press comes from a text field or editable content, where 1 to 3 are typed text. */
const isTyping = (e: KeyboardEvent): boolean => {
  const origin = e.composedPath()[0];
  if (!(origin instanceof HTMLElement)) return false;
  return origin.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName);
};

/**
 * Agent permission prompt: a scan runs over the command, a risk meter fills, and Allow once, Always allow or Deny
 * settles it.
 */
class HApprove extends HF {
  /** Index of the current demo request. */
  private index = 0;
  /** Start time of the scan. */
  private scanT = 0;
  /** The answer once given; null while open. */
  private dec: HApproveDecision | null = null;
  /** Time of the answer. */
  private decT = -9;
  /** Eased 0–1 fill of the risk meter. */
  private meter = 0;
  private cur: HApproveRequest = APPROVALS[0];
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  /** Swaps the buttons for the result row after a decision; cleared when a new request is shown. */
  private resultTimer: ReturnType<typeof setTimeout> | undefined;

  /** Keys 1 to 3 answer while the pointer is over the prompt or focus is inside it, but not while typing. */
  private readonly onKey = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    if (this.dec || (!this.matches(":hover") && !this.contains(active) && active !== this)) return;
    const d = DECISION_KEYS[e.key];
    if (d && !e.metaKey && !e.ctrlKey && !isTyping(e)) this.decide(d);
  };

  constructor() {
    super(
      `
      :host { display: block; }
      .c { position: relative; border: 1px solid var(--_border); border-radius: 14px; background: var(--_surface); padding: 14px 16px; overflow: hidden; transition: border-color .3s; }
      /* the canvas sits above the command's background and below all text, so the scan shows over the command */
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 1; }
      .hd, .why, .rk, .act, .done { position: relative; z-index: 2; }
      .cmd { position: relative; }
      .cmd > span { position: relative; z-index: 2; }
      .hd { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
      .tool { margin-left: auto; font-family: var(--_mono); font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 6px; background: var(--_raised); color: var(--_muted); }
      .cmd { margin: 10px 0 8px; padding: 10px 12px; border-radius: 9px; background: var(--_track); font-family: var(--_mono); font-size: 12.5px; white-space: pre-wrap; word-break: break-all; line-height: 1.55; }
      .why { font-size: 12.5px; color: var(--_muted); }
      .rk { display: flex; align-items: center; gap: 8px; margin: 12px 0; font-size: 12px; color: var(--_muted); }
      .rk .meter { flex: 1; height: 8px; }
      .rk b { font-weight: 600; color: var(--c, var(--_muted)); min-width: 6ch; }
      .act { display: flex; gap: 8px; flex-wrap: wrap; }
      .act button { flex: 1 1 auto; white-space: nowrap; padding: 0 10px; height: 36px; border-radius: 9px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
      .act button[data-d="once"] { background: var(--_accent); border-color: transparent; color: var(--_on-accent); }
      .act button:disabled { opacity: .5; cursor: default; }
      .act kbd { font-family: var(--_mono); font-size: 10.5px; opacity: .65; }
      .done { display: flex; align-items: center; gap: 10px; font-size: 13px; }
      .done b { font-weight: 600; }
      .done code { font-family: var(--_mono); font-size: 12px; color: var(--_muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
      .full[hidden], .done[hidden] { display: none; }
      `,
      `<div class="c" role="alertdialog" aria-labelledby="ti" aria-describedby="why"><canvas class="px" aria-hidden="true"></canvas>
        <div class="full"><div class="hd"><span id="ti"></span><span class="tool"></span></div><pre class="cmd"><span></span></pre><div class="why" id="why"></div>
        <div class="rk"><span>Risk</span><b class="rollslot lv"></b><span class="meter"></span></div>
        <div class="act"><button type="button" data-d="once">Allow once <kbd>1</kbd></button><button type="button" data-d="always">Always allow <kbd>2</kbd></button><button type="button" data-d="deny">Deny <kbd>3</kbd></button></div></div>
        <div class="done" hidden><b class="dl" id="dl"></b><code class="dc"></code><button type="button" class="pbtn nx" aria-describedby="dl">Next request</button></div></div>`,
      2,
      0.72,
    );
    this.actionButtons.forEach((button) =>
      button.addEventListener("click", () => {
        const d = button.dataset.d;
        if (isDecision(d)) this.decide(d);
      }),
    );
    this.$(".nx").addEventListener("click", () => this.next());
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.onKey);
  }

  private get actionButtons(): HTMLButtonElement[] {
    return this.$$<HTMLButtonElement>(".act button");
  }

  private actionButton(d: HApproveDecision): HTMLButtonElement {
    return this.$<HTMLButtonElement>(`.act button[data-d="${d}"]`);
  }

  protected override init(): void {
    this.show(APPROVALS[0]);
  }

  /** Shows a new request. At risk 4 and above, Always allow is disabled. */
  request(o: HApproveRequest): void {
    this.show(o);
  }

  /** Shows the next of the four built-in demo requests and focuses Allow once. */
  next(): void {
    this.index = (this.index + 1) % APPROVALS.length;
    this.show(APPROVALS[this.index]);
    this.$<HTMLButtonElement>(".act button").focus();
  }

  private show(o: HApproveRequest): void {
    this.cur = o;
    this.dec = null;
    this.scanT = now();
    this.meter = 0;
    this.$("#ti").textContent = o.title;
    this.$(".tool").textContent = o.tool;
    this.$(".cmd > span").textContent = o.cmd;
    this.$(".why").textContent = o.why;
    clearTimeout(this.resultTimer);
    this.$(".full").hidden = false;
    this.$(".done").hidden = true;
    this.actionButtons.forEach((button) => {
      button.disabled = false;
    });
    // high risk never offers Always allow, not even during the scan
    if (o.risk >= 4) this.actionButton("always").disabled = true;
    const level = this.$(".lv");
    level.style.setProperty("--c", "var(--_muted)");
    rollText(level, "Scanning…", 1, false);
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(
      () => {
        const r = o.risk;
        level.style.setProperty("--c", `var(--_${r >= 4 ? "danger" : r >= 3 ? "warn" : "ok"})`);
        rollText(level, RISK_LABEL[r], 1, true);
      },
      reduced() ? 0 : SCAN_TIME * 1000,
    );
    this.kick();
  }

  private decide(d: HApproveDecision): void {
    if (this.dec || this.actionButton(d).disabled) return;
    this.dec = d;
    this.decT = now();
    // read before the buttons are disabled: a disabled button loses focus to the page
    const hadFocus = this.root.activeElement !== null;
    this.actionButtons.forEach((button) => {
      button.disabled = true;
    });
    this.resultTimer = setTimeout(
      () => {
        this.$(".full").hidden = true;
        this.$(".done").hidden = false;
        const label = this.$(".dl");
        label.textContent = d === "deny" ? "✕ Denied" : d === "always" ? "✓ Always allowed" : "✓ Allowed once";
        label.style.color = `var(--_${d === "deny" ? "danger" : "ok"})`;
        this.$(".dc").textContent = this.cur.cmd.split("\n")[0];
        // keep keyboard focus in the prompt instead of leaving it on the page
        if (hadFocus) this.$(".nx").focus();
        this.kick();
      },
      reduced() ? 0 : 650,
    );
    this.kick();
    // last, so a listener that calls request() replaces the pending result row
    this.emit<HApproveDecisionDetail>("decision", { decision: d, tool: this.cur.tool, command: this.cur.cmd });
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const local = boxMapper(canvas);
    const W = this.w;
    let busy = false;
    F.clear();
    const full = !this.$(".full").hidden;
    const scanAge = reducedMotion ? 9 : t - this.scanT;
    const risk = this.cur.risk || 1;
    if (full) {
      // scan line sweeping over the command, with a dithered trail
      const { x: x0, y: y0, w, h } = local(this.$(".cmd"));
      if (scanAge < SCAN_TIME) {
        busy = true;
        const sx = x0 + (scanAge / SCAN_TIME) * w;
        for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
          for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
            const [x] = F.xy(i, j);
            const d = sx - x;
            if (d < 0 || d > 60) continue;
            if (d < 2.5) F.put(i, j, mix(P.accent, P.shine, 0.5), 1, 0.9);
            else if (bayer(i, j) < 0.35 * (1 - d / 60)) F.put(i, j, P.accent, 0.6 * (1 - d / 60), 0.2);
          }
        }
      }
      // risk meter: five segments, green to red
      const target = scanAge > SCAN_TIME ? risk / 5 : 0;
      this.meter += (target - this.meter) * Math.min(1, reducedMotion ? 1 : dt * 6);
      if (Math.abs(this.meter - target) > 0.003) busy = true;
      const { x: mx, y: my, w: mw, h: mh } = local(this.$(".meter"));
      const segments = 5;
      for (let s = 0; s < segments; s++) {
        const a = mx + (s / segments) * mw + 1.5;
        const b = mx + ((s + 1) / segments) * mw - 1.5;
        const on = this.meter * segments > s + 0.02;
        const part = clamp(this.meter * segments - s, 0, 1);
        const c = s >= 3 ? P.danger : s >= 2 ? P.warn : P.ok;
        for (let j = Math.floor(my / pitch); j < (my + mh) / pitch; j++) {
          for (let i = Math.floor(a / pitch); i < b / pitch; i++) {
            const [x] = F.xy(i, j);
            const lit = on && (x - a) / (b - a) <= part;
            // high risk pulses
            const glow = risk >= 4 && !reducedMotion ? 0.3 + 0.3 * Math.sin(t * 6) : 0.15;
            F.put(i, j, lit ? c : P.track, 1, lit ? glow : 0);
          }
        }
      }
      if (risk >= 4 && !reducedMotion) busy = true;
    }
    if (this.dec) {
      const age = t - this.decT;
      const ok = this.dec !== "deny";
      const c = ok ? P.ok : P.danger;
      // an allow sweeps a green wash across; a deny breaks into red static
      if (age < 1.2 && !reducedMotion) {
        busy = true;
        for (let j = 0; j < F.rows; j++) {
          for (let i = 0; i < F.cols; i++) {
            const [x] = F.xy(i, j);
            if (ok) {
              const f = x / W - (age / 0.6 - 0.2);
              if (f < 0 && f > -0.35 && bayer(i, j) < 0.6 * (1 + f / 0.35)) {
                F.put(i, j, c, 0.7 * (1 - age / 1.2), 0.4 * (1 + f / 0.35));
              }
            } else if (h2(i, j + Math.floor(t * 30)) < 0.32 * (1 - age / 1.2)) {
              F.put(i, j, c, 0.75 * (1 - age / 1.2), 0.2);
            }
          }
        }
      }
      // a coloured bar left of the result line
      const done = this.$(".done");
      if (!done.hidden) {
        const x0 = local(done).x - 16;
        for (let j = 0; j < F.rows; j++) {
          for (let i = Math.floor(x0 / pitch); i < (x0 + 4) / pitch; i++) F.put(i, j, c, 1, 0.5);
        }
      }
    }
    this.flush(0.8, 4);
    return busy;
  }
}

define("hf-approve", HApprove);

declare global {
  interface HTMLElementTagNameMap {
    "hf-approve": HApprove;
  }
}

export { HApprove };

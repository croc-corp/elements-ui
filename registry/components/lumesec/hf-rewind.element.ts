/**
 * <hf-rewind> · Checkpoints
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/rewind
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-rewind.tsx.
 *
 * Demo data: The five checkpoints and their code are invented; only `label` can be set. It cannot show your
 * own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  HF,
  bayer,
  boxMapper,
  clamp,
  define,
  escapeHtml,
  h2,
  inRR,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Detail of the `preview` and `restore` events. */
export interface CheckpointDetail {
  index: number;
  name: string;
}

/** Events fired by `<hf-rewind>`. */
export interface HRewindEventMap {
  /** The head moved to another checkpoint by drag, click or key. */
  preview: CustomEvent<CheckpointDetail>;
  /** Restore was pressed, including on the latest checkpoint. */
  restore: CustomEvent<CheckpointDetail>;
}

/** A checkpoint of the coding session: its name and the code at that point. */
interface Checkpoint {
  n: string;
  code: readonly string[];
}

const CHECKPOINTS: readonly Checkpoint[] = [
  { n: "Start", code: ["export async function refresh(session) {", "  return login();", "}"] },
  {
    n: "Expiry",
    code: [
      "export async function refresh(session) {",
      "  const token = session.token;",
      "  if (Date.now() > token.expires) {",
      "    return login();",
      "  }",
      "  return token;",
      "}",
    ],
  },
  {
    n: "Rotate",
    code: [
      "export async function refresh(session) {",
      "  const token = session.token;",
      "  if (isExpired(token)) {",
      "    return rotate(token);",
      "  }",
      "  return token;",
      "}",
    ],
  },
  {
    n: "Skew",
    code: [
      "export async function refresh(session) {",
      "  const token = session.token;",
      "  if (isExpired(token, { skewMs: 30_000 })) {",
      "    return rotate(token);",
      "  }",
      "  return token;",
      "}",
    ],
  },
  {
    n: "Audit",
    code: [
      "export async function refresh(session) {",
      "  const token = session.token;",
      "  if (isExpired(token, { skewMs: 30_000 })) {",
      "    const next = await rotate(token);",
      "    audit.log('token.rotated', { user: session.user });",
      "    return next;",
      "  }",
      "  return token;",
      "}",
    ],
  },
];

const LAST = CHECKPOINTS.length - 1;

/** Checkpoint steps per key; Home and End overshoot and are clamped. */
const STEP_KEYS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  Home: -99,
  End: 99,
};

const WHITE: RGB = [255, 255, 255];

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Checkpoint scrubber for a coding session: each jump runs a rewind glitch over the code. */
class HRewind extends HF {
  /** Selected checkpoint. */
  private index = LAST;
  /** Spring-animated head position in px, and its velocity. */
  private headX = 0;
  private headV = 0;
  private dragging = false;
  /** Time of the last jump. */
  private movedAt = -9;
  /** Direction of the last jump: -1 back, 1 forward. */
  private dirn = -1;
  /** Whether the code pane shows the selected checkpoint; it swaps mid-glitch. */
  private swapped = true;
  /** Checkpoint shown in the code pane. */
  private shown = LAST;
  /** Time of the last Restore; 0 before the first. */
  private restoredAt = 0;
  /** Time the code pane was last repainted. */
  private paintedAt = 0;
  private readonly track = this.$(".tr");
  private readonly code = this.$(".code");

  constructor() {
    super(
      `
      :host { display: block; }
      .w { position: relative; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 2; }
      .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .hd .st { margin-left: auto; font-size: 12px; color: var(--_muted); }
      .tr { position: relative; height: 62px; touch-action: none; cursor: pointer; outline: none; border-radius: 10px; }
      .tr:focus-visible { box-shadow: 0 0 0 2px var(--_accent); }
      .tl { position: absolute; top: 40px; transform: translateX(-50%); font-size: 11.5px; color: var(--_muted); white-space: nowrap; transition: color .2s; }
      .tl.on { color: var(--_fg); font-weight: 600; }
      .tl:first-of-type { transform: none; } .tl:last-of-type { transform: translateX(-100%); }
      .code { position: relative; margin-top: 6px; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); padding: 10px 0; font-family: var(--_mono); font-size: 12px; line-height: 20px; min-height: 204px; overflow-x: auto; }
      .ln { display: flex; white-space: pre; padding-right: 12px; }
      .ln i { width: 32px; flex: none; text-align: right; padding-right: 10px; color: var(--_muted); font-style: normal; opacity: .65; }
      .ft { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
      .ft .msg { font-size: 12px; color: var(--_muted); flex: 1 1 200px; min-width: 0; }
      .ft .pbtn { margin-left: auto; }
      `,
      `<div class="w"><canvas class="px" aria-hidden="true"></canvas><div class="hd"><b class="ti"></b><span class="rollslot st"></span></div><div class="tr" tabindex="0" role="slider" aria-label="Checkpoint"></div><div class="code"></div></div><div class="ft"><span class="rollslot msg" aria-live="polite"></span><button class="pbtn rs" type="button">Restore</button></div>`,
      2,
      0.72,
    );
    const track = this.track;
    const at = (e: PointerEvent): number => {
      const [x] = localPoint(track, e);
      return clamp(Math.round(((x - 14) / (track.offsetWidth - 28)) * LAST), 0, LAST);
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; dragging works without capture
      }
      this.dragging = true;
      this.go(at(e));
    });
    track.addEventListener("pointermove", (e) => {
      if (this.dragging) this.go(at(e));
    });
    track.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    track.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    track.addEventListener("keydown", (e) => {
      const step = STEP_KEYS[e.key];
      if (step == null) return;
      e.preventDefault();
      this.go(clamp(this.index + step, 0, LAST));
    });
    this.$(".rs").addEventListener("click", () => {
      const checkpoint = CHECKPOINTS[this.index];
      const later = LAST - this.index;
      const message =
        this.index === LAST
          ? "Already on the latest checkpoint"
          : `Restored “${checkpoint.n}” · ${plural(later, "later checkpoint")} kept`;
      rollText(this.$(".msg"), message, 1, true);
      this.emit<CheckpointDetail>("restore", { index: this.index, name: checkpoint.n });
      this.restoredAt = now();
      this.kick();
    });
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Checkpoints";
    const track = this.track;
    track.innerHTML = CHECKPOINTS.map((c, k) => `<span class="tl" data-k="${k}">${escapeHtml(c.n)}</span>`).join("");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(LAST));
    this.paint();
    rollText(this.$(".msg"), "Drag back to preview older code", 1, false);
  }

  protected override layout(): void {
    this.$$(".tl").forEach((el, k) => {
      el.style.left = `${this.nodeX(k)}px`;
    });
    if (!this.headX) this.headX = this.nodeX(this.index);
  }

  /** X of checkpoint `k` on the track, 14px in from each end. */
  private nodeX(k: number): number {
    return 14 + (k / LAST) * (this.w - 28);
  }

  private go(k: number): void {
    if (k === this.index) return;
    this.dirn = k < this.index ? -1 : 1;
    this.index = k;
    this.movedAt = now();
    this.swapped = false;
    if (reduced()) this.paint();
    this.emit<CheckpointDetail>("preview", { index: k, name: CHECKPOINTS[k].n });
    this.kick();
  }

  /** Show the selected checkpoint's code; lines not in the previous version are marked new. */
  private paint(): void {
    const checkpoint = CHECKPOINTS[this.index];
    const prev = CHECKPOINTS[this.shown]?.code ?? [];
    this.code.innerHTML = checkpoint.code
      .map((line, i) => `<div class="ln${prev.includes(line) ? "" : " nw"}"><i>${i + 12}</i>${escapeHtml(line)}</div>`)
      .join("");
    this.shown = this.index;
    this.swapped = true;
    this.paintedAt = now();
    this.$$(".tl").forEach((el, i) => el.classList.toggle("on", i === this.index));
    this.track.setAttribute("aria-valuenow", String(this.index));
    this.track.setAttribute("aria-valuetext", checkpoint.n);
    const back = LAST - this.index;
    rollText(this.$(".st"), back ? `${plural(back, "step")} back` : "Latest", this.dirn, true);
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const local = boxMapper(canvas);
    const tr = local(this.track);
    const ty = tr.y + 22;
    const cx0 = tr.x;
    const tx = cx0 + this.nodeX(this.index);
    if (R0) {
      this.headX = tx;
      this.headV = 0;
    } else {
      // damped spring towards the selected checkpoint
      const k = 260;
      const c = 2 * Math.sqrt(k) * 0.75;
      this.headV += (k * (tx - this.headX) - c * this.headV) * dt;
      this.headX += this.headV * dt;
    }
    let busy = Math.abs(tx - this.headX) > 0.3 || this.dragging;
    const age = t - this.movedAt;
    if (!this.swapped && age > 0.2) this.paint();
    F.clear();
    // track
    for (let j = Math.floor((ty - 1.5) / pp); j <= (ty + 1.5) / pp; j++) {
      for (let i = Math.floor((cx0 + 14) / pp); i < (cx0 + this.w - 14) / pp; i++) {
        const [x] = F.xy(i, j);
        const past = x <= this.headX;
        F.put(i, j, past ? mix(P.accent, P.shine, 0.2) : P.track, 1, past ? 0.1 : 0);
      }
    }
    for (let k = 0; k < CHECKPOINTS.length; k++) {
      const nx = cx0 + this.nodeX(k);
      const on = k <= this.index;
      for (let j = Math.floor((ty - 6) / pp); j <= (ty + 6) / pp; j++) {
        for (let i = Math.floor((nx - 6) / pp); i <= (nx + 6) / pp; i++) {
          const [x, y] = F.xy(i, j);
          if (Math.hypot(x - nx, y - ty) < 5) {
            F.put(i, j, on ? mix(P.accent, P.shine, 0.3) : P.muted, on ? 1 : 0.7, on ? 0.2 : 0);
          }
        }
      }
    }
    // head: a vertical bar with a cap
    for (let j = Math.floor((ty - 15) / pp); j <= (ty + 11) / pp; j++) {
      for (let i = Math.floor((this.headX - 7) / pp); i <= (this.headX + 7) / pp; i++) {
        const [x, y] = F.xy(i, j);
        const cap = y < ty - 7 && Math.hypot(x - this.headX, y - (ty - 11)) < 5.5;
        const stem = Math.abs(x - this.headX) < 1.6;
        if (cap || stem) F.put(i, j, this.dark ? WHITE : P.fg, 1, 0.5);
      }
    }
    // rewind glitch over the code pane
    const { x: x0, y: y0, w, h } = local(this.code);
    if (age < 0.45 && !R0) {
      busy = true;
      const k = 1 - Math.abs(age - 0.2) / 0.25;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        // bands of five rows scroll in the jump direction and shift sideways
        const band = Math.floor((j + Math.floor(-this.dirn * t * 60)) / 5);
        if (h2(band, Math.floor(t * 20)) > 0.55 * k + 0.1) continue;
        const shift = (h2(band, 3) - 0.5) * 30 * k;
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x] = F.xy(i, j);
          if (inRR(x - x0, (j + 0.5) * pp - y0, w, h, 12) > 0) continue;
          const nz = h2(i + Math.round(shift), j);
          const lit = nz < 0.5;
          const color = lit ? mix(P.accent, P.shine, nz) : P.surface;
          F.put(i, j, color, clamp(k, 0, 1) * (lit ? 0.9 : 1), nz < 0.2 ? 0.5 * k : 0);
        }
      }
    }
    // new or changed lines get a green bar
    const flash = this.restoredAt ? clamp(1 - (t - this.restoredAt) / 0.7, 0, 1) : 0;
    if (flash > 0) busy = true;
    this.$$(".code .ln").forEach((el) => {
      const r = local(el);
      const ly = r.y;
      const isNew = el.classList.contains("nw");
      if (!isNew && flash <= 0) return;
      const ag = clamp((t - this.paintedAt) / 0.6, 0, 1);
      if (ag < 1) busy = true;
      for (let j = Math.floor(ly / pp); j < (ly + r.h) / pp; j++) {
        for (let i = Math.floor((x0 + 2) / pp); i < (x0 + 5) / pp; i++) {
          if (isNew) F.put(i, j, P.ok, 1, 0.3);
        }
        if (isNew && ag < 1) {
          for (let i = Math.floor((x0 + 6) / pp); i < (x0 + 6 + (1 - ag) * w * 0.9) / pp; i++) {
            if (bayer(i, j) < 0.25 * (1 - ag)) F.put(i, j, P.ok, 0.5, 0.2);
          }
        }
        if (flash > 0) {
          const i = Math.round((x0 + (1 - flash) * w) / pp);
          F.put(i, j, P.accent, flash, flash);
        }
      }
    });
    this.flush(0.8, 4);
    return busy;
  }
}

define("hf-rewind", HRewind);

export { HRewind };

declare global {
  interface HTMLElementTagNameMap {
    "hf-rewind": HRewind;
  }
}

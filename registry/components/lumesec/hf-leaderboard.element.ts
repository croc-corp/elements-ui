/**
 * <hf-leaderboard> · Live leaderboard
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/leaderboard
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-leaderboard.tsx.
 *
 * Data: set `data` (property, or JSON in the attribute) to your rows of names and values. Each update
 * re-ranks the rows: changed values show their difference, overtaking rows slide past each other. Without it
 * six invented teams receive random score increases; with it nothing is simulated.
 */
import { finite, isRecord, readJson, rows, text } from "@/lib/lumesec/data";
import { HF, bayer, clamp, define, fmtInt, h2, inRR, mix, now, reduced, rollText } from "@/lib/lumesec/pixel";

/** One row of the leaderboard; rows are matched across updates by `name`. */
export type HfLeaderboardDatum = {
  name: string;
  /** Score; rows are ranked by it, highest first, and bars are scaled to the highest. */
  value: number;
};

/** A parsed row: name and value. */
interface Entry {
  n: string;
  s: number;
}

/** Normalises `data`: `{ name, value }` records with a non-empty name; anything else is dropped. */
const parseEntries = (value: unknown): Entry[] | null =>
  rows(value, (entry) => {
    if (!isRecord(entry)) return null;
    const n = text(entry.name).trim();
    const s = finite(entry.value, NaN);
    return n && Number.isFinite(s) ? { n, s } : null;
  });

/** Demo teams and their starting scores. */
const TEAMS: readonly (readonly [name: string, score: number])[] = [
  ["Platform", 182],
  ["Payments", 171],
  ["Growth", 158],
  ["Mobile", 140],
  ["Research", 131],
  ["Infra", 119],
];

/** Row pitch in px. */
const ROW = 40;
/** Milliseconds between score updates. */
const TICK_MS = 1700;

/** A score: whole numbers grouped (`1,204`), fractions with up to two decimals. */
const fmtScore = (v: number): string =>
  Number.isInteger(v) ? fmtInt(v) : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A team row: name, score, its elements, current rank and the eased bar width. */
interface TeamRow {
  /** Identity across updates: the name, with a suffix for repeated names. */
  key: string;
  n: string;
  s: number;
  el: HTMLDivElement;
  rankEl: HTMLElement;
  deltaEl: HTMLElement;
  scoreEl: HTMLElement;
  rank: number;
  /** Time of the last score increase. */
  bump: number;
  /** Drawn bar width in px. */
  w: number;
  /** Timer that hides the `+n` delta again. */
  deltaTimer: number;
}

/** A trail left by a row that changed rank, from and to row tops in px. */
interface RankTrail {
  from: number;
  to: number;
  t0: number;
  up: boolean;
}

/** Live leaderboard: scores tick up, overtaking rows slide past each other with trails and the leader gets a ring. */
class HLeaderboard extends HF {
  static readonly observedAttributes = ["data", "label"] as const;

  private teams: TeamRow[] = [];
  private trails: RankTrail[] = [];
  /** Your rows from `data`; null shows the demo teams. */
  private input: Entry[] | null = null;
  /** Whether the rows on screen are yours; switching between yours and the demo rebuilds them. */
  private shownInput = false;
  private live = true;
  private timer = 0;
  /** Highest score; bars are scaled to it. */
  private max = 1;
  private readonly toggle = this.$<HTMLButtonElement>(".tg");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .hd .pbtn { margin-left: auto; }
      .hd .pbtn[hidden] { display: none; }
      .ls { position: relative; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .r { position: absolute; left: 0; right: 0; height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 8px; transition: top .7s cubic-bezier(.3,1.2,.4,1); font-size: 13.5px; }
      .r .rk { width: 22px; text-align: center; font-weight: 700; font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .r .nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .r .sc { margin-left: auto; font-weight: 650; font-variant-numeric: tabular-nums; }
      .r .dl { font-size: 11px; font-weight: 700; min-width: 24px; text-align: right; color: var(--c, transparent); font-variant-numeric: tabular-nums; }
      .em { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 12px; font-size: 13px; color: var(--_muted); }
      .em[hidden] { display: none; }
      @media (prefers-reduced-motion: reduce) { .r { transition: none; } }
      `,
      `<div class="hd"><b class="ti"></b><button class="pbtn tg" type="button" aria-pressed="true">Live</button></div><div class="ls" role="list"><canvas class="px" aria-hidden="true"></canvas><div class="em" role="listitem" hidden>No data</div></div>`,
      2,
      0.74,
    );
    this.toggle.addEventListener("click", () => {
      this.live = !this.live;
      this.toggle.setAttribute("aria-pressed", String(this.live));
      this.toggle.textContent = this.live ? "Live" : "Paused";
    });
  }

  attributeChangedCallback(name: string): void {
    if (name === "label") {
      if (this.initialized) this.syncLabel();
      return;
    }
    this.input = parseEntries(readJson(this));
    this.reload();
  }

  private syncLabel(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Merged PRs this quarter";
  }

  /** Your rows in the order you gave them; `null` while the demo teams show. Setting it re-ranks the rows. */
  get data(): readonly HfLeaderboardDatum[] | null {
    return this.input && this.input.map((e) => ({ name: e.n, value: e.s }));
  }

  set data(value: readonly HfLeaderboardDatum[] | null) {
    this.input = parseEntries(value);
    this.reload();
  }

  /** Applies the current rows (yours or the demo teams) and starts or stops the demo updates. */
  private reload(): void {
    if (!this.initialized) return;
    // already on the demo: keep its current scores
    if (!this.input && !this.shownInput) return this.sync();
    if (this.shownInput !== !!this.input) {
      // no deltas or trails between demo teams and your rows
      for (const team of this.teams) {
        clearTimeout(team.deltaTimer);
        team.el.remove();
      }
      this.teams = [];
      this.trails = [];
    }
    this.apply(this.input ?? TEAMS.map(([n, s]) => ({ n, s })), true);
    this.sync();
    this.kick();
  }

  /** Runs the demo updates only while connected and without your data. */
  private sync(): void {
    const want = this.initialized && this.isConnected && !this.input;
    if (want && !this.timer) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
    // the Live toggle only pauses the demo
    this.toggle.hidden = !!this.input;
  }

  protected override init(): void {
    this.syncLabel();
    this.apply(this.input ?? TEAMS.map(([n, s]) => ({ n, s })), false);
    this.sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.sync();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // re-inserted: restart the updates stopped on disconnect
    this.sync();
  }

  /** A row element for `n`, unranked until `order()` places it. */
  private makeRow(key: string, n: string, s: number): TeamRow {
    const list = this.$(".ls");
    const el = document.createElement("div");
    el.className = "r";
    el.setAttribute("role", "listitem");
    el.innerHTML = `<span class="rk rollslot"></span><span class="nm"></span><span class="dl"></span><span class="sc rollslot"></span>`;
    el.querySelector<HTMLElement>(".nm")!.textContent = n;
    list.append(el);
    return {
      key,
      n,
      s,
      el,
      rankEl: el.querySelector<HTMLElement>(".rk")!,
      deltaEl: el.querySelector<HTMLElement>(".dl")!,
      scoreEl: el.querySelector<HTMLElement>(".sc")!,
      rank: -1,
      bump: -9,
      w: 0,
      deltaTimer: 0,
    };
  }

  /** Shows `+n` or `−n` next to a row's score for 1.2 s; an increase also sweeps a sheen over its bar. */
  private flashDelta(team: TeamRow, add: number): void {
    if (add > 0) team.bump = now();
    team.deltaEl.textContent = `${add > 0 ? "+" : "−"}${fmtScore(Math.abs(add))}`;
    team.deltaEl.style.setProperty("--c", `var(--_${add > 0 ? "ok" : "danger"})`);
    clearTimeout(team.deltaTimer);
    team.deltaTimer = window.setTimeout(() => team.deltaEl.style.setProperty("--c", "transparent"), 1200);
  }

  /**
   * Matches `entries` to the rows by name: new names get a row, missing names lose theirs, changed values
   * flash their difference. Then ranks the rows, animated when `anim`.
   */
  private apply(entries: readonly Entry[], anim: boolean): void {
    const old = new Map(this.teams.map((team) => [team.key, team]));
    const seen = new Map<string, number>();
    const next: TeamRow[] = [];
    for (const { n, s } of entries) {
      const count = seen.get(n) ?? 0;
      seen.set(n, count + 1);
      const key = count ? `${n}\u0000${count}` : n;
      const team = old.get(key);
      if (team) {
        old.delete(key);
        if (anim && team.s !== s) this.flashDelta(team, s - team.s);
        team.s = s;
        next.push(team);
      } else next.push(this.makeRow(key, n, s));
    }
    for (const team of old.values()) {
      clearTimeout(team.deltaTimer);
      team.el.remove();
    }
    this.teams = next;
    this.$(".ls").style.height = `${Math.max(1, next.length) * ROW}px`;
    this.$(".em").hidden = next.length > 0;
    this.shownInput = !!this.input;
    this.order(anim);
  }

  /** Add a random amount to a random demo team; lower teams get bigger jumps so ranks change. */
  private tick(): void {
    if (!this.live || !this.onScreen || this.input || !this.teams.length) return;
    const team = this.teams[Math.floor(Math.random() * this.teams.length)];
    const add = 3 + Math.floor(Math.random() * (team.rank > 2 ? 16 : 7));
    team.s += add;
    this.flashDelta(team, add);
    this.order(true);
    this.kick();
  }

  /** Sort by score, move rows to their rank and roll ranks and scores; rank changes leave trails. */
  private order(anim: boolean): void {
    const sorted = [...this.teams].sort((a, b) => b.s - a.s);
    sorted.forEach((team, k) => {
      // new rows appear at their rank without a trail
      if (anim && team.rank >= 0 && team.rank !== k && !reduced()) {
        this.trails.push({ from: team.rank * ROW, to: k * ROW, t0: now(), up: k < team.rank });
      }
      const prev = team.rank;
      team.rank = k;
      team.el.style.top = `${k * ROW}px`;
      rollText(team.rankEl, String(k + 1), k < prev ? -1 : 1, anim && prev >= 0 && prev !== k);
      rollText(team.scoreEl, fmtScore(team.s), 1, anim);
      team.el.setAttribute("aria-label", `${k + 1}. ${team.n}, ${fmtScore(team.s)}`);
    });
    // bars grow from zero up; without a positive score there is nothing to scale to
    this.max = Math.max(0, sorted[0]?.s ?? 0) || 1;
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const W = this.w;
    let busy = false;
    F.clear();
    this.trails = this.trails.filter((q) => t - q.t0 < 0.9);
    for (const q of this.trails) {
      busy = true;
      const a = (t - q.t0) / 0.9;
      const x = 20;
      const y0 = Math.min(q.from, q.to) + 19;
      const y1 = Math.max(q.from, q.to) + 19;
      for (let j = Math.floor(y0 / pp); j <= y1 / pp; j++) {
        const [, y] = F.xy(0, j);
        // the trail grows from the old rank towards the new one
        const f = q.up ? (y1 - y) / (y1 - y0 || 1) : (y - y0) / (y1 - y0 || 1);
        if (f > a * 1.6) continue;
        for (let i = Math.floor((x - 2) / pp); i <= (x + 2) / pp; i++) {
          F.put(i, j, q.up ? P.ok : P.danger, (1 - a) * 0.9, (1 - a) * 0.6);
        }
      }
    }
    for (const team of this.teams) {
      // the row's sliding position in CSS pixels; the canvas covers the list, so the offsets are canvas coordinates
      const top = team.el.offsetTop;
      const y0 = top + 3;
      const h = team.el.offsetHeight - 6;
      const x0 = 36;
      const wmax = W - x0 - 4;
      if (Math.abs(top - team.rank * ROW) > 0.5) busy = true;
      const target = clamp(team.s / this.max, 0, 1) * wmax;
      team.w += (target - team.w) * Math.min(1, R0 ? 1 : dt * 6);
      if (Math.abs(target - team.w) > 0.3) busy = true;
      const bump = R0 ? 0 : clamp(1 - (t - team.bump) / 0.8, 0, 1);
      const leader = team.rank === 0;
      if (bump > 0) busy = true;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + team.w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          if (inRR(lx, ly, team.w, h, 7) > 0) continue;
          const u = lx / team.w;
          // a sheen sweeps the bar after a score increase
          const sheen = bump > 0 && Math.abs(u - (1 - bump)) < 0.022;
          if (!sheen && bayer(i, j) > 0.12 + 0.3 * u + (leader ? 0.08 : 0)) continue;
          const color = sheen
            ? mix(P.ok, P.shine, 0.4)
            : mix(leader ? P.warn : P.accent, P.surface, this.dark ? 0.35 : 0.45);
          F.put(i, j, color, sheen ? 1 : 0.85, sheen ? 0.7 : leader ? 0.08 : 0);
        }
      }
      // leader ring
      if (leader && !R0) {
        busy = true;
        const cx = 20;
        const cy = y0 + h / 2;
        for (let j = Math.floor((cy - 12) / pp); j <= (cy + 12) / pp; j++) {
          for (let i = Math.floor((cx - 12) / pp); i <= (cx + 12) / pp; i++) {
            const [x, y] = F.xy(i, j);
            const d = Math.hypot(x - cx, y - cy);
            if (Math.abs(d - 10.5) < 1 && h2(i, j) < 0.6) {
              F.put(i, j, P.warn, 0.5 + 0.5 * Math.sin(t * 3 + Math.atan2(y - cy, x - cx) * 2), 0.6);
            }
          }
        }
      }
    }
    this.flush(0.8, 4);
    return busy || (this.live && !this.input && !R0);
  }
}

define("hf-leaderboard", HLeaderboard);

export { HLeaderboard };

declare global {
  interface HTMLElementTagNameMap {
    "hf-leaderboard": HLeaderboard;
  }
}

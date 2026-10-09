/**
 * <px-uptime> · Uptime history
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/uptime
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-uptime.tsx.
 *
 * Data: set `data` (property, or JSON in the attribute) to your daily uptime records, one row per service.
 * Without it the element shows invented demo services with hash-seeded statuses.
 */
import { finite, isRecord, readJson, rows, text, toDate } from "@/lib/lumesec/data";
import { PxBase, clamp, css, define, hash, mix, now, reduced } from "@/lib/lumesec/pixel";

const SERVICES = ["API", "Console", "Workflows"] as const;

/** Day status: 0 no incidents, 1 degraded, 2 outage, -1 no data. */
type DayStatus = -1 | 0 | 1 | 2;

/** Status names of the `data` records. */
type StatusName = "ok" | "degraded" | "down";

/** {@link DayStatus} per status name. */
const STATUS: Record<StatusName, DayStatus> = { ok: 0, degraded: 1, down: 2 };

/**
 * One day (or period) of uptime, oldest first per service: a percentage, or a record. Records with the same
 * `service` form one row, in order of first appearance; records without `service` share a row named `Uptime`.
 */
export type PxUptimeDatum =
  | number
  | {
      /** Service the day belongs to, shown as the row label. */
      service?: string;
      /** Day of the record, as a `Date`, an ISO string or epoch ms. Without it days count back from today. */
      date?: string | number | Date;
      /** Uptime of the day in percent (0 to 100). Averaged into the service's figure. */
      uptime?: number;
      /** Status of the day. Without it the status follows from `uptime`: 99.9 or more ok, 99 or more degraded. */
      status?: StatusName;
      /** Free text for the tooltip, e.g. the incident. */
      note?: string;
    };

/** A day as drawn: status, uptime (null when unknown), date and tooltip text. */
interface Day {
  status: DayStatus;
  uptime: number | null;
  date: Date | null;
  note: string;
}

/** A parsed entry of `data`, before grouping into rows. */
interface Parsed extends Day {
  service: string;
}

/** A service row. */
interface Row {
  name: string;
  days: Day[];
}

/** A hovered day of one service. */
interface DayCell {
  day: number;
  service: number;
}

/** Row label for records without `service`. */
const DEFAULT_SERVICE = "Uptime";

/** Status from an uptime percentage, for records without `status`. */
const statusOf = (uptime: number): DayStatus => (uptime >= 99.9 ? 0 : uptime >= 99 ? 1 : 2);

/** Normalises one entry of `data`: a percentage or a record; anything else is dropped. */
function parseEntry(entry: unknown): Parsed | null {
  const rec = isRecord(entry) ? entry : null;
  const v = finite(rec ? rec.uptime : entry, NaN);
  if (!rec && !Number.isFinite(v)) return null;
  const uptime = Number.isFinite(v) ? clamp(v, 0, 100) : null;
  const name = text(rec?.status).toLowerCase();
  const status: DayStatus =
    name === "ok" || name === "degraded" || name === "down" ? STATUS[name] : uptime === null ? -1 : statusOf(uptime);
  const service = text(rec?.service).trim() || DEFAULT_SERVICE;
  return { service, status, uptime, date: toDate(rec?.date), note: text(rec?.note) };
}

/** Groups `data` into service rows. Not an array gives null. */
function parseRows(value: unknown): Row[] | null {
  const records = rows(value, parseEntry);
  if (!records) return null;
  const byName = new Map<string, Row>();
  for (const { service, ...day } of records) {
    let row = byName.get(service);
    if (!row) byName.set(service, (row = { name: service, days: [] }));
    row.days.push(day);
  }
  return [...byName.values()];
}

/** Height of one service row in px. */
const ROW_H = 56;
/** Column pitch in px; the canvas shows as many days as fit, up to 90 in the demo. */
const COL_PITCH = 5;
const MAX_DAYS = 90;
/** Duration of the sweep-in in seconds. */
const REVEAL_TIME = 1.2;

/** Deterministic demo status of a service on a day. */
function dayStatus(service: number, day: number): DayStatus {
  const v = hash(service * 101.3 + day * 7.77);
  return v > 0.975 ? 2 : v > 0.93 ? 1 : 0;
}

/** Demo uptime percentage of a day. */
function dayUptime(service: number, day: number): number {
  const status = dayStatus(service, day);
  if (status === 0) return 100;
  if (status === 1) return 99.6 - hash(service + day) * 0.4;
  return 97 - hash(service * 3 + day) * 1.5;
}

/** Tooltip text for a demo day's status. */
function statusText(status: DayStatus, service: number, day: number): string {
  if (status === 0) return "No incidents";
  if (status === 1) return `Degraded ${Math.round(10 + hash(day + service) * 40)} min`;
  return `Outage ${Math.round(20 + hash(day * 2 + service) * 70)} min`;
}

/** Tooltip text for a day of your data: status, uptime and note. */
function dataText(day: Day): string {
  const status = ["Operational", "Degraded", "Down"][day.status] ?? "No data";
  return [status, day.uptime === null ? "" : `${day.uptime.toFixed(2)}%`, day.note].filter(Boolean).join(" · ");
}

/** `Sep 3`, or `Today` for the current day. */
const dayLabel = (d: Date): string =>
  d.toDateString() === new Date().toDateString()
    ? "Today"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Ninety days of uptime per service as pixel columns swept in on load; hovering a day lifts that column across all
 * services.
 */
class Uptime extends PxBase {
  static readonly observedAttributes = ["data"] as const;

  private hover: DayCell | null = null;
  /** Time the element was created; the columns sweep in from then. */
  private readonly createdAt = now();
  /** Number of day columns shown; 0 until the first layout. */
  private days = 0;
  /** Your services from `data`; null shows the demo services. */
  private input: Row[] | null = null;
  /** The rows drawn: your services or the demo, cut to the shown days. Rebuilt on layout and data changes. */
  private shown: Row[] = [];
  /** Font stacks for the row labels, read on layout. */
  private sans = "sans-serif";
  private mono = "monospace";

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      canvas.px { height: 168px; cursor: crosshair; }
      .tip { position: absolute; pointer-events: none; padding: 5px 8px; border-radius: 6px; background: var(--_fg); color: var(--_surface); font-size: 11.5px; white-space: nowrap; transform: translate(-50%, calc(-100% - 6px)); z-index: 3; }
      .ends { display: flex; justify-content: space-between; font-family: var(--_mono); font-size: 11px; color: var(--_muted); margin-top: 4px; }
      `,
      `<canvas class="px" role="img" aria-label="Uptime for the last 90 days"></canvas><div class="ends"><span class="ago"></span><span class="end">Today</span></div><div class="tip" hidden></div>`,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = this.cellAt(e.clientX - r.left, e.clientY - r.top);
      this.updateTip();
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.updateTip();
      this.kick();
    });
  }

  attributeChangedCallback(name: string): void {
    if (name !== "data") return;
    this.input = parseRows(readJson(this));
    this.reload();
  }

  /**
   * Your uptime records, grouped per service in order; `null` while the element shows demo data. Setting it
   * redraws.
   */
  get data(): readonly PxUptimeDatum[] | null {
    return (
      this.input &&
      this.input.flatMap((row) =>
        row.days.map((d) => {
          const out: Exclude<PxUptimeDatum, number> = { service: row.name };
          if (d.date) out.date = d.date.toISOString();
          if (d.uptime !== null) out.uptime = d.uptime;
          if (d.status === 0) out.status = "ok";
          else if (d.status === 1) out.status = "degraded";
          else if (d.status === 2) out.status = "down";
          if (d.note) out.note = d.note;
          return out;
        }),
      )
    );
  }

  set data(value: readonly PxUptimeDatum[] | null) {
    this.input = parseRows(value);
    this.reload();
  }

  /** Resizes the canvas to the number of services and re-lays out after the data changed. */
  private reload(): void {
    this.$("canvas").style.height = this.input ? `${Math.max(1, this.input.length) * ROW_H}px` : "";
    this.hover = null;
    this.updateTip();
    if (this.w) this.layout();
    this.kick();
  }

  /** Average uptime of a row over the shown days; null when no shown day has an uptime. */
  private percent(row: Row): number | null {
    let total = 0;
    let count = 0;
    for (const d of row.days) {
      if (d.uptime === null) continue;
      total += d.uptime;
      count++;
    }
    return count ? total / count : null;
  }

  protected override resized(): void {
    this.sans = getComputedStyle(this).fontFamily || "sans-serif";
    this.mono = this.monoFont;
    this.layout();
  }

  /** Each row's name and average uptime, for the canvas label. */
  private figures(): string {
    return this.shown
      .map((row) => {
        const p = this.percent(row);
        return `${row.name} ${p === null ? "no uptime data" : `${p.toFixed(2)}%`}`;
      })
      .join(", ");
  }

  /** Works out the shown days from the width and the data, and rebuilds the rows, labels and `aria-label`. */
  private layout(): void {
    const fit = Math.floor((this.w + 1) / COL_PITCH);
    const canvas = this.$("canvas");
    const input = this.input;
    if (!input) {
      this.days = Math.min(MAX_DAYS, fit);
      this.shown = SERVICES.map((name, service) => ({
        name,
        days: Array.from({ length: this.days }, (_, day) => {
          const status = dayStatus(service, day);
          return { status, uptime: dayUptime(service, day), date: null, note: statusText(status, service, day) };
        }),
      }));
      this.$(".ago").textContent = `${this.days} days ago`;
      this.$(".end").textContent = "Today";
      canvas.setAttribute("aria-label", `Uptime for the last ${this.days} days: ${this.figures()}`);
      return;
    }
    this.days = Math.min(fit, Math.max(0, ...input.map((row) => row.days.length)));
    // services with fewer days are aligned to the right, so the latest day of every service shares a column
    this.shown = input.map((row) => ({ name: row.name, days: this.days ? row.days.slice(-this.days) : [] }));
    const dateAt = (col: number): Date | null => {
      for (const row of this.shown) {
        const date = this.dayAt(row, col)?.date;
        if (date) return date;
      }
      return null;
    };
    const first = this.days ? dateAt(0) : null;
    const last = this.days ? dateAt(this.days - 1) : null;
    this.$(".ago").textContent = !this.days ? "" : first ? dayLabel(first) : `${this.days} days ago`;
    this.$(".end").textContent = !this.days ? "" : last ? dayLabel(last) : "Today";
    const label = this.days ? `Uptime for the last ${this.days} days: ${this.figures()}` : "Uptime: no data";
    canvas.setAttribute("aria-label", label);
  }

  /** The day of a row at a column, or undefined where the row has no day (shorter rows start later). */
  private dayAt(row: Row, col: number): Day | undefined {
    return row.days[col - (this.days - row.days.length)];
  }

  private cellAt(x: number, y: number): DayCell | null {
    const day = Math.floor(x / (this.w / this.days));
    const service = Math.floor(y / ROW_H);
    if (day < 0 || day >= this.days || service < 0 || service >= this.shown.length) return null;
    return { day, service };
  }

  private updateTip(): void {
    const tip = this.$(".tip");
    const row = this.hover && this.shown[this.hover.service];
    const d = this.hover && row && this.dayAt(row, this.hover.day);
    if (!this.hover || !row || !d) {
      tip.hidden = true;
      return;
    }
    const { day, service } = this.hover;
    const date = (d.date ?? new Date(Date.now() - (this.days - 1 - day) * 864e5)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    tip.textContent = `${date} · ${row.name} · ${this.input ? dataText(d) : d.note}`;
    tip.style.left = `${clamp(((day + 0.5) * this.w) / this.days, 80, this.w - 80)}px`;
    tip.style.top = `${service * ROW_H + 22}px`;
    tip.hidden = false;
  }

  protected override render(t: number): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.w) return false;
    const P = this.P;
    this.clear();
    ctx.textBaseline = "alphabetic";
    if (!this.days) {
      if (!this.input) return false;
      ctx.font = `11.5px ${this.mono}`;
      ctx.fillStyle = css(P.muted);
      ctx.textAlign = "left";
      ctx.fillText("No data", 0, 13);
      return false;
    }
    const still = reduced();
    const colW = this.w / this.days;
    const reveal = still ? 1 : clamp((t - this.createdAt) / REVEAL_TIME, 0, 1);
    this.shown.forEach((row, service) => {
      const y0 = service * ROW_H;
      ctx.font = `500 12.5px ${this.sans}`;
      ctx.fillStyle = css(P.fg);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      ctx.fillText(row.name, 0, y0 + 13);
      ctx.font = `11.5px ${this.mono}`;
      ctx.fillStyle = css(P.muted);
      ctx.textAlign = "right";
      const p = this.percent(row);
      ctx.fillText(p === null ? "–" : `${p.toFixed(2)}%`, this.w, y0 + 13);
      for (let day = 0; day < this.days; day++) {
        if (day / this.days > reveal) continue;
        const d = this.dayAt(row, day);
        if (!d) continue;
        const status = d.status;
        const color = status < 0 ? P.track : [P.ok, P.warn, P.danger][status];
        const hovered = this.hover !== null && this.hover.day === day;
        const lift = hovered ? -3 : 0;
        // the sweep front glows
        const front = reveal < 1 && day / this.days > reveal - 0.05;
        const dotColor = front ? mix(color, P.shine, 0.6) : color;
        const alpha = hovered ? 1 : status > 0 ? 0.9 : 0.6;
        for (let r = 0; r < 4; r++) this.dot(day * colW + (colW - 3) / 2, y0 + 22 + r * 5 + lift, dotColor, alpha, 3);
      }
    });
    ctx.globalAlpha = 1;
    return reveal < 1;
  }
}

define("px-uptime", Uptime);

export { Uptime };

declare global {
  interface HTMLElementTagNameMap {
    "px-uptime": Uptime;
  }
}

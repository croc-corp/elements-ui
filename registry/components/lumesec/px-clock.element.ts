/**
 * <px-clock> · Morphing clock
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/clock
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-clock.tsx.
 */
import { PxBase, Sparks, checkRadio, clamp, define, radioKeys, rollText } from "@/lib/lumesec/pixel";

/** A time zone option: its label and IANA zone (undefined for the local zone). */
type Zone = readonly [label: string, timeZone: string | undefined];

const ZONES: readonly Zone[] = [
  ["Local", undefined],
  ["UTC", "UTC"],
  ["Tokyo", "Asia/Tokyo"],
  ["New York", "America/New_York"],
];

/** Characters of `HH:MM:SS`; the colons never change. */
const SLOTS = 8;
/** Positions of the colons in `HH:MM:SS`. */
const COLONS: readonly number[] = [2, 5];

/** The formatters for one zone and hour cycle; creating them is slow, so they are reused. */
interface ZoneFormat {
  key: string;
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
}

/**
 * Live clock where each changing digit rolls to the next and throws off a few pixels; switching time zone rolls
 * every digit at once.
 */
class Clock extends PxBase {
  private zoneIndex = 0;
  private twelveHour = false;
  /** Time string the digits are showing. */
  private shown = "";
  /** Date line last written. */
  private lastDate = "";
  private readonly sparks = new Sparks();
  /** The roll slot of each character of `HH:MM:SS`; colons are plain spans. */
  private readonly slots: HTMLElement[] = [];
  private readonly time = this.$(".time");
  private readonly spoken = this.$(".sr");
  private format: ZoneFormat | null = null;
  /** Wakes the loop for the next second while no sparks fly. */
  private tickTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .seg { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--_track); width: max-content; max-width: 100%; margin: 0 auto 14px; flex-wrap: wrap; }
      .seg button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--_muted); cursor: pointer; }
      .seg button[aria-checked="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      .face { position: relative; display: flex; justify-content: center; padding: 8px 0; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; }
      .time { position: relative; display: flex; font-family: var(--_mono); font-size: 48px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .colon { color: var(--_accent); animation: pulse 1s linear infinite; }
      @keyframes pulse { from { opacity: 1; } to { opacity: .35; } }
      .row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 10px; }
      .date { font-size: 13px; color: var(--_muted); }
      `,
      `<div class="seg" role="radiogroup" aria-label="Time zone"></div><div class="face"><canvas class="px" aria-hidden="true"></canvas><div class="time" role="timer" aria-live="off"><span class="sr"></span></div></div><div class="row"><span class="rollslot date"></span><button class="pbtn h12" type="button" aria-pressed="false">12-hour</button></div>`,
    );
    const segment = this.$(".seg");
    ZONES.forEach(([label], i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.textContent = label;
      button.addEventListener("click", () => this.selectZone(i));
      segment.appendChild(button);
    });
    radioKeys(
      segment,
      () => this.$$(".seg button"),
      () => this.zoneIndex,
      (index) => this.selectZone(index),
    );
    const hourButton = this.$<HTMLButtonElement>(".h12");
    hourButton.addEventListener("click", () => {
      this.twelveHour = !this.twelveHour;
      hourButton.setAttribute("aria-pressed", String(this.twelveHour));
      this.kick();
    });
    // the digits are read from the hidden line above, which holds the same text in one piece
    const digits = document.createElement("span");
    digits.setAttribute("aria-hidden", "true");
    digits.style.display = "contents";
    for (let i = 0; i < SLOTS; i++) {
      const span = document.createElement("span");
      if (COLONS.includes(i)) {
        span.className = "colon";
        span.textContent = ":";
      } else {
        span.className = "rollslot";
      }
      this.slots.push(span);
      digits.appendChild(span);
    }
    this.time.appendChild(digits);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // the colons pulse in step with the wall clock's seconds; CSS animations restart on every insert
    const offset = `-${Date.now() % 1000}ms`;
    for (const i of COLONS) this.slots[i].style.animationDelay = offset;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.tickTimer);
  }

  protected override init(): void {
    this.syncSegment();
  }

  private selectZone(index: number): void {
    this.zoneIndex = index;
    this.syncSegment();
    this.kick();
  }

  private syncSegment(): void {
    checkRadio(this.$$(".seg button"), this.zoneIndex);
  }

  /** Formatters for the selected zone and hour cycle. */
  private zoneFormat(): ZoneFormat {
    const key = `${this.zoneIndex}|${this.twelveHour}`;
    if (this.format?.key === key) return this.format;
    const timeZone = ZONES[this.zoneIndex][1];
    this.format = {
      key,
      time: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: this.twelveHour ? "h12" : "h23",
      }),
      date: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }),
    };
    return this.format;
  }

  /** The current time as `HH:MM:SS` and the date line, in the selected zone. */
  private timeStrings(): [time: string, date: string] {
    const date = new Date();
    const format = this.zoneFormat();
    const parts = format.time.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "00";
    const day = format.date.format(date);
    const period = this.twelveHour ? parts.find((p) => p.type === "dayPeriod")?.value || "" : "";
    const time = `${part("hour").padStart(2, "0")}:${part("minute")}:${part("second")}`;
    return [time, `${day}${period ? ` · ${period}` : ""}`];
  }

  /** Scale the digits to the width: eight characters of about 0.6em each. */
  protected override resized(): void {
    const size = `${Math.round(clamp(this.w / 5.4, 26, 52))}px`;
    // the digits set the height of the face, and with it the canvas
    this.time.style.fontSize = size;
  }

  /** Roll each changed digit to its new value and throw a few pixels off it. */
  private showTime(time: string): void {
    const first = this.shown === "";
    const P = this.P;
    const canvasBox = this.cv?.getBoundingClientRect();
    for (let i = 0; i < SLOTS; i++) {
      if (COLONS.includes(i) || time[i] === this.shown[i]) continue;
      const slot = this.slots[i];
      rollText(slot, time[i], 1, !first);
      if (first || !canvasBox) continue;
      const box = slot.getBoundingClientRect();
      const x = box.left + box.width / 2 - canvasBox.left;
      const y = box.top + box.height / 2 - canvasBox.top;
      this.sparks.add(x, y, 9, [P.accent, P.shine, P.fg], {
        speed: [30, 120],
        life: [0.25, 0.6],
        jitter: box.width / 3,
      });
    }
    this.shown = time;
  }

  protected override render(_t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const [time, date] = this.timeStrings();
    if (time !== this.shown) this.showTime(time);
    const spoken = `${time}, ${ZONES[this.zoneIndex][0]}`;
    if (this.spoken.textContent !== spoken) this.spoken.textContent = spoken;
    if (date !== this.lastDate) {
      rollText(this.$(".date"), date, 1, !!this.lastDate);
      this.lastDate = date;
    }
    this.clear();
    if (this.sparks.step(g, dt)) return true;
    // nothing moves until the next second: sleep instead of drawing empty frames
    clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => this.kick(), 1004 - (Date.now() % 1000));
    return false;
  }
}

define("px-clock", Clock);

export { Clock };

declare global {
  interface HTMLElementTagNameMap {
    "px-clock": Clock;
  }
}

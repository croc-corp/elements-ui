"use client";

import * as React from "react";

import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas, type PixelFrame } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** First day of the week: 0 is Sunday, 1 Monday, up to 6 Saturday. */
export type PxDateWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Props of `PxDate`. Other `div` props go to the root. */
export interface PxDateProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /**
   * Controlled selection: `YYYY-MM-DD`, or `YYYY-MM-DD/YYYY-MM-DD` with `range`. Use with `onValueChange`.
   * A new value also shows its month.
   */
  value?: string;
  /** Initial selection when uncontrolled; also restored on form reset. It sets the month shown. */
  defaultValue?: string;
  /** Called when a date is picked; in range mode only when the end date is picked. */
  onValueChange?: (value: string) => void;
  /** Pick a start and an end date instead of a single date. */
  range?: boolean;
  /** First day of the week. */
  firstDay?: PxDateWeekday;
  /** Form field name. A range submits as `start/end` and stays empty until both ends are picked. */
  name?: string;
  /** Dims the calendar and disables its buttons. */
  disabled?: boolean;
}

interface Selection {
  start: Date | null;
  end: Date | null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEADER_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_MS = 864e5;

const ICON_BUTTON =
  "grid size-7 flex-none cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent p-0 text-muted-foreground select-none outline-none hover:bg-foreground/7 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec";

/** Today, as `YYYY-MM-DD`. It is read on the client only, so server and client markup agree. */
const subscribeToNothing = () => () => {};
const todayKey = () => ymd(new Date());
const noTodayOnServer = () => null;

/**
 * Month-grid date picker for single dates or ranges. The selection is a pixel block that springs between
 * days, a range is a dotted band (previewed on hover), and today carries a small mark. Arrow keys move by
 * day and week, Home and End to the ends of the week, Page Up and Page Down by month (with Shift by year);
 * the grid slides when the month changes.
 *
 * @example
 * <PxDate name="trip" range defaultValue="2026-10-20/2026-10-24" />
 */
export function PxDate({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  range = false,
  firstDay = 1,
  name,
  disabled = false,
  className,
  ...props
}: PxDateProps) {
  const titleId = React.useId();
  // values outside 0 to 6 (from untyped callers) still give a valid week
  const weekStart = ((Math.trunc(firstDay) % 7) + 7) % 7 || 0;
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [selection, setSelection] = React.useState(() => parseSelection(value, range));
  const [view, setView] = React.useState<Date | null>(() => monthOf(selection.start));
  const [focusDate, setFocusDate] = React.useState<Date | null>(() => selection.start);
  // every month change by the user gets an id, so the grid slides once per change
  const [nav, setNav] = React.useState({ id: 0, direction: 0, animate: false });
  const [summaryAnimate, setSummaryAnimate] = React.useState(false);
  const todayValue = React.useSyncExternalStore<string | null>(subscribeToNothing, todayKey, noTodayOnServer);
  const today = todayValue ? parseYmd(todayValue) : null;

  // a value from outside (controlled) or a switch of `range` replaces the selection and shows its month
  const [synced, setSynced] = React.useState({ value, range });
  if (value !== synced.value || range !== synced.range) {
    setSynced({ value, range });
    if (formatSelection(selection, range) !== value) {
      const next = parseSelection(value, range);
      setSelection(next);
      if (next.start) {
        setView(monthOf(next.start));
        setFocusDate(next.start);
      }
    }
  }

  const shownView = view ?? monthOf(today);
  const days = shownView ? monthDays(shownView, weekStart) : null;
  const tabDate = shownView ? clampToMonth(focusDate ?? today ?? shownView, shownView) : null;

  const gridRef = React.useRef<HTMLDivElement>(null);
  const cellRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const hover = React.useRef<Date | null>(null);
  const block = React.useRef({ placed: false, x: { position: 0, velocity: 0 }, y: { position: 0, velocity: 0 } });
  const focusRequest = React.useRef<string | null>(null);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    if (!days) return false;
    const { clear, dot, palette, delta } = frame;
    const reduced = prefersReducedMotion();
    const { start, end } = selection;
    const cellBox = (index: number): Box | null => {
      const cell = cellRefs.current[index];
      return cell ? { x: cell.offsetLeft, y: cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight } : null;
    };
    clear();
    let moving = false;
    if (range && start) {
      // the band between the ends, or up to the hovered day while picking the end
      const until = end ?? (hover.current && hover.current.getTime() > start.getTime() ? hover.current : null);
      if (until) {
        days.forEach((day, index) => {
          if (day.getTime() <= start.getTime() || day.getTime() >= until.getTime()) return;
          const box = cellBox(index);
          if (!box) return;
          for (let y = box.y + 6; y < box.y + box.height - 6; y += 4) {
            for (let x = box.x; x < box.x + box.width; x += 4) dot(x, y, palette.accent, end ? 0.2 : 0.12, 2);
          }
        });
      }
    }
    const anchor = range && end ? end : start;
    const anchorIndex = days.findIndex((day) => sameDay(day, anchor));
    const anchorBox = anchorIndex >= 0 ? cellBox(anchorIndex) : null;
    if (anchorBox) {
      const current = block.current;
      if (!current.placed || reduced) {
        current.x = { position: anchorBox.x, velocity: 0 };
        current.y = { position: anchorBox.y, velocity: 0 };
        current.placed = true;
      } else {
        springEuler(current.x, anchorBox.x, delta, 300, 0.72);
        springEuler(current.y, anchorBox.y, delta, 300, 0.72);
      }
      if (Math.abs(anchorBox.x - current.x.position) + Math.abs(anchorBox.y - current.y.position) > 0.3) moving = true;
      paintBlock(frame, { ...anchorBox, x: current.x.position, y: current.y.position });
    }
    if (range && end) {
      const startIndex = days.findIndex((day) => sameDay(day, start));
      const startBox = startIndex >= 0 ? cellBox(startIndex) : null;
      if (startBox) paintBlock(frame, startBox);
    }
    const todayIndex = days.findIndex((day) => sameDay(day, today));
    const todayBox = todayIndex >= 0 ? cellBox(todayIndex) : null;
    if (todayBox) {
      // on a selected day the mark sits on the block, so it takes the card colour
      const onBlock = sameDay(days[todayIndex], start) || sameDay(days[todayIndex], end);
      const color = onBlock ? palette.card : palette.accent;
      for (let k = -1; k <= 1; k++) dot(todayBox.x + todayBox.width / 2 + k * 3 - 1, todayBox.y + todayBox.height - 6, color, 1, 2);
    }
    return moving;
  });

  const viewKey = shownView ? ymd(shownView) : "";

  // a new month places the selection block without springing
  React.useLayoutEffect(() => {
    block.current.placed = false;
    redraw();
  }, [viewKey, redraw]);

  // the days slide in from the side the user moved to
  React.useLayoutEffect(() => {
    if (nav.direction === 0 || !nav.animate || prefersReducedMotion()) return;
    const offset = nav.direction < 0 ? -10 : 10;
    cellRefs.current.forEach((cell, index) => {
      if (!cell || typeof cell.animate !== "function") return;
      cell.animate([{ opacity: 0, transform: `translateX(${offset}px)` }, { opacity: 1, transform: "none" }], {
        duration: 300,
        easing: "cubic-bezier(.2,.8,.2,1)",
        delay: (index % 7) * 12,
        fill: "backwards",
      });
    });
  }, [nav.id, nav.direction, nav.animate]);

  // keyboard moves focus to the new day once it is rendered
  React.useLayoutEffect(() => {
    const key = focusRequest.current;
    if (!key) return;
    focusRequest.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus();
  });

  React.useEffect(redraw, [selection, todayValue, redraw]);

  useFormReset(canvasRef, () => {
    const next = parseSelection(defaultValue, range);
    setSelection(next);
    setValue(defaultValue);
    setView(monthOf(next.start));
    setFocusDate(next.start);
    setNav((previous) => ({ id: previous.id + 1, direction: 0, animate: false }));
    setSummaryAnimate(false);
  });

  const showMonth = (month: Date, direction: number) => {
    setView(month);
    setNav((previous) => ({ id: previous.id + 1, direction, animate: true }));
  };

  const pick = (day: Date) => {
    let next: Selection;
    if (!range) next = { start: day, end: null };
    else if (!selection.start || selection.end) next = { start: day, end: null };
    else if (day.getTime() < selection.start.getTime()) next = { start: day, end: selection.start };
    else next = { start: selection.start, end: day };
    setSelection(next);
    setFocusDate(day);
    setSummaryAnimate(true);
    if (!range || next.end) setValue(formatSelection(next, range));
    redraw();
  };

  // Enter and Space pick through the day button's own click
  const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: Date) => {
    if (!shownView) return;
    const target = keyTarget(event, day, weekStart);
    if (!target) return;
    event.preventDefault();
    setFocusDate(target);
    if (target.getMonth() !== shownView.getMonth() || target.getFullYear() !== shownView.getFullYear()) {
      showMonth(monthOf(target) ?? shownView, target.getTime() > shownView.getTime() ? 1 : -1);
    }
    focusRequest.current = ymd(target);
  };

  const title = shownView ? `${MONTHS[shownView.getMonth()]} ${shownView.getFullYear()}` : "";
  const weekdays = Array.from({ length: 7 }, (_, i) => HEADER_WEEKDAYS[(i + weekStart) % 7]);
  const weeks = days ? Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7)) : null;

  return (
    <div
      data-slot="px-date"
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous month"
          disabled={disabled}
          onClick={() => shownView && showMonth(addMonths(shownView, -1), -1)}
          className={ICON_BUTTON}
        >
          <ChevronIcon path="M10 3.5L5.5 8l4.5 4.5" />
        </button>
        <span id={titleId} className="flex-1 text-[14px] font-semibold">
          <RollText text={title} direction={nav.direction || 1} animate={nav.animate} aria-live="polite" />
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={disabled}
          onClick={() => shownView && showMonth(addMonths(shownView, 1), 1)}
          className={ICON_BUTTON}
        >
          <ChevronIcon path="M6 3.5L10.5 8 6 12.5" />
        </button>
      </div>
      <div aria-hidden="true" className="grid grid-cols-7">
        {weekdays.map((weekday) => (
          <span key={weekday} className="pb-1 text-center font-mono text-[11px] text-muted-foreground">
            {weekday}
          </span>
        ))}
      </div>
      <div className="relative">
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full [image-rendering:pixelated]" />
        <div ref={gridRef} role="grid" aria-labelledby={titleId}>
          {weeks && shownView
            ? weeks.map((week, row) => (
                <div key={row} role="row" className="grid grid-cols-7">
                  {week.map((day, column) => {
                    const index = row * 7 + column;
                    const key = ymd(day);
                    const selected = sameDay(day, selection.start) || sameDay(day, selection.end);
                    return (
                      <button
                        key={key}
                        ref={(node) => {
                          cellRefs.current[index] = node;
                        }}
                        type="button"
                        role="gridcell"
                        data-date={key}
                        aria-label={formatLong(day)}
                        aria-selected={selected}
                        aria-current={sameDay(day, today) ? "date" : undefined}
                        tabIndex={sameDay(day, tabDate) ? 0 : -1}
                        disabled={disabled}
                        onClick={() => pick(day)}
                        onPointerEnter={() => {
                          hover.current = day;
                          redraw();
                        }}
                        onPointerLeave={() => {
                          hover.current = null;
                          redraw();
                        }}
                        onKeyDown={(event) => onDayKeyDown(event, day)}
                        className={cn(
                          "relative z-[1] h-9 cursor-pointer rounded-lg border-0 bg-transparent p-0 font-[inherit] text-[13px] text-inherit tabular-nums select-none outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec",
                          day.getMonth() !== shownView.getMonth() && "text-muted-foreground opacity-45",
                          selected ? "font-semibold text-lumesec-foreground" : "hover:bg-foreground/6",
                        )}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              ))
            : Array.from({ length: 6 }, (_, row) => <div key={row} role="row" className="h-9" />)}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[13px]">
        <RollText text={summarize(selection, range)} animate={summaryAnimate} className="text-muted-foreground" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const now = new Date();
            const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            setView(monthOf(day));
            setNav((previous) => ({ id: previous.id + 1, direction: 0, animate: true }));
            pick(day);
          }}
          className="inline-flex h-[30px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 font-[inherit] text-[12.5px] font-medium text-foreground select-none outline-none [transition:transform_.15s_cubic-bezier(.2,.8,.2,1),background-color_.2s,border-color_.2s,color_.2s] hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec active:[transform:scale(.95)]"
        >
          Today
        </button>
      </div>
      {name ? <input type="hidden" name={name} value={formatSelection(selection, range)} disabled={disabled} /> : null}
    </div>
  );
}

const DAY_STEPS: Record<string, number | undefined> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** The day a navigation key moves to from `day`, or null when the key does not navigate. */
function keyTarget(event: React.KeyboardEvent, day: Date, weekStart: number): Date | null {
  const step = DAY_STEPS[event.key];
  if (step !== undefined) return addDays(day, step);
  const column = (day.getDay() - weekStart + 7) % 7;
  if (event.key === "Home") return addDays(day, -column);
  if (event.key === "End") return addDays(day, 6 - column);
  if (event.key === "PageUp" || event.key === "PageDown") {
    // the same day next or last month (year with Shift), clamped: Jan 31 moves to Feb 28, not into March
    const months = (event.key === "PageDown" ? 1 : -1) * (event.shiftKey ? 12 : 1);
    return clampToMonth(day, addMonths(day, months));
  }
  return null;
}

function ChevronIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/** Fill a day cell with the selection's dot pattern. */
function paintBlock({ dot, palette }: PixelFrame, box: Box) {
  for (let y = box.y + 2; y < box.y + box.height - 2; y += 3) {
    for (let x = box.x + 4; x < box.x + box.width - 4; x += 3) dot(x, y, palette.accent, 1, 2.9);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` in local time. */
const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A local date from `YYYY-MM-DD`; null for anything else, including days that do not exist (2026-02-31). */
function parseYmd(text: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date : null;
}

const sameDay = (a: Date | null, b: Date | null) =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The first day of the month `date` is in. */
function monthOf(date: Date | null) {
  return date ? new Date(date.getFullYear(), date.getMonth(), 1) : null;
}

const addMonths = (month: Date, count: number) => new Date(month.getFullYear(), month.getMonth() + count, 1);

const addDays = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);

/** The 42 days of a six-week grid showing `month`, starting on `firstDay`. */
function monthDays(month: Date, firstDay: number) {
  const year = month.getFullYear();
  const index = month.getMonth();
  const offset = (new Date(year, index, 1).getDay() - firstDay + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, index, 1 - offset + i));
}

/** The same day of the month in `month`, clamped to its length, unless `date` is already in it. */
function clampToMonth(date: Date, month: Date) {
  if (date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear()) return date;
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return new Date(month.getFullYear(), month.getMonth(), Math.min(date.getDate(), length));
}

/** The selection a value describes. A range written end first is put in order. */
function parseSelection(value: string, range: boolean): Selection {
  const [first, second] = value.split("/");
  const start = parseYmd(first);
  const end = range && start ? parseYmd(second) : null;
  if (start && end && end.getTime() < start.getTime()) return { start: end, end: start };
  return { start, end };
}

function formatSelection({ start, end }: Selection, range: boolean) {
  if (range) return start && end ? `${ymd(start)}/${ymd(end)}` : "";
  return start ? ymd(start) : "";
}

/** "Saturday, 24 October 2026", like `toLocaleDateString("en-GB")`, but the same on server and client. */
const formatLong = (date: Date) => `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

/** "Sat, 24 Oct 2026". */
const formatShort = (date: Date) => `${SHORT_WEEKDAYS[date.getDay()]}, ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;

function summarize({ start, end }: Selection, range: boolean) {
  if (!start) return range ? "Pick a start date" : "No date picked";
  if (range && !end) return `From ${formatShort(start)} · pick an end`;
  if (range && end) {
    const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    return `${start.getDate()} ${SHORT_MONTHS[start.getMonth()]} – ${formatShort(end)} · ${nights} night${nights === 1 ? "" : "s"}`;
  }
  return formatShort(start);
}

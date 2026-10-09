"use client";

import * as React from "react";

import { lerp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** How the value is written. All formats use en-US conventions. */
export type PxKpiFormat = "number" | "currency" | "percent" | "compact" | "ms";

/** Props of `PxKpi`. Other `div` props go to the root element. */
export interface PxKpiProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The metric. Changes roll in, upward when the value grows. */
  value?: number;
  /** Comparison value. When set and not 0, a chip shows the percentage change with ▲ or ▼. */
  previous?: number;
  /** For metrics where lower is better: a drop is coloured as good and a rise as bad. */
  invert?: boolean;
  /** `number`, `currency`, `percent` (one decimal and %), `compact` (for example 48.2K) or `ms`. */
  format?: PxKpiFormat;
  /** ISO currency code used with `format="currency"`. */
  currency?: string;
  /** Caption above the value. */
  label?: React.ReactNode;
  /** Muted text at the end of the value row, such as "vs. last month". */
  note?: React.ReactNode;
  /** History drawn as pixel columns; needs at least two finite values. A change replays the draw-in. */
  data?: readonly number[];
}

const NO_DATA: number[] = [];

/**
 * Stat tile with a rolling value, a change chip against a previous value and a pixel history. `invert`
 * makes a drop read as good.
 *
 * @example
 * <PxKpi label="Revenue this month" value={48210} previous={42900} format="currency" data={[30, 32, 31, 35, 38]} />
 */
export function PxKpi({
  value = 0,
  previous,
  invert = false,
  format = "number",
  currency = "EUR",
  label,
  note,
  data = NO_DATA,
  className,
  ...props
}: PxKpiProps) {
  const history = data.filter((entry) => Number.isFinite(entry));
  const comparison = previous ?? Number.NaN;

  // roll upward when the value grows, downward when it shrinks
  const [lastValue, setLastValue] = React.useState(value);
  const [direction, setDirection] = React.useState(1);
  if (value !== lastValue) {
    setDirection(value >= lastValue ? 1 : -1);
    setLastValue(value);
  }

  const hasChange = Number.isFinite(comparison) && comparison !== 0;
  const change = hasChange ? ((value - comparison) / Math.abs(comparison)) * 100 : 0;
  const up = change >= 0;
  // without a comparison there is no trend to judge, so the history stays green even with `invert`
  const good = hasChange ? up !== invert : true;

  /** Draw-in progress, 0 to 1. */
  const reveal = React.useRef(0);
  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, delta } = frame;
    const w = frame.width;
    const h = frame.height;
    const n = history.length;
    frame.clear();
    if (n < 2) return false;
    reveal.current = prefersReducedMotion() ? 1 : Math.min(1, reveal.current + delta * 1.6);
    const lo = Math.min(...history);
    const hi = Math.max(...history);
    const span = hi - lo || 1;
    const color = good ? palette.success : palette.destructive;
    const columns = Math.floor(w / 4);
    for (let c = 0; c < columns * reveal.current; c++) {
      const u = columns > 1 ? (c / (columns - 1)) * (n - 1) : 0;
      const i = Math.min(n - 2, Math.floor(u));
      const v = lerp(history[i], history[i + 1], u - i);
      const height = Math.max(1, Math.round(((v - lo) / span) * (h / 4 - 1)) + 1);
      for (let r = 0; r < height; r++) {
        const isTop = r === height - 1;
        frame.dot(c * 4, h - 3 - r * 4, isTop ? color : mixRgb(color, palette.foreground, 0.6), isTop ? 1 : 0.18, 2.6);
      }
    }
    return reveal.current < 1;
  });

  const dataKey = history.join(",");
  React.useEffect(() => {
    reveal.current = 0;
    redraw();
  }, [dataKey, redraw]);
  React.useEffect(redraw, [good, redraw]);

  return (
    <div data-slot="px-kpi" className={cn("block text-foreground", className)} {...props}>
      <span className="text-[12.5px] leading-normal text-muted-foreground">{label}</span>
      <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
        <RollText
          text={formatValue(value, format, currency)}
          direction={direction}
          aria-live="polite"
          className="text-[26px] leading-normal font-semibold tracking-[-.02em] tabular-nums"
        />
        {hasChange && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-[7px] py-0.5 text-[12px] leading-normal font-semibold tabular-nums",
              good ? "bg-lumesec-success/14 text-lumesec-success" : "bg-destructive/14 text-destructive",
            )}
          >
            {/* the arrows read badly aloud, so assistive technology gets words instead */}
            <RollText text={`${up ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`} direction={up ? 1 : -1} aria-hidden="true" />
            <span className="sr-only">{`${up ? "Up" : "Down"} ${Math.abs(change).toFixed(1)}%`}</span>
          </span>
        )}
        <span className="ml-auto text-[11.5px] leading-normal text-muted-foreground">{note}</span>
      </div>
      <canvas ref={canvasRef} aria-hidden="true" className="mt-2.5 block h-[34px] w-full [image-rendering:pixelated]" />
    </div>
  );
}

/** Write `value` in the chosen format. */
function formatValue(value: number, format: PxKpiFormat, currency: string) {
  if (format === "currency") {
    // whole units from 1,000 up; the minimum is set too, since it defaults to the currency's cents
    const whole = Math.abs(value) >= 1000;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : undefined,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(value);
  }
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "compact") return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (format === "ms") return `${Math.round(value)} ms`;
  return value.toLocaleString("en-US");
}

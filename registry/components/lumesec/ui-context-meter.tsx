"use client";

import * as React from "react";

import { useCanvas } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import { clamp, hash, mixRgb, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion, useAnimationLoop, useReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** How full the window is: `warn` from 80%, `full` from 95%. */
export type ContextMeterZone = "ok" | "warn" | "full";

/** Imperative actions on the meter, exposed through `ref`. */
export interface UiContextMeterHandle {
  /** Add `percent` percentage points (negative to subtract), clamped to 0–100. Calls `onValueChange`. */
  add(percent: number): void;
  /**
   * Drop usage to 28% of its current value (at least 12%), run a bright sweep and show "Compacting…" for
   * 1.5 s. Does nothing at 15% or below. Calls `onValueChange` and `onCompact`.
   */
  compact(): void;
}

export interface UiContextMeterProps extends Omit<React.ComponentProps<"div">, "ref" | "onChange"> {
  /** Controlled used share of the context window in percent, clamped to 0–100. Use with `onValueChange`. */
  value?: number;
  /** Initial percentage when uncontrolled. */
  defaultValue?: number;
  /** Window size in tokens, used only for the "used / total" readout, which is shown in thousands. */
  capacity?: number;
  /** Caption before the percentage, and the meter's accessible name. */
  label?: string;
  /** Called with the new percentage when `add()` or `compact()` changes it. */
  onValueChange?: (value: number) => void;
  /** Called when `compact()` runs, with the percentage before and after. */
  onCompact?: (from: number, to: number) => void;
  /** Exposes `add()` and `compact()`. */
  ref?: React.Ref<UiContextMeterHandle>;
}

/** Strip geometry: 4 rows of 2.4px squares on a 4px column pitch. */
const ROWS = 4;
const PITCH = 4;
const SWEEP_MS = 650;

/**
 * Context-window meter that fills a pixel strip behind a glowing front, turns amber at 80% and red at
 * 95%, and animates compaction. Use `ref` to call `add()` and `compact()`.
 *
 * @example
 * const meter = React.useRef<UiContextMeterHandle>(null);
 * <UiContextMeter ref={meter} defaultValue={46} capacity={200000} />
 * <button onClick={() => meter.current?.compact()}>Compact</button>
 */
export function UiContextMeter({
  value: valueProp,
  defaultValue = 0,
  capacity = 200000,
  label = "Context",
  onValueChange,
  onCompact,
  ref,
  className,
  ...props
}: UiContextMeterProps) {
  const [rawValue, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const value = clamp(Number.isFinite(rawValue) ? rawValue : 0, 0, 100);
  const used = value / 100;
  const percent = Math.round(value);
  const usedTokens = Math.round(used * capacity);
  const zone: ContextMeterZone = used >= 0.95 ? "full" : used >= 0.8 ? "warn" : "ok";

  // derived state: which way the numbers roll
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value >= shown.value ? 1 : -1 });

  const [compacting, setCompacting] = React.useState(false);
  const reduced = useReducedMotion();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const percentRef = React.useRef<HTMLSpanElement>(null);
  const latest = React.useRef(value);
  const onCompactRef = React.useRef(onCompact);
  const labelTimer = React.useRef(0);

  // animation state: the drawn fill eases toward `target`
  const target = React.useRef(used);
  const fill = React.useRef(used);
  const sweepStart = React.useRef(-1);

  const loop = useAnimationLoop(canvasRef, step);
  const surfaceRef = useCanvas(canvasRef, () => loop.kick());
  const palette = usePalette(canvasRef, undefined, () => loop.kick());

  React.useEffect(() => {
    latest.current = value;
    onCompactRef.current = onCompact;
  });

  React.useEffect(() => {
    target.current = used;
    loop.kick();
  }, [used, loop]);

  React.useEffect(() => () => window.clearTimeout(labelTimer.current), []);

  // near the limit the percentage blinks
  React.useEffect(() => {
    const element = percentRef.current;
    if (zone !== "full" || reduced || !element) return;
    const blink = element.animate(
      [
        { opacity: 1, easing: "ease-in-out" },
        { opacity: 0.55, offset: 0.5, easing: "ease-in-out" },
        { opacity: 1 },
      ],
      { duration: 1200, iterations: Infinity },
    );
    return () => blink.cancel();
  }, [zone, reduced]);

  React.useImperativeHandle(
    ref,
    () => ({
      add(amount: number) {
        if (!Number.isFinite(amount)) return;
        const next = clamp(latest.current + amount, 0, 100);
        latest.current = next;
        setValue(next);
      },
      compact() {
        const from = latest.current;
        if (from <= 15) return;
        const to = Math.max(12, Math.round(from * 0.28));
        latest.current = to;
        sweepStart.current = performance.now();
        setCompacting(true);
        window.clearTimeout(labelTimer.current);
        labelTimer.current = window.setTimeout(() => setCompacting(false), 1500);
        setValue(to);
        onCompactRef.current?.(from, to);
        loop.kick();
      },
    }),
    [setValue, loop],
  );

  function step(time: number, delta: number) {
    const canvas = surfaceRef.current;
    const colors = palette.current;
    if (!canvas || !colors) return false;
    const { context, width, height } = canvas;
    const now = time * 1000;
    const reducedMotion = prefersReducedMotion();
    const previous = fill.current;
    fill.current = reducedMotion ? target.current : previous + (target.current - previous) * (1 - Math.exp(-delta * 5));
    const velocity = delta > 0 ? (fill.current - previous) / delta : 0;

    const columns = Math.max(10, Math.floor((width + 1) / PITCH));
    context.clearRect(0, 0, width, height);
    const edge = fill.current * columns;
    // a fast-moving front glows white
    const heat = clamp(Math.abs(velocity) * 6, 0, 1);
    const tick = Math.floor(now / 80);
    const sweep = sweepStart.current > 0 ? (now - sweepStart.current) / SWEEP_MS : 2;
    for (let column = 0; column < columns; column++) {
      const share = column / columns;
      const base = share >= 0.95 ? colors.destructive : share >= 0.8 ? colors.warning : colors.accent;
      for (let row = 0; row < ROWS; row++) {
        const x = column * PITCH;
        const y = 1 + row * 4.4;
        const distance = edge - column;
        // the front dithers: cells within 1.5 columns of the edge flicker on and off
        const on =
          distance > 1.5 ? true : distance > -1.5 ? hash(column * 3.1 + row * 7.7 + tick * 0.13) < (distance + 1.5) / 3 : false;
        if (on) {
          const near = Math.max(0, 1 - Math.abs(distance) / 4);
          const alpha = 0.55 + 0.45 * Math.min(1, (edge - column) / 6);
          context.globalAlpha = Math.min(1, alpha + near * 0.4);
          context.fillStyle = rgba(mixRgb(base, colors.glint, near * (0.35 + 0.65 * heat)));
        } else {
          context.globalAlpha = share >= 0.8 ? 0.2 : 0.12;
          context.fillStyle = rgba(share >= 0.8 ? base : colors.foreground);
        }
        // compaction sweep: a bright band runs right to left
        if (sweep < 1 && !reducedMotion) {
          const bandX = (1 - sweep) * columns;
          const band = Math.exp(-((column - bandX) ** 2) / 18);
          if (band > 0.05) {
            context.globalAlpha = Math.min(1, context.globalAlpha + band * 0.8);
            context.fillStyle = rgba(mixRgb(on ? base : colors.foreground, colors.glint, band));
          }
        }
        context.fillRect(x, y, 2.4, 2.4);
      }
    }
    context.globalAlpha = 1;
    return (
      Math.abs(target.current - fill.current) > 0.0005 ||
      sweep < 1.2 ||
      (!reducedMotion && Math.abs(edge - Math.round(edge)) > 0)
    );
  }

  return (
    <div data-slot="ui-context-meter" data-zone={zone} className={cn("block leading-normal", className)} {...props}>
      <div className="mb-[9px] flex items-baseline gap-2">
        <RollText
          text={compacting ? "Compacting…" : label}
          direction={compacting ? 1 : -1}
          className="text-[12.5px] text-muted-foreground"
        />
        <RollText
          ref={percentRef}
          text={`${percent}%`}
          direction={shown.direction}
          className={cn(
            "text-[14px] font-semibold text-foreground tabular-nums [transition:color_.3s]",
            zone === "warn" && "text-lumesec-warning",
            zone === "full" && "text-destructive",
          )}
        />
        <RollText
          text={`${formatTokens(usedTokens)} / ${formatTokens(capacity)}`}
          direction={shown.direction}
          className="ml-auto font-mono text-[12px] text-muted-foreground tabular-nums"
        />
      </div>
      <canvas
        ref={canvasRef}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        // the name stays fixed; the changing level is the value text
        aria-label={label}
        aria-valuetext={`${percent}%, ${usedTokens.toLocaleString("en-US")} of ${capacity.toLocaleString("en-US")} tokens`}
        className="block h-[18px] w-full"
      />
    </div>
  );
}

/** Token counts in thousands: 92000 → "92k". */
function formatTokens(count: number) {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

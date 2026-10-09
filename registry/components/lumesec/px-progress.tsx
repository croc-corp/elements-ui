"use client";

import * as React from "react";

import { clamp, mixRgb } from "@/lib/lumesec/math";
import { useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** Props of `PxProgress`. Other `div` props go to the root element. */
export interface PxProgressProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** Progress from 0 to 100, clamped; the bar glides to it. `null` or leaving it out shows the indeterminate comet. */
  value?: number | null;
  /** Text above the bar, and the bar's accessible name. */
  label?: string;
  /** Text shown once `value` reaches 100. */
  doneLabel?: string;
  /** Called when `value` reaches 100, including on mount when it starts there, and again each time it returns to 100. */
  onComplete?: () => void;
}

/**
 * Pixel progress bar. With a `value` it fills with a hot leading edge, and at 100 the label rolls to
 * `doneLabel` while a green sweep runs along the bar; without one a comet loops along the track.
 *
 * @example
 * <PxProgress value={38} label="Uploading dataset" doneLabel="Upload complete" />
 */
export function PxProgress({
  value,
  label = "Uploading",
  doneLabel = "Complete",
  onComplete,
  className,
  ...props
}: PxProgressProps) {
  const reduced = useReducedMotion();
  const indeterminate = value == null;
  const percent = indeterminate ? 0 : clamp(Number.isFinite(value) ? value : 0, 0, 100);
  const done = !indeterminate && percent >= 100;

  /** Animated fill, 0 to 1. It starts at the first value instead of gliding up from 0. */
  const fill = React.useRef(percent / 100);
  /** When the value reached 100, in seconds, for the finish sweep. */
  const doneAt = React.useRef(-9);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, delta, width, clear, dot }) => {
    const columns = Math.floor(width / 4);
    clear();
    if (indeterminate) {
      const head = reduced ? 0.5 : ((time * 0.7) % 1.4) - 0.2;
      const tail = 0.28;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < 3; row++) {
          const behind = head - (column + 0.5) / columns;
          const glow = behind >= 0 && behind < tail ? 1 - behind / tail : 0;
          dot(
            column * 4,
            row * 4,
            glow ? mixRgb(palette.accent, palette.shine, glow * 0.6) : palette.foreground,
            glow ? 0.3 + 0.7 * glow : 0.12,
            2.6,
          );
        }
      }
      return !reduced;
    }
    const target = percent / 100;
    fill.current = reduced ? target : fill.current + (target - fill.current) * Math.min(1, delta * 8);
    const share = fill.current;
    const wave = done && !reduced ? (time - doneAt.current) * 1.6 : -9;
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < 3; row++) {
        const u = (column + 0.5) / columns;
        const on = u <= share;
        const edge = on && u > share - 3 / columns && !done;
        const sweep = Math.max(0, 1 - Math.abs(u - wave) * 8);
        const color = done
          ? mixRgb(palette.success, palette.shine, sweep * 0.7)
          : edge
            ? mixRgb(palette.accent, palette.shine, 0.55)
            : palette.accent;
        dot(column * 4, row * 4, on ? color : palette.foreground, on ? 0.95 : 0.12, 2.6);
      }
    }
    return Math.abs(share - target) > 0.0005 || (wave > -9 && wave < 1.3);
  });

  const completed = React.useRef(onComplete);
  React.useEffect(() => {
    completed.current = onComplete;
  });

  const wasDone = React.useRef(false);
  React.useEffect(() => {
    if (done && !wasDone.current) {
      doneAt.current = performance.now() / 1000;
      completed.current?.();
    }
    wasDone.current = done;
  }, [done]);

  React.useEffect(redraw, [indeterminate, percent, done, reduced, redraw]);

  return (
    <div data-slot="px-progress" data-done={done ? "" : undefined} className={cn("block text-foreground", className)} {...props}>
      <div className="mb-2 flex items-baseline justify-between gap-2.5">
        <RollText text={done ? doneLabel : label} direction={done || indeterminate ? 1 : -1} className="text-[13px] font-medium" />
        <span className={cn("font-mono text-[12.5px] text-muted-foreground tabular-nums", done && "text-lumesec-success")}>
          {indeterminate ? "" : `${Math.round(percent)}%`}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        aria-valuetext={done ? doneLabel : undefined}
        className="block h-3 w-full [image-rendering:pixelated]"
      />
    </div>
  );
}

"use client";

import * as React from "react";

import { clamp, mixRgb, TAU } from "@/lib/lumesec/math";
import { useLazyRef, useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { Sparks } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** Props of `PxRing`. Other `div` props go to the root element. */
export interface PxRingProps extends React.ComponentProps<"div"> {
  /** Progress from 0 to 100, clamped; the ring animates to it. `null` or leaving it out shows a spinner. */
  value?: number | null;
  /** Diameter in pixels. */
  size?: number;
  /** Called when `value` reaches 100, and again each time it drops below 100 and returns. Not called when the ring starts at 100. */
  onComplete?: () => void;
  /** Caption under the ring; it also labels the progress bar. */
  children?: React.ReactNode;
}

/**
 * Circular pixel progress ring with the percentage counting up in its centre. It turns green and throws a
 * few sparks when it reaches 100%; without a `value` an arc spins around the track.
 *
 * @example
 * <PxRing value={72}>Weekly usage</PxRing>
 */
export function PxRing({ value, size = 120, onComplete, children, className, ...props }: PxRingProps) {
  const captionId = React.useId();
  const reduced = useReducedMotion();
  const indeterminate = value == null;
  const percent = indeterminate ? 0 : clamp(Number.isFinite(value) ? value : 0, 0, 100);
  const done = percent >= 100;
  const hasCaption = children != null && children !== false && children !== "";

  /** Animated fill, 0 to 1, starting at the first value. */
  const fill = React.useRef(percent / 100);
  /** Whether the 100% burst already fired for the current run up to 100. */
  const fired = React.useRef(percent >= 100);
  const sparksRef = useLazyRef(() => new Sparks());
  /** The number in the centre. The draw loop writes it, so it counts along with the fill. */
  const digitsRef = React.useRef<HTMLSpanElement | null>(null);
  // React renders the first value only and never rewrites the text, so it cannot fight the loop
  const [initialDigits] = React.useState(() => String(Math.round(percent)));
  const attachDigits = React.useCallback((node: HTMLSpanElement | null) => {
    digitsRef.current = node;
    // a number that mounts later (after the spinner) starts at the current fill, not the first value
    if (node) node.textContent = String(Math.round(fill.current * 100));
  }, []);

  const completed = React.useRef(onComplete);
  React.useEffect(() => {
    completed.current = onComplete;
  });

  // completion follows the value, not the drawing, so it also fires while the ring is off screen
  const wasDone = React.useRef(done);
  React.useEffect(() => {
    if (done && !wasDone.current) completed.current?.();
    wasDone.current = done;
  }, [done]);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, delta, width, context, clear, dot }) => {
    const center = width / 2;
    const radius = center - 8;
    const cells = Math.max(36, Math.round(radius * 0.9));
    clear();
    if (indeterminate) {
      const head = reduced ? 0 : (time * 0.9) % 1;
      for (let k = 0; k < cells; k++) {
        const u = k / cells;
        const behind = (head - u + 1) % 1;
        const glow = behind < 0.3 ? 1 - behind / 0.3 : 0;
        const angle = -Math.PI / 2 + TAU * u;
        for (const r of [radius, radius - 5]) {
          dot(
            center + Math.cos(angle) * r - 1.3,
            center + Math.sin(angle) * r - 1.3,
            glow ? mixRgb(palette.accent, palette.shine, glow * 0.6) : palette.foreground,
            glow ? 0.25 + 0.75 * glow : 0.1,
            2.6,
          );
        }
      }
      return !reduced;
    }
    const target = percent / 100;
    fill.current = reduced ? target : fill.current + (target - fill.current) * Math.min(1, delta * 6);
    const share = fill.current;
    if (done && !fired.current && Math.abs(share - 1) < 0.01) {
      fired.current = true;
      sparksRef.current.add(center, center, 30, [palette.success, palette.shine], { speed: [40, 150] });
    }
    for (let k = 0; k < cells; k++) {
      const u = k / cells;
      const on = u < share;
      const angle = -Math.PI / 2 + TAU * u;
      const edge = on && u > share - 2 / cells;
      const color = done ? palette.success : edge ? mixRgb(palette.accent, palette.shine, 0.6) : palette.accent;
      for (const r of [radius, radius - 5]) {
        dot(center + Math.cos(angle) * r - 1.3, center + Math.sin(angle) * r - 1.3, on ? color : palette.foreground, on ? 0.95 : 0.1, 2.6);
      }
    }
    const digits = digitsRef.current;
    const shown = String(Math.round(share * 100));
    if (digits && digits.textContent !== shown) digits.textContent = shown;
    const sparking = sparksRef.current.step(context, delta);
    return Math.abs(share - target) > 0.001 || sparking;
  });

  React.useEffect(() => {
    if (percent < 100) fired.current = false;
    redraw();
  }, [indeterminate, percent, reduced, redraw]);

  return (
    <div
      data-slot="px-ring"
      data-state={indeterminate ? "indeterminate" : done ? "complete" : "loading"}
      className={cn("group/ring inline-grid justify-items-center gap-1.5 align-middle text-foreground", className)}
      {...props}
    >
      <div
        role="progressbar"
        aria-label={hasCaption ? undefined : "Progress"}
        aria-labelledby={hasCaption ? captionId : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        className="relative"
        style={{ width: size, height: size }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="block size-full [image-rendering:pixelated]" />
        {!indeterminate && (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <span
              className="inline-flex items-baseline font-mono leading-none font-semibold tracking-[-0.02em] text-foreground tabular-nums transition-colors duration-300 group-data-[state=complete]/ring:text-lumesec-success"
              style={{ fontSize: Math.max(12, Math.round(size * 0.27)) }}
            >
              <span ref={attachDigits}>{initialDigits}</span>
              <span className="ml-[0.08em] text-[0.42em] font-medium tracking-normal text-muted-foreground">%</span>
            </span>
          </span>
        )}
      </div>
      {hasCaption && (
        <span id={captionId} className="text-center text-[12.5px] text-muted-foreground">
          {children}
        </span>
      )}
    </div>
  );
}

"use client";

import * as React from "react";

import { clamp, hash, lerp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { cn } from "@/lib/utils";

/** Theme colour for the line. */
export type PxSparklineColor = "accent" | "success" | "destructive" | "warning" | "info" | "foreground" | "muted";

/** Props of `PxSparkline`. Other `span` props go to the root element. */
export interface PxSparklineProps extends Omit<React.ComponentProps<"span">, "children" | "color"> {
  /** The series. Non-finite values are dropped, and fewer than two values draw nothing; a change replays the draw-in. */
  data?: readonly number[];
  /** Start of the accessible description, followed by the first, last, lowest and highest value. */
  label?: string;
  /** Line colour. Without it the line is `success` when the last value is at least the first, else `destructive`. */
  color?: PxSparklineColor;
  /**
   * Text appended to every value as written, in the hover value and the accessible description; include a
   * leading space for a spaced unit such as `" ms"`.
   */
  unit?: string;
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
}

const SAMPLE_DATA = [4, 6, 5, 8, 7, 9, 8, 12, 10, 13];

/**
 * Inline pixel sparkline with a dithered area, coloured by trend unless a colour is set. It draws in from
 * the left, and hovering shows the nearest value.
 *
 * @example
 * <PxSparkline data={[180, 176, 190, 184, 200, 196, 210]} unit=" ms" />
 */
export function PxSparkline({
  data = SAMPLE_DATA,
  label = "Trend",
  color,
  unit = "",
  width = 140,
  height = 32,
  className,
  style,
  ...props
}: PxSparklineProps) {
  const values = data.filter((value) => Number.isFinite(value));
  const n = values.length;
  const [hovered, setHovered] = React.useState<number | null>(null);
  const hoverIndex = hovered === null || n < 2 ? null : Math.min(hovered, n - 1);
  /** Draw-in progress, 0 to 1. */
  const reveal = React.useRef(0);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, delta } = frame;
    const w = frame.width;
    const h = frame.height;
    frame.clear();
    if (n < 2) return false;
    reveal.current = prefersReducedMotion() ? 1 : Math.min(1, reveal.current + delta * 1.8);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const up = values[n - 1] >= values[0];
    const line = color ? (palette[color] ?? palette.accent) : up ? palette.success : palette.destructive;
    const X = (i: number) => 3 + (i / (n - 1)) * (w - 7);
    const Y = (value: number) => h - 4 - ((value - lo) / span) * (h - 9);
    const valueAt = (x: number) => {
      const u = clamp((x - 3) / (w - 7), 0, 1) * (n - 1);
      const i = Math.min(n - 2, Math.floor(u));
      return lerp(values[i], values[i + 1], u - i);
    };

    const xMax = 3 + (w - 7) * reveal.current;
    for (let x = 3; x <= xMax; x += 3) {
      const y = Y(valueAt(x));
      // dithered area under the line, thinning out toward the bottom
      for (let yy = y + 4; yy < h - 1; yy += 3) if (hash(x * 1.3 + yy * 2.7) < 0.55 - ((yy - y) / h) * 0.5) frame.dot(x - 1, yy - 1, line, 0.25, 2);
      frame.dot(x - 1.2, y - 1.2, line, 1, 2.4);
    }
    if (reveal.current >= 1) {
      const x = X(n - 1);
      const y = Y(values[n - 1]);
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) frame.dot(x + xx * 2 - 1.1, y + yy * 2 - 1.1, mixRgb(line, palette.shine, 0.3), 1, 2.2);
    }
    if (hoverIndex !== null) {
      const x = X(hoverIndex);
      for (let y = 1; y < h; y += 3) frame.dot(x - 0.8, y, palette.foreground, 0.35, 1.6);
      frame.dot(x - 2, Y(values[hoverIndex]) - 2, palette.foreground, 1, 4);
    }
    return reveal.current < 1;
  });

  const dataKey = values.join(",");
  React.useEffect(() => {
    reveal.current = 0;
    redraw();
  }, [dataKey, redraw]);
  React.useEffect(redraw, [color, hoverIndex, redraw]);

  const withUnit = (value: number) => `${value}${unit}`;
  const description =
    n > 0
      ? `${label}: from ${withUnit(values[0])} to ${withUnit(values[n - 1])}, low ${withUnit(Math.min(...values))}, high ${withUnit(Math.max(...values))}`
      : label;

  return (
    <span data-slot="px-sparkline" className={cn("relative inline-block align-middle", className)} style={{ width, ...style }} {...props}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={description}
        className="block w-full cursor-crosshair [image-rendering:pixelated]"
        style={{ height }}
        onPointerMove={(event) => {
          if (n < 2) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          setHovered(Math.round(clamp((x - 3) / (rect.width - 7), 0, 1) * (n - 1)));
        }}
        onPointerLeave={() => setHovered(null)}
      />
      {/* pointer-only; the canvas label already summarises the series for assistive technology */}
      <span
        aria-hidden="true"
        hidden={hoverIndex === null}
        className="pointer-events-none absolute bottom-full z-[5] rounded-[5px] bg-foreground px-1.5 py-0.5 font-mono text-[11px] leading-normal whitespace-nowrap text-card [transform:translate(-50%,-4px)]"
        style={hoverIndex === null ? undefined : { left: `calc(3px + (100% - 7px) * ${hoverIndex / (n - 1)})` }}
      >
        {hoverIndex === null ? null : withUnit(values[hoverIndex])}
      </span>
    </span>
  );
}

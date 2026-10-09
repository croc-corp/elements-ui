"use client";

import * as React from "react";

import { clamp, mixRgb, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { cn } from "@/lib/utils";

/** One bar. */
export interface PxBarsDatum {
  /** Label under the bar. */
  label: string;
  /** Bar value. Negative and non-finite values draw an empty bar. */
  value: number;
}

/** Props of `PxBars`. Other `div` props go to the root element. */
export interface PxBarsProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The bars, left to right. Bars spring to new values when this changes. */
  data?: readonly PxBarsDatum[];
  /** Top of the value axis. Without it, or with 0, the axis tops out at 110% of the largest value. */
  max?: number;
  /** Start of the accessible description, followed by every label and value. */
  label?: string;
  /** Unit shown after each value in the tooltip and the accessible description. */
  unit?: string;
  /** Canvas height in pixels. */
  height?: number;
}

const SAMPLE_DATA: PxBarsDatum[] = [
  { label: "Mon", value: 12 },
  { label: "Tue", value: 18 },
  { label: "Wed", value: 9 },
  { label: "Thu", value: 22 },
  { label: "Fri", value: 17 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 4 },
];

/** Width of the value axis on the left. */
const AXIS = 30;
/** Height of one pixel cell in a bar. */
const CELL = 6;

interface Bar {
  position: number;
  velocity: number;
}

/**
 * Pixel bar chart whose bars grow cell by cell and spring to new data. Hovering a bar, or the arrow keys
 * while the chart has focus, shows its exact value in a tooltip.
 *
 * @example
 * <PxBars label="Runs per day" unit="runs" data={[{ label: "Mon", value: 12 }, { label: "Tue", value: 18 }]} />
 */
export function PxBars({
  data = SAMPLE_DATA,
  max = 0,
  label = "Bar chart",
  unit,
  height = 170,
  className,
  ...props
}: PxBarsProps) {
  const hovered = React.useRef(-1);
  const bars = React.useRef<Bar[]>([]);
  /** When the bars started growing, in seconds; each bar waits 50 ms longer than the one before. */
  const growStart = React.useRef(0);
  const tipRef = React.useRef<HTMLSpanElement>(null);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, context: g, time, delta, canvas } = frame;
    const w = frame.width;
    const h = frame.height;
    const reduced = prefersReducedMotion();
    const n = data.length;
    const values = data.map((datum) => drawableValue(datum.value));
    const columnWidth = n > 0 ? (w - AXIS) / n : 0;
    const top = 8;
    const bottom = h - 22;
    const axisMax = Math.max(1, max || Math.max(0, ...values) * 1.1);
    const cells = Math.floor((bottom - top) / CELL);
    const hover = hovered.current;
    let moving = false;
    frame.clear();

    g.font = `10px ${getComputedStyle(canvas).fontFamily || "monospace"}`;
    g.textBaseline = "middle";
    g.textAlign = "right";
    for (let q = 0; q <= 4; q++) {
      const y = bottom - ((bottom - top) * q) / 4;
      for (let x = AXIS; x < w; x += 6) frame.dot(x, y, palette.foreground, 0.12, 1.6);
      g.globalAlpha = 0.9;
      g.fillStyle = rgba(palette.muted);
      g.fillText(String(Math.round((axisMax * q) / 4)), AXIS - 6, y);
    }

    // the first bars stagger in; bars added later start at once
    if (bars.current.length === 0) growStart.current = time;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    data.forEach((datum, i) => {
      const target = (values[i] / axisMax) * cells;
      let bar = bars.current[i];
      if (!bar) {
        bar = { position: 0, velocity: 0 };
        bars.current[i] = bar;
      }
      if (reduced) bar.position = target;
      else if (time > growStart.current + i * 0.05) springEuler(bar, target, delta, 160, 0.65);
      if (Math.abs(target - bar.position) > 0.02 || Math.abs(bar.velocity) > 0.05) moving = true;

      const isHovered = i === hover;
      const x0 = AXIS + i * columnWidth + columnWidth * 0.18;
      const columns = Math.max(1, Math.floor((columnWidth * 0.64) / CELL));
      const filled = Math.max(0, bar.position);
      const full = Math.floor(filled);
      for (let c = 0; c < columns; c++) {
        for (let k = 0; k < Math.ceil(filled); k++) {
          // the top cell fades in with the fraction of a cell the bar has reached
          const isTop = k === full;
          const alpha = isTop ? filled - full : 1;
          const color =
            isTop || isHovered ? mixRgb(palette.accent, palette.shine, isHovered ? 0.35 : 0.5) : palette.accent;
          frame.dot(
            x0 + c * CELL,
            bottom - (k + 1) * CELL + 1.5,
            color,
            (hover >= 0 && !isHovered ? 0.45 : 0.95) * alpha,
            4.5,
          );
        }
      }
      g.globalAlpha = isHovered ? 1 : 0.85;
      g.fillStyle = rgba(isHovered ? palette.foreground : palette.muted);
      g.fillText(datum.label, x0 + (columns * CELL) / 2 - 1, h - 6);
    });
    g.globalAlpha = 1;

    const tip = tipRef.current;
    const datum = data[hover];
    const bar = bars.current[hover];
    if (tip && datum && bar) {
      const x = AXIS + (hover + 0.5) * columnWidth;
      const text = `${datum.label} · ${formatValue(datum.value, unit)}`;
      tip.hidden = false;
      if (tip.textContent !== text) tip.textContent = text;
      tip.style.left = `${clamp(x, 50, w - 50)}px`;
      tip.style.top = `${bottom - Math.max(0, bar.position) * CELL}px`;
    }
    return moving;
  });

  React.useEffect(redraw, [data, max, unit, redraw]);

  const setHover = (index: number) => {
    hovered.current = index;
    redraw();
  };
  const hideTip = () => {
    if (tipRef.current) tipRef.current.hidden = true;
    setHover(-1);
  };

  const description = `${label}: ${data.map((datum) => `${datum.label} ${formatValue(datum.value, unit)}`).join(", ")}`;

  return (
    <div data-slot="px-bars" className={cn("relative block", className)} {...props}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={description}
        className="block w-full cursor-crosshair font-mono outline-none [image-rendering:pixelated] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
        style={{ height }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const index = Math.floor((event.clientX - rect.left - AXIS) / ((rect.width - AXIS) / data.length));
          setHover(index >= 0 && index < data.length ? index : -1);
        }}
        onPointerLeave={hideTip}
        onBlur={hideTip}
        onKeyDown={(event) => {
          const n = data.length;
          if (n === 0) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setHover((hovered.current + 1) % n);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setHover((hovered.current - 1 + n) % n);
          }
        }}
      />
      {/* positioned from the animation loop, so it rides on the springing bar */}
      <span
        ref={tipRef}
        hidden
        className="pointer-events-none absolute z-[5] [transform:translate(-50%,calc(-100%-6px))] rounded-md bg-foreground px-2 py-1 text-[11.5px] leading-normal whitespace-nowrap text-card"
      />
    </div>
  );
}

/** The height a value is drawn at: negative and non-finite values draw an empty bar instead of breaking the scale. */
function drawableValue(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** A value as the tooltip and the accessible description write it, with the unit when there is one. */
function formatValue(value: number, unit: string | undefined) {
  return `${value.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
}

"use client";

import * as React from "react";

import { clamp, hash, mixRgb } from "@/lib/lumesec/math";
import { useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { cn } from "@/lib/utils";

/** Props of `PxSkeleton`. Other `div` props go to the root element. */
export interface PxSkeletonProps extends React.ComponentProps<"div"> {
  /** While true the content is transparent and the skeleton shimmers over it; turning it off dissolves the skeleton. */
  loading?: boolean;
  /** Number of text bars. */
  lines?: number;
  /** Adds a 40 px circle on the left and shifts the bars to its right. */
  avatar?: boolean;
  /** The real content. It keeps its size while loading, and the skeleton is drawn over that box. */
  children?: React.ReactNode;
}

interface SkeletonShape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Circles use `x`, `y` as the centre and `width / 2` as the radius. */
  circle: boolean;
}

/** Widths of the text bars, as a share of the room next to the avatar; they repeat past five lines. */
const BAR_WIDTHS = [1, 0.9, 0.62, 0.8, 0.5];

/**
 * Loading wrapper. While `loading`, shimmering pixel bars cover the content's box; when loading ends the
 * pixels dissolve from left to right as the content fades in. The bars follow a fixed pattern and are
 * not traced from the content.
 *
 * @example
 * <PxSkeleton loading={!data} avatar lines={3}>
 *   <Profile data={data} />
 * </PxSkeleton>
 */
export function PxSkeleton({ loading = false, lines = 3, avatar = false, children, className, ...props }: PxSkeletonProps) {
  const reduced = useReducedMotion();
  /** When loading ended, in seconds; the dissolve runs for 0.55 s from there. */
  const fadeAt = React.useRef(-9);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, width, height, clear, dot }) => {
    const fade = loading ? 0 : clamp((time - fadeAt.current) / 0.55, 0, 1);
    clear();
    if (!loading && fade >= 1) return false;
    const wave = reduced ? -9 : ((time * 0.55) % 1.6) - 0.3;
    for (const shape of skeletonShapes(width, height, lines, avatar)) {
      for (const [x, y] of shapeCells(shape)) {
        // cells drop out at random, earlier on the left, so the skeleton dissolves left to right
        if (fade > 0 && hash(x * 1.7 + y * 3.1) < fade * 1.3 - (x / width) * 0.3) continue;
        const distance = (x + y * 0.5) / (width + height * 0.5) - wave;
        const shimmer = Math.max(0, 1 - Math.abs(distance) * 6);
        dot(x, y, mixRgb(palette.foreground, palette.accent, shimmer * 0.6), 0.1 + shimmer * 0.25, 2.2);
      }
    }
    // a still skeleton (reduced motion) needs no frames until loading ends; the dissolve always runs
    return loading ? !reduced : true;
  });

  const wasLoading = React.useRef(loading);
  React.useEffect(() => {
    if (wasLoading.current && !loading) fadeAt.current = performance.now() / 1000;
    wasLoading.current = loading;
    redraw();
  }, [loading, redraw]);

  React.useEffect(redraw, [lines, avatar, reduced, redraw]);

  return (
    <div
      data-slot="px-skeleton"
      data-loading={loading ? "" : undefined}
      aria-live="polite"
      aria-busy={loading}
      className={cn("relative block", className)}
      {...props}
    >
      {/* hidden content is inert while loading, so it cannot be clicked or reached with Tab */}
      <div inert={loading} className={cn("[transition:opacity_.45s_ease_.1s]", loading && "opacity-0 [transition:none]")}>
        {children}
      </div>
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}

/** The avatar circle and text bars for a box of `width` by `height`. */
function skeletonShapes(width: number, height: number, lines: number, avatar: boolean): SkeletonShape[] {
  const shapes: SkeletonShape[] = [];
  const left = avatar ? 56 : 0;
  if (avatar) shapes.push({ x: 20, y: Math.min(20, height / 2), width: 40, height: 40, circle: true });
  const lineHeight = 10;
  // spacing comes from at most the first 120px, so tall content keeps the bars near the top
  const gap = Math.max(8, (Math.min(height, 120) - lines * lineHeight) / (lines + 1));
  for (let i = 0; i < lines; i++) {
    shapes.push({
      x: left,
      y: gap / 2 + i * (lineHeight + gap),
      width: (width - left) * BAR_WIDTHS[i % BAR_WIDTHS.length],
      height: i === 0 ? 12 : lineHeight,
      circle: false,
    });
  }
  return shapes;
}

/** The dot positions of a shape on a 3px grid. */
function shapeCells(shape: SkeletonShape): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  if (shape.circle) {
    const radius = shape.width / 2;
    for (let y = -radius; y <= radius; y += 3) {
      for (let x = -radius; x <= radius; x += 3) {
        if (Math.hypot(x, y) <= radius) cells.push([shape.x + x, shape.y + y]);
      }
    }
    return cells;
  }
  for (let y = shape.y; y < shape.y + shape.height; y += 3) {
    for (let x = shape.x; x < shape.x + shape.width; x += 3) cells.push([x, y]);
  }
  return cells;
}

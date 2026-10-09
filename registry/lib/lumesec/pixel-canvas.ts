/**
 * LumeSec Elements: the canvas loop behind the Pixel UI components.
 *
 * A pixel component draws its visual layer as square dots on a canvas. `usePixelCanvas` sizes the canvas
 * to its box at the device pixel ratio (and again when the ratio changes), resolves the theme palette (and
 * re-resolves it when the theme changes), and runs the draw function on animation frames only while it asks
 * for more and the canvas is on screen.
 */
import * as React from "react";

import { onPixelRatioChange, sizeCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { THEME_TOKENS, usePalette, type Palette } from "@/lib/lumesec/color";
import { useAnimationLoop } from "@/lib/lumesec/motion";
import { clamp, rgba, type RGB } from "@/lib/lumesec/math";

/** Everything a draw call needs for one frame. Coordinates are CSS pixels. */
export interface PixelFrame extends CanvasSurface {
  /** Theme colours, resolved from CSS variables. */
  palette: Palette;
  /** Time in seconds. */
  time: number;
  /** Seconds since the previous frame, at most 0.05. */
  delta: number;
  /** Clear the canvas and reset alpha. */
  clear(): void;
  /** Fill a `size` px square at `(x, y)`. */
  dot(x: number, y: number, color: RGB, alpha?: number, size?: number): void;
}

/** Draws one frame. Return `true` to request another frame (an animation is still settling). */
export type PixelDraw = (frame: PixelFrame) => boolean | void;

/**
 * Bind a draw function to a canvas. Call `redraw()` whenever the state the drawing depends on changes;
 * resizes, pixel ratio and theme changes and scrolling back into view redraw automatically.
 *
 * @example
 * const { ref, redraw } = usePixelCanvas(({ clear, dot, palette }) => {
 *   clear();
 *   dot(0, 0, palette.accent);
 * });
 * React.useEffect(redraw, [checked, redraw]);
 * return <canvas ref={ref} className="block size-5 [image-rendering:pixelated]" />;
 */
export function usePixelCanvas(draw: PixelDraw) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const surface = React.useRef<CanvasSurface | null>(null);
  const drawRef = React.useRef(draw);
  React.useEffect(() => {
    drawRef.current = draw;
  });

  const loop = useAnimationLoop(ref, step);
  const palette = usePalette(ref, THEME_TOKENS, () => loop.kick());

  function step(time: number, delta: number) {
    const current = surface.current;
    const colors = palette.current;
    if (!current || !colors) return false;
    const { context, width, height } = current;
    const frame: PixelFrame = {
      ...current,
      palette: colors,
      time,
      delta,
      clear() {
        context.globalAlpha = 1;
        context.clearRect(0, 0, width, height);
      },
      dot(x, y, color, alpha = 1, size = 2) {
        context.globalAlpha = clamp(alpha, 0, 1);
        context.fillStyle = rgba(color);
        context.fillRect(x, y, size, size);
      },
    };
    return drawRef.current(frame) === true;
  }

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fit = () => {
      surface.current = sizeCanvas(canvas);
      loop.kick();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    const stopWatchingRatio = onPixelRatioChange(fit);
    return () => {
      observer.disconnect();
      stopWatchingRatio();
    };
  }, [loop]);

  return React.useMemo(() => ({ ref, redraw: loop.kick }), [loop]);
}

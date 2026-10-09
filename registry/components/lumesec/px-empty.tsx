"use client";

import * as React from "react";

import { mixRgb, rand } from "@/lib/lumesec/math";
import { useLazyRef, useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { Sparks } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** Which illustration and default copy to show. */
export type PxEmptyKind = "inbox" | "search" | "error" | "done";

/** Props of `PxEmpty`. Other `div` props go to the root element. */
export interface PxEmptyProps extends React.ComponentProps<"div"> {
  /** Illustration and default copy. `error` draws in the warning colour, `done` in the success colour. */
  kind?: PxEmptyKind;
  /** Title, rendered as an `<h3>`. Defaults to a title for the kind. */
  heading?: React.ReactNode;
  /** Help line under the title. Defaults to a sentence for the kind. */
  description?: React.ReactNode;
  /** Actions, such as buttons, centred under the text. */
  children?: React.ReactNode;
}

/** 16x12 illustrations: `#` is a pixel, `*` a highlighted pixel. */
const EMPTY_ART: Record<PxEmptyKind, readonly string[]> = {
  inbox: [
    "................",
    "..############..",
    "..#..........#..",
    "..#..........#..",
    "..#..........#..",
    ".##..........##.",
    ".#.####..####.#.",
    ".#....#..#....#.",
    ".#....####....#.",
    ".#............#.",
    ".##############.",
    "................",
  ],
  search: [
    "....######......",
    "...#......#.....",
    "..#..**....#....",
    "..#.*......#....",
    "..#........#....",
    "..#........#....",
    "...#......#.....",
    "....######......",
    "..........##....",
    "...........##...",
    "............##..",
    ".............#..",
  ],
  error: [
    ".......##.......",
    "......#..#......",
    "......#..#......",
    ".....#....#.....",
    ".....#.**.#.....",
    "....#..**..#....",
    "....#..**..#....",
    "...#...**...#...",
    "...#........#...",
    "..#....**....#..",
    ".#.....**.....#.",
    "################",
  ],
  done: [
    ".....######.....",
    "...##......##...",
    "..#..........#..",
    ".#.........**.#.",
    ".#........**..#.",
    "#........**....#",
    "#..**...**.....#",
    "#...**.**......#",
    ".#...***......#.",
    ".#....*.......#.",
    "..#..........#..",
    "...##......##...",
  ],
};

const DEFAULT_HEADINGS: Record<PxEmptyKind, string> = {
  inbox: "No messages yet",
  search: "No results",
  error: "Something went wrong",
  done: "All caught up",
};

const DEFAULT_DESCRIPTIONS: Record<PxEmptyKind, string> = {
  inbox: "New messages will show up here.",
  search: "Try a shorter search or check the spelling.",
  error: "We couldn’t load this. Check your connection and try again.",
  done: "You’ve handled everything for now.",
};

/** One pixel of the illustration, falling from above into its target cell. */
interface ArtPixel {
  targetY: number;
  x: number;
  y: number;
  velocity: number;
  alpha: number;
  highlight: boolean;
  /** Time in seconds when it starts to fall. */
  startAt: number;
}

/** Size of one illustration pixel and the canvas the 16x12 grid is centred in. */
const PIXEL = 8;
const CANVAS_WIDTH = 144;

/**
 * Empty state with a pixel illustration that drops into place row by row and then floats, plus a title,
 * a line of help and room for actions. Every few seconds a pixel throws a small sparkle.
 *
 * @example
 * <PxEmpty kind="search">
 *   <button type="button">Clear search</button>
 * </PxEmpty>
 */
export function PxEmpty({ kind = "inbox", heading, description, children, className, ...props }: PxEmptyProps) {
  const art = EMPTY_ART[kind] ? kind : "inbox";
  const reduced = useReducedMotion();
  const pixels = React.useRef<ArtPixel[]>([]);
  const sparksRef = useLazyRef(() => new Sparks());
  const lastSpark = React.useRef(0);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, delta, context, clear, dot }) => {
    const color = art === "error" ? palette.warning : art === "done" ? palette.success : palette.accent;
    clear();
    const bob = reduced ? 0 : Math.sin(time * 1.6) * 2;
    for (const pixel of pixels.current) {
      if (time >= pixel.startAt && !reduced) {
        pixel.velocity += 900 * delta;
        pixel.y += pixel.velocity * delta;
        if (pixel.y >= pixel.targetY) {
          // land with a small bounce that dies out
          pixel.y = pixel.targetY;
          pixel.velocity = -pixel.velocity * 0.25;
          if (Math.abs(pixel.velocity) < 20) pixel.velocity = 0;
        }
        pixel.alpha = Math.min(1, pixel.alpha + delta * 5);
      }
      if (pixel.alpha > 0) {
        dot(
          pixel.x,
          pixel.y + bob,
          pixel.highlight ? mixRgb(color, palette.shine, 0.5) : color,
          pixel.alpha * (pixel.highlight ? 1 : 0.85),
          6.6,
        );
      }
    }
    if (!reduced && time - lastSpark.current > 1.4) {
      lastSpark.current = time;
      const source = pixels.current[Math.floor(Math.random() * pixels.current.length)];
      if (source)
        sparksRef.current.add(source.x + 3, source.y + 3, 5, [palette.shine, color], {
          speed: [20, 60],
          life: [0.4, 0.8],
        });
    }
    sparksRef.current.step(context, delta);
    return !reduced;
  });

  // rebuild the falling pixels whenever the illustration changes
  React.useEffect(() => {
    pixels.current = buildPixels(art, reduced);
    redraw();
  }, [art, reduced, redraw]);

  return (
    <div
      data-slot="px-empty"
      data-kind={art}
      className={cn("grid justify-items-center gap-1.5 py-2 text-center text-foreground", className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="mb-1.5 block h-[112px] w-[144px] [image-rendering:pixelated]"
      />
      <h3 className="m-0 text-[15px] leading-[1.5] font-semibold">{heading ?? DEFAULT_HEADINGS[art]}</h3>
      <p className="m-0 max-w-[32ch] text-[13px] leading-[1.5] text-muted-foreground">
        {description ?? DEFAULT_DESCRIPTIONS[art]}
      </p>
      {children != null && <div className="mt-2.5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** The pixels of an illustration, above their cells and invisible, timed to fall in; in place at once with reduced motion. */
function buildPixels(kind: PxEmptyKind, reduced: boolean): ArtPixel[] {
  const now = performance.now() / 1000;
  const offsetX = (CANVAS_WIDTH - 16 * PIXEL) / 2;
  const offsetY = 6;
  const pixels: ArtPixel[] = [];
  EMPTY_ART[kind].forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      const targetY = offsetY + y * PIXEL;
      pixels.push({
        targetY,
        x: offsetX + x * PIXEL,
        y: reduced ? targetY : targetY - 50 - rand(0, 30),
        velocity: 0,
        alpha: reduced ? 1 : 0,
        highlight: cell === "*",
        // the bottom row falls first, with a slight left-to-right ripple
        startAt: now + (11 - y) * 0.03 + x * 0.008 + rand(0, 0.06),
      });
    });
  });
  return pixels;
}

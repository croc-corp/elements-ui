"use client";

import * as React from "react";

import { clamp } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Props of `PxPagination`. Other `nav` props go to the root. */
export interface PxPaginationProps extends Omit<React.ComponentProps<"nav">, "children" | "onChange"> {
  /** Number of pages. Rounded down; anything below 1 (or not a number) shows one page. */
  total: number;
  /** Controlled current page, from 1. Use with `onPageChange`. */
  page?: number;
  /** Initial page when uncontrolled. */
  defaultPage?: number;
  /** Called when the user picks a page. */
  onPageChange?: (page: number) => void;
}

/** A page button, or an ellipsis for a run of hidden pages. */
type Slot = number | "gap-start" | "gap-end";

/**
 * Pagination with previous and next buttons, page numbers and ellipses, where a pixel block slides to the
 * page you pick. It does not navigate or load data; handle `onPageChange`.
 *
 * @example
 * const [page, setPage] = React.useState(5);
 * <PxPagination total={24} page={page} onPageChange={setPage} />
 */
export function PxPagination({ total: totalProp, page: pageProp, defaultPage = 1, onPageChange, className, ...props }: PxPaginationProps) {
  const total = Number.isFinite(totalProp) ? Math.max(1, Math.floor(totalProp)) : 1;
  const [rawPage, setPage] = useControllableState({ value: pageProp, defaultValue: defaultPage, onChange: onPageChange });
  const page = Number.isFinite(rawPage) ? clamp(Math.round(rawPage), 1, total) : 1;

  const currentRef = React.useRef<HTMLButtonElement | null>(null);
  /** Where the block is drawn, in canvas coordinates; null until the first frame. */
  const block = React.useRef<{ position: number; velocity: number; y: number } | null>(null);
  /** The button the user pressed, while its page change is pending; focus moves on only if it goes away. */
  const pressed = React.useRef<HTMLButtonElement | null>(null);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, delta } = frame;
    const button = currentRef.current;
    if (!button) return false;
    const tx = button.offsetLeft;
    const ty = button.offsetTop;
    let state = block.current;
    if (!state || prefersReducedMotion()) {
      state = { position: tx, velocity: 0, y: ty };
      block.current = state;
    } else {
      springEuler(state, tx, delta, 300, 0.72);
      state.y = ty;
    }
    frame.clear();
    const { position: bx, y: by } = state;
    for (let y = by + 3; y < by + button.offsetHeight - 2; y += 3) {
      for (let x = bx + 3; x < bx + button.offsetWidth - 2; x += 3) frame.dot(x, y, palette.accent, 1, 2.6);
    }
    return Math.abs(tx - state.position) > 0.3 || Math.abs(state.velocity) > 1;
  });

  React.useLayoutEffect(() => {
    const origin = pressed.current;
    pressed.current = null;
    // Next stays focused for the next press; only a button that unmounted or became disabled hands focus to the page
    if (origin && (!origin.isConnected || origin.disabled)) currentRef.current?.focus({ preventScroll: true });
    redraw();
  }, [page, total, redraw]);

  const go = (target: number, from: HTMLButtonElement) => {
    const next = clamp(target, 1, total);
    if (next === page) return;
    const current = currentRef.current;
    // the block leaves from the button that was current, even if it had not settled yet
    if (current) block.current = { position: current.offsetLeft, velocity: block.current?.velocity ?? 0, y: current.offsetTop };
    pressed.current = from;
    setPage(next);
  };

  return (
    <nav
      data-slot="px-pagination"
      aria-label="Pagination"
      className={cn("relative flex flex-wrap items-center gap-1", className)}
      {...props}
    >
      <button type="button" aria-label="Previous page" disabled={page === 1} className={cn(BUTTON, HOVER)} onClick={(event) => go(page - 1, event.currentTarget)}>
        <svg viewBox="0 0 14 14" aria-hidden="true" className={ARROW}>
          <path d="M8.5 3L4.5 7l4 4" />
        </svg>
      </button>
      {pageSlots(page, total).map((slot) =>
        typeof slot === "number" ? (
          <button
            key={slot}
            ref={slot === page ? currentRef : undefined}
            type="button"
            aria-label={`Page ${slot}`}
            aria-current={slot === page ? "page" : undefined}
            className={cn(BUTTON, slot === page ? "font-semibold text-lumesec-foreground" : HOVER)}
            onClick={(event) => go(slot, event.currentTarget)}
          >
            {slot}
          </button>
        ) : (
          <span key={slot} aria-hidden="true" className="min-w-[22px] text-center text-muted-foreground">
            …
          </span>
        ),
      )}
      <button type="button" aria-label="Next page" disabled={page === total} className={cn(BUTTON, HOVER)} onClick={(event) => go(page + 1, event.currentTarget)}>
        <svg viewBox="0 0 14 14" aria-hidden="true" className={ARROW}>
          <path d="M5.5 3l4 4-4 4" />
        </svg>
      </button>
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full [image-rendering:pixelated]" />
    </nav>
  );
}

const BUTTON =
  "relative z-[1] h-[34px] min-w-[34px] cursor-pointer select-none rounded-lg border-0 bg-transparent px-2 text-[13.5px] leading-normal tabular-nums text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-35";

/** Hover fill for every button except the current page, whose block is drawn on the canvas. */
const HOVER = "enabled:hover:bg-foreground/7";

const ARROW =
  "inline-block size-3.5 fill-none stroke-current stroke-[1.8] align-[-2px] [stroke-linecap:round] [stroke-linejoin:round]";

/**
 * Up to seven pages are all shown. Beyond that: the first and last page, a window around the current page,
 * and an ellipsis for each hidden run.
 */
function pageSlots(page: number, total: number): Slot[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const low = Math.max(2, Math.min(page - 1, total - 4));
  const high = Math.min(total - 1, Math.max(page + 1, 5));
  const slots: Slot[] = [1];
  if (low > 2) slots.push("gap-start");
  for (let i = low; i <= high; i++) slots.push(i);
  if (high < total - 1) slots.push("gap-end");
  slots.push(total);
  return slots;
}

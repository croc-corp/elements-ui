"use client";

import * as React from "react";

import { clamp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion, useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useComposedRef } from "@/lib/lumesec/react";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Side of the trigger the bubble opens on. */
export type PxTooltipPlacement = "top" | "bottom";

/** Props of `PxTooltip`. Other `span` props go to the root element around the trigger. */
export interface PxTooltipProps extends Omit<React.ComponentProps<"span">, "content"> {
  /** Tooltip text. It does not wrap. */
  content: React.ReactNode;
  /** Preferred side: `bottom` places the bubble below the trigger. It flips when that side has no room. */
  placement?: PxTooltipPlacement;
  /** Milliseconds of hover or focus before the bubble opens. */
  delay?: number;
  /** Controlled open state. Use with `onOpenChange`. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when hover, focus or Escape opens or closes the tooltip. */
  onOpenChange?: (open: boolean) => void;
  /** The trigger, usually a button. A single element gets `aria-describedby` pointing at the tooltip. */
  children: React.ReactNode;
}

/** Where the bubble ended up: its side, and how far it moved sideways to stay inside the viewport. */
interface BubbleLayout {
  side: PxTooltipPlacement;
  shift: number;
}

/** Distance the bubble keeps from the viewport edges, in px. */
const VIEWPORT_MARGIN = 8;
/** Space between trigger and bubble, in px; the arrow sits in it. */
const GAP = 9;

/**
 * Tooltip whose bubble grows out of its arrow pixel by pixel before the text fades in. It opens after
 * `delay` on hover or keyboard focus, closes 60 ms after the pointer or focus leaves, and Escape closes
 * it. The bubble flips and shifts to stay inside the viewport. The trigger is described by the tooltip text.
 *
 * @example
 * <PxTooltip content="Copy link">
 *   <button type="button" aria-label="Copy link">…</button>
 * </PxTooltip>
 */
export function PxTooltip({
  content,
  placement = "top",
  delay = 250,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  ref,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: PxTooltipProps) {
  const tooltipId = React.useId();
  const reduced = useReducedMotion();
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const rootRef = React.useRef<HTMLSpanElement>(null);
  // the root is measured to place the bubble, and still reaches the caller's `ref`
  const setRootRef = useComposedRef(rootRef, ref);
  const bubbleRef = React.useRef<HTMLSpanElement>(null);

  // the bubble stays rendered while it shrinks back; `ready` fades the text in once it has mostly grown
  const [shown, setShown] = React.useState(open);
  const [ready, setReady] = React.useState(false);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open && !shown) setShown(true);
  if (open !== wasOpen) {
    setWasOpen(open);
    // every opening fades the text in again
    if (open) setReady(false);
  }

  const [layout, setLayout] = React.useState<BubbleLayout>({ side: placement, shift: 0 });
  const bottom = layout.side === "bottom";

  // measure before paint: flip to the other side when this one has no room, and shift into the viewport
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const bubble = bubbleRef.current;
    if (!shown || !root || !bubble) return;
    const next = fitInViewport(root.getBoundingClientRect(), bubble.offsetWidth, bubble.offsetHeight, placement);
    setLayout((current) => (current.side === next.side && current.shift === next.shift ? current : next));
  }, [shown, placement, content]);

  /** How far the bubble has grown out of the arrow, 0 to 1. */
  const growth = React.useRef(0);
  const readyRef = React.useRef(false);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, delta, width, height, clear, dot }) => {
    const target = open ? 1 : 0;
    growth.current = reduced ? target : growth.current + clamp(target - growth.current, -delta * 9, delta * 7);
    const grown = growth.current;
    if (!open && grown <= 0) {
      setShown(false);
      return false;
    }
    const nextReady = open && grown > 0.6;
    if (nextReady !== readyRef.current) {
      readyRef.current = nextReady;
      setReady(nextReady);
    }
    // the arrow stays under the trigger when the bubble is shifted
    const anchorX = width / 2 - layout.shift;
    const anchorY = bottom ? 0 : height;
    const reach = Math.hypot(width, height) * grown;
    clear();
    // a white bubble on dark surfaces reads harsh, so it takes a hint of the raised surface
    const fill = palette.dark ? mixRgb(palette.foreground, palette.track, 0.05) : palette.foreground;
    for (let y = 8; y < height - 8; y += 3) {
      for (let x = 1; x < width - 1; x += 3) {
        const fromSide = Math.min(x, width - x);
        const fromEdge = Math.min(y - 8, height - 8 - y);
        if (fromSide < 4 && fromEdge < 4 && Math.hypot(4 - fromSide, 4 - fromEdge) > 4) continue;
        if (Math.hypot(x - anchorX, y - anchorY) > reach) continue;
        dot(x - 0.2, y - 0.2, fill, 1, 3.2);
      }
    }
    for (let k = 0; k < 3; k++) {
      for (let j = -k; j <= k; j++) {
        dot(anchorX + j * 3 - 1.5, bottom ? 9 - (3 - k) * 3 : height - 8 + (2 - k) * 3, fill, grown, 3.2);
      }
    }
    return Math.abs(grown - target) > 0.001;
  });

  React.useEffect(() => {
    if (open) {
      // every opening grows the bubble from the arrow again
      growth.current = prefersReducedMotion() ? 1 : 0;
      readyRef.current = false;
    }
    redraw();
  }, [open, redraw]);

  React.useEffect(redraw, [layout, reduced, redraw]);

  const showTimer = React.useRef(0);
  const hideTimer = React.useRef(0);
  React.useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const scheduleOpen = () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const scheduleClose = () => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 60);
  };

  // Escape closes the tooltip wherever focus is, so a hover-opened bubble can be dismissed too
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.clearTimeout(showTimer.current);
      setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  // a fragment cannot take attributes, so only a single element is described by the tooltip
  const trigger =
    React.isValidElement<{ "aria-describedby"?: string }>(children) && children.type !== React.Fragment
      ? React.cloneElement(children, {
          "aria-describedby": [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" "),
        })
      : children;

  return (
    <span
      ref={setRootRef}
      data-slot="px-tooltip"
      data-state={open ? "open" : "closed"}
      className={cn("relative inline-block align-middle", className)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) scheduleOpen();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (!event.defaultPrevented) scheduleClose();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) scheduleOpen();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (!event.defaultPrevented) scheduleClose();
      }}
      {...props}
    >
      {trigger}
      <span
        ref={bubbleRef}
        id={tooltipId}
        role="tooltip"
        data-side={layout.side}
        hidden={!shown}
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-card",
          bottom ? "top-[calc(100%+9px)]" : "bottom-[calc(100%+9px)]",
        )}
        style={layout.shift ? { marginLeft: layout.shift } : undefined}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute -top-2 left-0 block h-[calc(100%+16px)] w-full [image-rendering:pixelated]"
        />
        <span className={cn("relative [transition:opacity_.15s]", ready ? "opacity-100" : "opacity-0")}>{content}</span>
      </span>
    </span>
  );
}

/**
 * The side and sideways shift that keep a `width` by `height` bubble inside the viewport. The bubble flips
 * only when its preferred side lacks room and the other side has it; the shift stops short of the
 * rounded corners, so the arrow always stays on the bubble.
 */
function fitInViewport(trigger: DOMRect, width: number, height: number, placement: PxTooltipPlacement): BubbleLayout {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const roomAbove = trigger.top - GAP - height >= VIEWPORT_MARGIN;
  const roomBelow = trigger.bottom + GAP + height <= viewportHeight - VIEWPORT_MARGIN;
  let side = placement;
  if (placement === "top" && !roomAbove && roomBelow) side = "bottom";
  if (placement === "bottom" && !roomBelow && roomAbove) side = "top";

  const center = trigger.left + trigger.width / 2;
  const overflowLeft = VIEWPORT_MARGIN - (center - width / 2);
  const overflowRight = center + width / 2 - (viewportWidth - VIEWPORT_MARGIN);
  const shift = overflowLeft > 0 ? overflowLeft : overflowRight > 0 ? -overflowRight : 0;
  const limit = Math.max(0, width / 2 - 12);
  return { side, shift: Math.round(clamp(shift, -limit, limit)) };
}

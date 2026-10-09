"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-swipe.element";
import type * as ElementModule from "@/components/lumesec/hf-swipe.element";

/** The `<hf-swipe>` element, with its properties and methods. */
export type HfSwipeElement = ElementModule.HSwipe;

export interface HfSwipeProps extends Omit<LumesecElementProps<HfSwipeElement>, "label" | "doneLabel" | "hint" | "doneHint" | "reset" | "onConfirm"> {
  /** Text in the track before confirming, also used in the handle's `aria-label`. Observed. Default: `Slide to deploy`. */
  label?: string;
  /** Text in the track after confirming; announced to screen readers. Observed. Default: `Deployed`. */
  doneLabel?: string;
  /** Line below the track. Observed. Default: `Drag the handle all the way, or hold Enter`. */
  hint?: string;
  /** Line below the track after confirming. Observed. Default: `Deploy started · production`. */
  doneHint?: string;
  /** Milliseconds before returning to the idle state after confirming. `0` or less keeps it confirmed until `reset()` is called. Default: `2800`. */
  reset?: number;
  /** Fires once when the handle reaches the end, when it is released past 94% of the track, or when `confirm()` is called. */
  onConfirm?: (event: ElementModule.HSwipeEventMap["confirm"]) => void;
}

/**
 * Slide to confirm · `<hf-swipe>` · LumeSec Elements, Pixel HD.
 * Slide-to-confirm track for deliberate actions: the handle must reach the end, keyboard users hold Enter, and it re-arms after a delay.
 * @see https://elements.lumesec.ai/components/pixel-hd/swipe
 */
export function HfSwipe({ label, doneLabel, hint, doneHint, reset, onConfirm, ...props }: HfSwipeProps) {
  return useLumesecElement(
    "hf-swipe",
    props,
    { "label": label, "done-label": doneLabel, "hint": hint, "done-hint": doneHint, "reset": reset },
    { "confirm": onConfirm },
  );
}

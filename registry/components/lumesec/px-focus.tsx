"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-focus.element";
import type * as ElementModule from "@/components/lumesec/px-focus.element";

/** The `<px-focus>` element, with its properties and methods. */
export type PxFocusElement = ElementModule.Focus;

export interface PxFocusProps extends Omit<LumesecElementProps<PxFocusElement>, "duration" | "onStart" | "onPause" | "onReset" | "onDone"> {
  /** Session length in seconds, split evenly across the 60 ring pixels; a missing, invalid or non-positive value uses 60. A change applies immediately, also to a running session. Default: `60`. */
  duration?: number;
  /** Fires when the timer starts or resumes. */
  onStart?: (event: ElementModule.FocusEventMap["start"]) => void;
  /** Fires when the timer is paused. */
  onPause?: (event: ElementModule.FocusEventMap["pause"]) => void;
  /** Fires when the timer is reset. */
  onReset?: (event: ElementModule.FocusEventMap["reset"]) => void;
  /** Fires when the last pixel falls and the session is complete. */
  onDone?: (event: ElementModule.FocusEventMap["done"]) => void;
}

/**
 * Focus timer · `<px-focus>` · LumeSec Elements, Pixel Lab.
 * Focus timer drawn as a ring of 60 pixels; one breaks loose each interval and drops into a sand pile, and reset flies them back.
 * @see https://elements.lumesec.ai/components/pixel-lab/focus
 */
export function PxFocus({ duration, onStart, onPause, onReset, onDone, ...props }: PxFocusProps) {
  return useLumesecElement(
    "px-focus",
    props,
    { "duration": duration },
    { "start": onStart, "pause": onPause, "reset": onReset, "done": onDone },
  );
}

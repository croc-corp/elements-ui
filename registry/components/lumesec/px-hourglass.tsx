"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-hourglass.element";
import type * as ElementModule from "@/components/lumesec/px-hourglass.element";

/** The `<px-hourglass>` element, with its properties and methods. */
export type PxHourglassElement = ElementModule.Hourglass;

export interface PxHourglassProps extends Omit<LumesecElementProps<PxHourglassElement>, "duration" | "onFlip" | "onReset"> {
  /** Countdown length in seconds for a full top chamber; a missing, invalid or non-positive value uses 30. A later change re-times the sand left in the top chamber to run out in that many seconds. Default: `30`. */
  duration?: number;
  /** Fires after the hourglass has turned over. */
  onFlip?: (event: ElementModule.HourglassEventMap["flip"]) => void;
  /** Fires once when the top chamber runs empty, meaning the limit has reset. */
  onReset?: (event: ElementModule.HourglassEventMap["reset"]) => void;
}

/**
 * Rate-limit hourglass · `<px-hourglass>` · LumeSec Elements, Pixel Lab.
 * Falling-sand hourglass that counts down to a usage reset; the remaining time is derived from the sand left in the top chamber.
 *
 * Data: Set `duration` to the seconds left until your limit resets, and again whenever you learn a new value; nothing else is shown.
 * @see https://elements.lumesec.ai/components/pixel-lab/hourglass
 */
export function PxHourglass({ duration, onFlip, onReset, ...props }: PxHourglassProps) {
  return useLumesecElement(
    "px-hourglass",
    props,
    { "duration": duration },
    { "flip": onFlip, "reset": onReset },
  );
}

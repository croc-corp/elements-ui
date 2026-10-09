"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-countdown.element";
import type * as ElementModule from "@/components/lumesec/hf-countdown.element";

/** The `<hf-countdown>` element, with its properties and methods. */
export type HfCountdownElement = ElementModule.HCountdown;

export interface HfCountdownProps extends Omit<
  LumesecElementProps<HfCountdownElement>,
  "seconds" | "loop" | "label" | "onDone"
> {
  /** Starting duration in seconds (8049 is 2 h 14 min 9 s); a negative value counts as zero. Observed: a change restarts the countdown. `restart()` without an argument also reads it. Default: `8049`. */
  seconds?: number;
  /** Presence attribute. Restarts from `seconds` 1.6 s after reaching zero. Default: `false`. */
  loop?: boolean;
  /** Text above the digits; it also names the timer. Observed. Default: `Usage resets in`. */
  label?: string;
  /** Fires once when the countdown reaches zero. */
  onDone?: (event: ElementModule.HCountdownEventMap["done"]) => void;
}

/**
 * Countdown · `<hf-countdown>` · LumeSec Elements, Pixel HD.
 * HH:MM:SS countdown set over a dot grid; changed digits roll over as their tile reprints, the last ten seconds turn red and zero bursts.
 *
 * Data: Set the duration in `seconds` or call `restart(seconds)`. Without it a demo countdown of 2 h 14 min 9 s runs.
 * @see https://elements.lumesec.ai/components/pixel-hd/countdown
 */
export function HfCountdown({ seconds, loop, label, onDone, ...props }: HfCountdownProps) {
  return useLumesecElement("hf-countdown", props, { seconds: seconds, loop: loop, label: label }, { done: onDone });
}

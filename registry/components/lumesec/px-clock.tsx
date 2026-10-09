"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-clock.element";
import type * as ElementModule from "@/components/lumesec/px-clock.element";

/** The `<px-clock>` element, with its properties and methods. */
export type PxClockElement = ElementModule.Clock;

export type PxClockProps = LumesecElementProps<PxClockElement>;

/**
 * Morphing clock · `<px-clock>` · LumeSec Elements, Pixel Lab.
 * Live clock where each changing digit rolls to the next and sheds a few pixels; switching time zone rolls every digit at once.
 * @see https://elements.lumesec.ai/components/pixel-lab/clock
 */
export function PxClock({ ...props }: PxClockProps) {
  return useLumesecElement("px-clock", props, {}, {});
}

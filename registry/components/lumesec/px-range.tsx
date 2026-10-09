"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-range.element";
import type * as ElementModule from "@/components/lumesec/px-range.element";

/** The `<px-range>` element, with its properties and methods. */
export type PxRangeElement = ElementModule.Range;

export interface PxRangeProps extends Omit<LumesecElementProps<PxRangeElement>, "onChange"> {
  /** Fires when a drag ends and on each handled key press. Values are in milliseconds, in steps of 100; `max` of 4000 means open-ended (4,000+ ms). */
  onChange?: (event: ElementModule.RangeEventMap["change"]) => void;
}

/**
 * Histogram range · `<px-range>` · LumeSec Elements, Pixel Lab.
 * Two-thumb response-time filter over a pixel histogram; columns fill as they enter the range and the run count rolls as you drag.
 *
 * Demo data: The response-time histogram and its run counts are invented; only the selected range is a real control. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/range
 */
export function PxRange({ onChange, ...props }: PxRangeProps) {
  return useLumesecElement("px-range", props, {}, { change: onChange });
}

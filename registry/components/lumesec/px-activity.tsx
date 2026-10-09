"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-activity.element";
import type * as ElementModule from "@/components/lumesec/px-activity.element";

/** The `<px-activity>` element, with its properties and methods. */
export type PxActivityElement = ElementModule.Activity;

export type PxActivityProps = LumesecElementProps<PxActivityElement>;

/**
 * Activity heatmap · `<px-activity>` · LumeSec Elements, Pixel Lab.
 * Activity heatmap where each day is nine sub-pixels, so intensity shows as brightness and density; switching metric flips cells in a wave.
 *
 * Demo data: The daily activity counts are generated from each date; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/activity
 */
export function PxActivity({ ...props }: PxActivityProps) {
  return useLumesecElement(
    "px-activity",
    props,
    {},
    {},
  );
}

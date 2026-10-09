"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-matrix.element";
import type * as ElementModule from "@/components/lumesec/hf-matrix.element";

/** The `<hf-matrix>` element, with its properties and methods. */
export type HfMatrixElement = ElementModule.HMatrix;

export interface HfMatrixProps extends Omit<LumesecElementProps<HfMatrixElement>, "label"> {
  /** Heading text. Read once on connect. Default: `When your team uses AI`. */
  label?: string;
}

/**
 * Usage heatmap · `<hf-matrix>` · LumeSec Elements, Pixel HD.
 * Weekday-by-hour usage heatmap in which dot density is the value; the peak pulses, and hover or arrow keys show a cell's count.
 *
 * Demo data: The weekday-by-hour message and token counts are synthetic; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/matrix
 */
export function HfMatrix({ label, ...props }: HfMatrixProps) {
  return useLumesecElement(
    "hf-matrix",
    props,
    { "label": label },
    {},
  );
}

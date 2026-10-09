"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-area.element";
import type * as ElementModule from "@/components/lumesec/hf-area.element";

/** The `<hf-area>` element, with its properties and methods. */
export type HfAreaElement = ElementModule.HArea;

export interface HfAreaProps extends Omit<LumesecElementProps<HfAreaElement>, "label" | "days" | "data"> {
  /** Header label and start of the chart `aria-label`. Without `data` it also seeds the demo data. Observed. Default: `Tokens per day`. */
  label?: string;
  /** Range in days, at least 1. The range buttons offer 7, 30 and 90. Observed: changing it switches the range. Default: `30`. */
  days?: number;
  /** Daily values, oldest first: numbers or `{ value, date }` records (`date` as an ISO string or epoch ms). Observed: changing it morphs to the new series. Without it the chart shows demo data. */
  data?: readonly ElementModule.HfAreaDatum[];
}

/**
 * Area chart · `<hf-area>` · LumeSec Elements, Pixel HD.
 * Area chart with a bright line over a dithered fill; ranges morph into each other and hover adds a crosshair and the value.
 *
 * Data: Pass your daily values as `data`. Without it the chart shows demo data seeded from `label`.
 * @see https://elements.lumesec.ai/components/pixel-hd/area
 */
export function HfArea({ label, days, data, ...props }: HfAreaProps) {
  return useLumesecElement("hf-area", props, { label: label, days: days, data: data }, {});
}

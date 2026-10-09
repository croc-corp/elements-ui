"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-donut.element";
import type * as ElementModule from "@/components/lumesec/hf-donut.element";

/** The `<hf-donut>` element, with its properties and methods. */
export type HfDonutElement = ElementModule.HDonut;

export interface HfDonutProps extends Omit<LumesecElementProps<HfDonutElement>, "data" | "label" | "total"> {
  /** Comma-separated `Label:value` pairs, split at the last colon. Values are relative and shown as rounded percentages of their sum; a missing or negative value counts as 0. Observed: a change rebuilds the chart and it sweeps in again. Default: `Code:42,Writing:23,Analysis:18,Other:17`. */
  data?: string;
  /** Text in the centre and the start of the `aria-label`. Observed. Default: `Usage by task`. */
  label?: string;
  /** Text in the centre when no segment is focused. Defaults to the sum of the values. Observed. */
  total?: string;
}

/**
 * Donut · `<hf-donut>` · LumeSec Elements, Pixel HD.
 * Donut chart that sweeps in clockwise; hovering or arrowing to a segment pops it outward and rolls its share into the centre.
 *
 * Data: Pass your `Label:value` segments as `data` (and `total` for the centre). Without it the chart shows invented usage shares.
 * @see https://elements.lumesec.ai/components/pixel-hd/donut
 */
export function HfDonut({ data, label, total, ...props }: HfDonutProps) {
  return useLumesecElement("hf-donut", props, { data: data, label: label, total: total }, {});
}

"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-gauge.element";
import type * as ElementModule from "@/components/lumesec/px-gauge.element";

/** The `<px-gauge>` element, with its properties and methods. */
export type PxGaugeElement = ElementModule.Gauge;

export interface PxGaugeProps extends Omit<LumesecElementProps<PxGaugeElement>, "max"> {
  /** Full-scale value of the gauge and its tick labels; a missing, invalid or non-positive value uses 200. Read every frame, so a change applies immediately. Default: `200`. */
  max?: number;
}

/**
 * Throughput gauge · `<px-gauge>` · LumeSec Elements, Pixel Lab.
 * Half-circle pixel gauge for tokens per second with amber and red zones, a spring needle that overshoots and a peak marker.
 *
 * Demo data: The tokens-per-second reading is simulated; only `max` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/gauge
 */
export function PxGauge({ max, ...props }: PxGaugeProps) {
  return useLumesecElement("px-gauge", props, { max: max }, {});
}

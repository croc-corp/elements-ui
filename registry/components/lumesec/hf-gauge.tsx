"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-gauge.element";
import type * as ElementModule from "@/components/lumesec/hf-gauge.element";

/** The `<hf-gauge>` element, with its properties and methods. */
export type HfGaugeElement = ElementModule.HGauge;

export interface HfGaugeProps extends Omit<
  LumesecElementProps<HfGaugeElement>,
  "value" | "min" | "max" | "zones" | "decimals" | "label" | "unit"
> {
  /** Current value, clamped to `min`–`max`. Observed. Default: `42`. */
  value?: number;
  /** Lower bound. Observed. Default: `0`. */
  min?: number;
  /** Upper bound. Observed. Default: `100`. */
  max?: number;
  /** Two thresholds in value units, comma-separated: `Elevated` from the first, `Critical` from the second. A missing or invalid threshold uses 60 or 85. Observed. Default: `60,85`. */
  zones?: string;
  /** Decimal places in the displayed number. Observed. Default: `0`. */
  decimals?: number;
  /** Text under the gauge and the start of the `aria-label`. Observed. Default: `Rate limit`. */
  label?: string;
  /** Text after the number. An empty value hides it. Observed. Default: `%`. */
  unit?: string;
}

/**
 * Gauge · `<hf-gauge>` · LumeSec Elements, Pixel HD.
 * Semicircular gauge of green, amber and red cells with a sprung pointer; the zone word rolls when the value crosses a threshold.
 *
 * Data: Set `value` (with `min`, `max` and `zones`). Without it the gauge shows a demo value.
 * @see https://elements.lumesec.ai/components/pixel-hd/gauge
 */
export function HfGauge({ value, min, max, zones, decimals, label, unit, ...props }: HfGaugeProps) {
  return useLumesecElement(
    "hf-gauge",
    props,
    { value: value, min: min, max: max, zones: zones, decimals: decimals, label: label, unit: unit },
    {},
  );
}

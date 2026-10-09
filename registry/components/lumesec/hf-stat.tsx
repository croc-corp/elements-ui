"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-stat.element";
import type * as ElementModule from "@/components/lumesec/hf-stat.element";

/** The `<hf-stat>` element, with its properties and methods. */
export type HfStatElement = ElementModule.HStat;

export interface HfStatProps extends Omit<LumesecElementProps<HfStatElement>, "value" | "decimals" | "prefix" | "suffix" | "label" | "delta" | "data"> {
  /** Displayed value. Observed: a change counts up from the number currently shown. Default: `48210`. */
  value?: number;
  /** Decimal places. With 0 the number uses en-US thousands separators. Observed. Default: `0`. */
  decimals?: number;
  /** Text before the number. Observed. */
  prefix?: string;
  /** Text after the number. Observed. */
  suffix?: string;
  /** Caption above the number, also read by the live region. Observed. Default: `Messages this month`. */
  label?: string;
  /** Badge text. Green, or red when it starts with `-` or `−`. An empty value hides it. Observed. Default: `+12.4%`. */
  delta?: string;
  /** Comma-separated sparkline values. Needs at least three numbers; otherwise a generated 24-point series is shown. Observed. */
  data?: string;
}

/**
 * Stat tile · `<hf-stat>` · LumeSec Elements, Pixel HD.
 * Stat tile whose number counts up over a shimmer of dots; hovering the sparkline shows the value under the pointer.
 *
 * Data: Set `value`, `delta` and the sparkline `data`. Without them the tile shows a demo number, a demo delta and a generated sparkline.
 * @see https://elements.lumesec.ai/components/pixel-hd/stat
 */
export function HfStat({ value, decimals, prefix, suffix, label, delta, data, ...props }: HfStatProps) {
  return useLumesecElement(
    "hf-stat",
    props,
    { "value": value, "decimals": decimals, "prefix": prefix, "suffix": suffix, "label": label, "delta": delta, "data": data },
    {},
  );
}

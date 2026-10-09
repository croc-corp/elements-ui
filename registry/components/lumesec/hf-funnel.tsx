"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-funnel.element";
import type * as ElementModule from "@/components/lumesec/hf-funnel.element";

/** The `<hf-funnel>` element, with its properties and methods. */
export type HfFunnelElement = ElementModule.HFunnel;

export interface HfFunnelProps extends Omit<LumesecElementProps<HfFunnelElement>, "data"> {
  /** Comma-separated `Label:count` stages, top to bottom, split at the last colon; a missing or negative count is 0. Each stage width is relative to the first, with a 6% minimum. Observed: a change rebuilds the rows and the stages grow in again. Default: `Visited:12400,Signed up:4210,Activated:2380,Paid:910`. */
  data?: string;
}

/**
 * Funnel · `<hf-funnel>` · LumeSec Elements, Pixel HD.
 * Funnel chart where dots fall through the stages in proportion to conversion and drop-outs turn red and drift off the side.
 *
 * Data: Pass your `Label:count` stages as `data`. Without it the funnel shows invented visitor counts.
 * @see https://elements.lumesec.ai/components/pixel-hd/funnel
 */
export function HfFunnel({ data, ...props }: HfFunnelProps) {
  return useLumesecElement(
    "hf-funnel",
    props,
    { "data": data },
    {},
  );
}

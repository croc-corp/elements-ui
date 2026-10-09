"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-scatter.element";
import type * as ElementModule from "@/components/lumesec/hf-scatter.element";

/** The `<hf-scatter>` element, with its properties and methods. */
export type HfScatterElement = ElementModule.HScatter;

export interface HfScatterProps extends Omit<LumesecElementProps<HfScatterElement>, "label" | "onSelect"> {
  /** Heading text. Read once on connect. Default: `Latency vs. output`. */
  label?: string;
  /** Fires when a brush drag ends. `count` is the number of visible points inside the box; a click without dragging clears the brush and reports 0. */
  onSelect?: (event: ElementModule.HScatterEventMap["select"]) => void;
}

/**
 * Scatter with brush · `<hf-scatter>` · LumeSec Elements, Pixel HD.
 * Scatter plot of 270 runs with a drag-to-select brush; the summary rolls to the selection's medians and the legend toggles groups.
 *
 * Demo data: The 270 runs in three model groups are seeded random points; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/scatter
 */
export function HfScatter({ label, onSelect, ...props }: HfScatterProps) {
  return useLumesecElement(
    "hf-scatter",
    props,
    { "label": label },
    { "select": onSelect },
  );
}

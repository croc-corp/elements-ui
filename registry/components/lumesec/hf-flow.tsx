"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-flow.element";
import type * as ElementModule from "@/components/lumesec/hf-flow.element";

/** The `<hf-flow>` element, with its properties and methods. */
export type HfFlowElement = ElementModule.HFlow;

export interface HfFlowProps extends Omit<LumesecElementProps<HfFlowElement>, "label"> {
  /** Heading text. Observed. Default: `Where requests go`. */
  label?: string;
}

/**
 * Flow · `<hf-flow>` · LumeSec Elements, Pixel HD.
 * Sankey from Chat, Code and API to three models, with particles streaming in proportion to traffic; hovering a band isolates it.
 *
 * Demo data: The sources, models and 100k request split are invented; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/flow
 */
export function HfFlow({ label, ...props }: HfFlowProps) {
  return useLumesecElement("hf-flow", props, { label: label }, {});
}

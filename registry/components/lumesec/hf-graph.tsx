"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-graph.element";
import type * as ElementModule from "@/components/lumesec/hf-graph.element";

/** The `<hf-graph>` element, with its properties and methods. */
export type HfGraphElement = ElementModule.HGraph;

export interface HfGraphProps extends Omit<LumesecElementProps<HfGraphElement>, "label" | "autoplay" | "onDone"> {
  /** Heading text. Observed. Default: `Ultracode workflow`. */
  label?: string;
  /** Presence attribute. Starts a run 800 ms after the element connects. Default: `false`. */
  autoplay?: boolean;
  /** Fires when the reviewer finishes a run. */
  onDone?: (event: ElementModule.HGraphEventMap["done"]) => void;
}

/**
 * Agent graph · `<hf-graph>` · LumeSec Elements, Pixel HD.
 * Agent workflow graph that plays a run from lead agent to planner, three parallel agents and a reviewer, with light along live edges.
 *
 * Demo data: The agent graph, its labels and the run timings (partly random) are invented; only `label` and `autoplay` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/graph
 */
export function HfGraph({ label, autoplay, onDone, ...props }: HfGraphProps) {
  return useLumesecElement("hf-graph", props, { label: label, autoplay: autoplay }, { done: onDone });
}

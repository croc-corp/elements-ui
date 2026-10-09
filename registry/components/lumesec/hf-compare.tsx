"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-compare.element";
import type * as ElementModule from "@/components/lumesec/hf-compare.element";

/** The `<hf-compare>` element, with its properties and methods. */
export type HfCompareElement = ElementModule.HCompare;

export interface HfCompareProps extends Omit<LumesecElementProps<HfCompareElement>, "onInput"> {
  /** Fires on every divider move, from 0 (left) to 1 (right). Also fires once on connect with the start position, 0.55. */
  onInput?: (event: ElementModule.HCompareEventMap["input"]) => void;
}

/**
 * Before and after · `<hf-compare>` · LumeSec Elements, Pixel HD.
 * Before-and-after slider over a mock document: personal data is highlighted on the left and blacked out on the right.
 *
 * Demo data: The document and its personal data are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/compare
 */
export function HfCompare({ onInput, ...props }: HfCompareProps) {
  return useLumesecElement(
    "hf-compare",
    props,
    {},
    { "input": onInput },
  );
}

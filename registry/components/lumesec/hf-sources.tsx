"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-sources.element";
import type * as ElementModule from "@/components/lumesec/hf-sources.element";

/** The `<hf-sources>` element, with its properties and methods. */
export type HfSourcesElement = ElementModule.HSources;

export interface HfSourcesProps extends Omit<LumesecElementProps<HfSourcesElement>, "onOpen"> {
  /** Fires when a citation or source chip is clicked. `t` is the title, `d` the domain and `s` the snippet. */
  onOpen?: (event: ElementModule.HSourcesEventMap["open"]) => void;
}

/**
 * Sources and citations · `<hf-sources>` · LumeSec Elements, Pixel HD.
 * Paragraph with numbered citations; hovering or focusing one draws a dotted beam to its source chip and loads a preview card.
 *
 * Demo data: The paragraph, citations and sources are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/sources
 */
export function HfSources({ onOpen, ...props }: HfSourcesProps) {
  return useLumesecElement(
    "hf-sources",
    props,
    {},
    { "open": onOpen },
  );
}

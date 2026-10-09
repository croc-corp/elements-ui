"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-spotlight.element";
import type * as ElementModule from "@/components/lumesec/hf-spotlight.element";

/** The `<hf-spotlight>` element, with its properties and methods. */
export type HfSpotlightElement = ElementModule.HSpotlight;

export interface HfSpotlightProps extends Omit<LumesecElementProps<HfSpotlightElement>, "onStep" | "onFinish"> {
  /** Fires each time a step is shown. */
  onStep?: (event: ElementModule.HSpotlightEventMap["step"]) => void;
  /** Fires when the tour ends through Done, Skip or Escape. */
  onFinish?: (event: ElementModule.HSpotlightEventMap["finish"]) => void;
}

/**
 * Product tour · `<hf-spotlight>` · LumeSec Elements, Pixel HD.
 * Product tour over a mock app: dithered dimming, a rounded cut-out with a comet on its edge, and a step card that moves between targets.
 *
 * Demo data: The mock app and its four tour steps are built in; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/spotlight
 */
export function HfSpotlight({ onStep, onFinish, ...props }: HfSpotlightProps) {
  return useLumesecElement(
    "hf-spotlight",
    props,
    {},
    { "step": onStep, "finish": onFinish },
  );
}

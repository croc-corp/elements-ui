"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-carousel.element";
import type * as ElementModule from "@/components/lumesec/hf-carousel.element";

/** The `<hf-carousel>` element, with its properties and methods. */
export type HfCarouselElement = ElementModule.HCarousel;

export interface HfCarouselProps extends Omit<LumesecElementProps<HfCarouselElement>, "autoplay" | "onChange"> {
  /** Presence attribute. Advances every 5 s, draws a progress line along the bottom and shows a button that stops and starts the rotation. Pauses while hovered, focused or off-screen. Observed, so it can be added or removed at any time. Default: `false`. */
  autoplay?: boolean;
  /** Fires when the slide changes, by user action or autoplay. `index` is zero-based. */
  onChange?: (event: ElementModule.HCarouselEventMap["change"]) => void;
}

/**
 * Carousel · `<hf-carousel>` · LumeSec Elements, Pixel HD.
 * Carousel of four procedural pixel scenes with an ordered-dither dissolve between slides; autoplay pauses on hover or focus.
 *
 * Demo data: The four slides, generated scenes with built-in captions, cannot be replaced; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/carousel
 */
export function HfCarousel({ autoplay, onChange, ...props }: HfCarouselProps) {
  return useLumesecElement("hf-carousel", props, { autoplay: autoplay }, { change: onChange });
}

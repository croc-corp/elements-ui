"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-marquee.element";
import type * as ElementModule from "@/components/lumesec/hf-marquee.element";

/** The `<hf-marquee>` element, with its properties and methods. */
export type HfMarqueeElement = ElementModule.HMarquee;

export interface HfMarqueeProps extends Omit<LumesecElementProps<HfMarqueeElement>, "label"> {
  /** Caption above the rows. Read once on connect. Default: `Placeholder logos · teams building with it`. */
  label?: string;
}

/**
 * Logo marquee · `<hf-marquee>` · LumeSec Elements, Pixel HD.
 * Two rows of placeholder wordmarks drifting in opposite directions between dotted rules; the row under the pointer slows down.
 *
 * Demo data: The ten wordmarks are fictional placeholder logos; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/marquee
 */
export function HfMarquee({ label, ...props }: HfMarqueeProps) {
  return useLumesecElement("hf-marquee", props, { label: label }, {});
}

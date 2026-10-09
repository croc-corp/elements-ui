"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-card.element";
import type * as ElementModule from "@/components/lumesec/hf-card.element";

/** The `<hf-card>` element, with its properties and methods. */
export type HfCardElement = ElementModule.HCard;

export interface HfCardProps extends Omit<LumesecElementProps<HfCardElement>, "hue" | "seed" | "tags" | "alt"> {
  /** Base hue in degrees for the sky and ridges. Observed. Default: `262`. */
  hue?: number;
  /** Seed for the ridge shapes. Observed. Default: `valley`. */
  seed?: string;
  /** Comma-separated tag chips; an empty value shows none. Observed. Default: `Generative,Dither,Parallax`. */
  tags?: string;
  /** Accessible name of the landscape canvas. Observed. Default: `Pixel landscape illustration`. */
  alt?: string;
}

/**
 * Media card · `<hf-card>` · LumeSec Elements, Pixel HD.
 * Media card with a generated dithered landscape whose ridges shift at different depths as the card tilts toward the pointer.
 * @see https://elements.lumesec.ai/components/pixel-hd/card
 */
export function HfCard({ hue, seed, tags, alt, ...props }: HfCardProps) {
  return useLumesecElement(
    "hf-card",
    props,
    { "hue": hue, "seed": seed, "tags": tags, "alt": alt },
    {},
  );
}

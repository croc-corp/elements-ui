"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-hero.element";
import type * as ElementModule from "@/components/lumesec/hf-hero.element";

/** The `<hf-hero>` element, with its properties and methods. */
export type HfHeroElement = ElementModule.HHero;

export interface HfHeroProps extends Omit<
  LumesecElementProps<HfHeroElement>,
  "headline" | "primary" | "secondary" | "onPrimary" | "onSecondary"
> {
  /** Headline text, shown in an `<h2>` over the dot grid. Observed. Default: `Think in pixels.`. */
  headline?: string;
  /** Label of the primary button. Observed. Default: `Get started`. */
  primary?: string;
  /** Label of the secondary button. Observed. Default: `View components`. */
  secondary?: string;
  /** Fires when the primary button is clicked. */
  onPrimary?: (event: ElementModule.HHeroEventMap["primary"]) => void;
  /** Fires when the secondary button is clicked. */
  onSecondary?: (event: ElementModule.HHeroEventMap["secondary"]) => void;
}

/**
 * Hero · `<hf-hero>` · LumeSec Elements, Pixel HD.
 * Hero section whose headline sits in a dot grid and is revealed behind a bright front; the pointer pushes dots aside and a click sends a shockwave.
 * @see https://elements.lumesec.ai/components/pixel-hd/hero
 */
export function HfHero({ headline, primary, secondary, onPrimary, onSecondary, ...props }: HfHeroProps) {
  return useLumesecElement(
    "hf-hero",
    props,
    { headline: headline, primary: primary, secondary: secondary },
    { primary: onPrimary, secondary: onSecondary },
  );
}

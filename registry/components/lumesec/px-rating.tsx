"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-rating.element";
import type * as ElementModule from "@/components/lumesec/px-rating.element";

/** The `<px-rating>` element, with its properties and methods. */
export type PxRatingElement = ElementModule.Rating;

export interface PxRatingProps extends Omit<LumesecElementProps<PxRatingElement>, "onChange"> {
  /** Fires when a new rating from 1 to 5 is picked by pointer, keyboard or `pick()`; a key that leaves the rating unchanged fires nothing. */
  onChange?: (event: ElementModule.RatingEventMap["change"]) => void;
}

/**
 * Pixel stars · `<px-rating>` · LumeSec Elements, Pixel Lab.
 * Five pixel stars that fill like liquid as you hover; picking one pops it with sparks and rolls the label.
 * @see https://elements.lumesec.ai/components/pixel-lab/rating
 */
export function PxRating({ onChange, ...props }: PxRatingProps) {
  return useLumesecElement(
    "px-rating",
    props,
    {},
    { "change": onChange },
  );
}

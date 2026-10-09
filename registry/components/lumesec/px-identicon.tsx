"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-identicon.element";
import type * as ElementModule from "@/components/lumesec/px-identicon.element";

/** The `<px-identicon>` element, with its properties and methods. */
export type PxIdenticonElement = ElementModule.Identicon;

export interface PxIdenticonProps extends Omit<LumesecElementProps<PxIdenticonElement>, "onChange"> {
  /** Fires on every edit of the name field and on Shuffle. `name` is the trimmed input (`?` when empty); `hash` is the unsigned 32-bit hash of its lower-cased form. */
  onChange?: (event: ElementModule.IdenticonEventMap["change"]) => void;
}

/**
 * Pixel avatar · `<px-identicon>` · LumeSec Elements, Pixel Lab.
 * Symmetric 7x7 pixel avatar generated from a typed name; changed cells flip in a ring spreading from the centre as the hue drifts.
 * @see https://elements.lumesec.ai/components/pixel-lab/identicon
 */
export function PxIdenticon({ onChange, ...props }: PxIdenticonProps) {
  return useLumesecElement(
    "px-identicon",
    props,
    {},
    { "change": onChange },
  );
}

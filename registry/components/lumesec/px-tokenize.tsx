"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-tokenize.element";
import type * as ElementModule from "@/components/lumesec/px-tokenize.element";

/** The `<px-tokenize>` element, with its properties and methods. */
export type PxTokenizeElement = ElementModule.Tokenize;

export interface PxTokenizeProps extends Omit<LumesecElementProps<PxTokenizeElement>, "onChange"> {
  /** Fires on every edit with the token count. It does not fire when the element first connects. */
  onChange?: (event: ElementModule.TokenizeEventMap["change"]) => void;
}

/**
 * Token view · `<px-tokenize>` · LumeSec Elements, Pixel Lab.
 * Live token view: typed text splits into tinted spans and a strip of pixels where new tokens drop in, using a rough tokenizer.
 * @see https://elements.lumesec.ai/components/pixel-lab/tokenize
 */
export function PxTokenize({ onChange, ...props }: PxTokenizeProps) {
  return useLumesecElement("px-tokenize", props, {}, { change: onChange });
}

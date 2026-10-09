"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-secret.element";
import type * as ElementModule from "@/components/lumesec/px-secret.element";

/** The `<px-secret>` element, with its properties and methods. */
export type PxSecretElement = ElementModule.Secret;

export interface PxSecretProps extends Omit<LumesecElementProps<PxSecretElement>, "value"> {
  /** The key to display and copy. Changing it rebuilds the characters; the copy button reads the attribute at click time. Default: `sk-demo-4f9Q7xLm2Rk8Vt3nW6pA`. */
  value?: string;
}

/**
 * Secret field · `<px-secret>` · LumeSec Elements, Pixel Lab.
 * API key field hidden under crawling pixel noise; holding the eye wipes the noise away and each character decodes before it locks.
 *
 * Data: Pass your key as `value`. Without it the field shows a fake demo key.
 * @see https://elements.lumesec.ai/components/pixel-lab/secret
 */
export function PxSecret({ value, ...props }: PxSecretProps) {
  return useLumesecElement("px-secret", props, { value: value }, {});
}

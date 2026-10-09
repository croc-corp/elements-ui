"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-dissolve.element";
import type * as ElementModule from "@/components/lumesec/px-dissolve.element";

/** The `<px-dissolve>` element, with its properties and methods. */
export type PxDissolveElement = ElementModule.Dissolve;

export interface PxDissolveProps extends Omit<LumesecElementProps<PxDissolveElement>, "onDelete"> {
  /** Fires when a row's delete button is pressed, with the chat title. */
  onDelete?: (event: ElementModule.DissolveEventMap["delete"]) => void;
}

/**
 * Dissolve to delete · `<px-dissolve>` · LumeSec Elements, Pixel Lab.
 * Chat list where deleting a row turns it into pixels sampled from its own text, which drift away left to right before the gap closes.
 *
 * Demo data: The five chats are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/dissolve
 */
export function PxDissolve({ onDelete, ...props }: PxDissolveProps) {
  return useLumesecElement(
    "px-dissolve",
    props,
    {},
    { "delete": onDelete },
  );
}

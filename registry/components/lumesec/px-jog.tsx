"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-jog.element";
import type * as ElementModule from "@/components/lumesec/px-jog.element";

/** The `<px-jog>` element, with its properties and methods. */
export type PxJogElement = ElementModule.Jog;

export type PxJogProps = LumesecElementProps<PxJogElement>;

/**
 * Jog wheel · `<px-jog>` · LumeSec Elements, Pixel Lab.
 * Pixel jog wheel that keeps spinning with inertia after release, driving a running timecode and a filmstrip that scrubs underneath.
 *
 * Demo data: The filmstrip footage and its length are generated; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/jog
 */
export function PxJog({ ...props }: PxJogProps) {
  return useLumesecElement("px-jog", props, {}, {});
}

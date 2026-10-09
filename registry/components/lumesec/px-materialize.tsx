"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-materialize.element";
import type * as ElementModule from "@/components/lumesec/px-materialize.element";

/** The `<px-materialize>` element, with its properties and methods. */
export type PxMaterializeElement = ElementModule.Materialize;

export interface PxMaterializeProps extends Omit<LumesecElementProps<PxMaterializeElement>, "text" | "onDone"> {
  /** The text to stream; runs of whitespace count as one space. Changing it replays the stream with the new text, as do Replay, `restart()`, a width change and the fonts finishing loading. Default: `Ultracode runs at xhigh effort and lets the agent plan multi-agent workflows on its own, so big tasks fan out across parallel agents.`. */
  text?: string;
  /** Fires once every word has settled into text. */
  onDone?: (event: ElementModule.MaterializeEventMap["done"]) => void;
}

/**
 * Materializing stream · `<px-materialize>` · LumeSec Elements, Pixel Lab.
 * Streams a sentence word by word, each word condensing from particles sampled from its own glyphs before resolving into crisp text.
 *
 * Data: Pass your sentence as `text`. Without it a sample sentence streams.
 * @see https://elements.lumesec.ai/components/pixel-lab/materialize
 */
export function PxMaterialize({ text, onDone, ...props }: PxMaterializeProps) {
  return useLumesecElement("px-materialize", props, { text: text }, { done: onDone });
}

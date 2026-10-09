"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-splitflap.element";
import type * as ElementModule from "@/components/lumesec/px-splitflap.element";

/** The `<px-splitflap>` element, with its properties and methods. */
export type PxSplitflapElement = ElementModule.SplitFlap;

export interface PxSplitflapProps extends Omit<LumesecElementProps<PxSplitflapElement>, "messages"> {
  /** Messages separated by `|`; empty entries are skipped. Changing it starts the board over at the first new message. Default: `LARGE · ULTRACODE|CONTEXT 64% · OK|4 AGENTS RUNNING|DEPLOY 14:02 LIVE|SPEED 182 TOK/S`. */
  messages?: string;
}

/**
 * Split-flap board · `<px-splitflap>` · LumeSec Elements, Pixel Lab.
 * Split-flap departure board whose tiles flip through the alphabet and cascade left to right on each new message.
 *
 * Data: Pass your messages in `messages` or call `show()`. Without them the board cycles demo messages.
 * @see https://elements.lumesec.ai/components/pixel-lab/splitflap
 */
export function PxSplitflap({ messages, ...props }: PxSplitflapProps) {
  return useLumesecElement("px-splitflap", props, { messages: messages }, {});
}

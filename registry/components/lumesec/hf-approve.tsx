"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-approve.element";
import type * as ElementModule from "@/components/lumesec/hf-approve.element";

/** The `<hf-approve>` element, with its properties and methods. */
export type HfApproveElement = ElementModule.HApprove;

export interface HfApproveProps extends Omit<LumesecElementProps<HfApproveElement>, "onDecision"> {
  /** Fires when a choice is made by click or by keys 1 to 3. `command` is the full command text of the current request. */
  onDecision?: (event: ElementModule.HApproveEventMap["decision"]) => void;
}

/**
 * Permission prompt · `<hf-approve>` · LumeSec Elements, Pixel HD.
 * Agent permission prompt: a scan runs over the command, a risk meter fills, and Allow once, Always allow or Deny settles it.
 *
 * Demo data: It starts on, and its Next request button cycles through, four built-in demo requests; `request()` shows your own. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/approve
 */
export function HfApprove({ onDecision, ...props }: HfApproveProps) {
  return useLumesecElement(
    "hf-approve",
    props,
    {},
    { "decision": onDecision },
  );
}

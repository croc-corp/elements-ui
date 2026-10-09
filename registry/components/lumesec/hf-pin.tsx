"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-pin.element";
import type * as ElementModule from "@/components/lumesec/hf-pin.element";

/** The `<hf-pin>` element, with its properties and methods. */
export type HfPinElement = ElementModule.HPin;

export interface HfPinProps extends Omit<LumesecElementProps<HfPinElement>, "code" | "label" | "hint" | "success" | "onUnlock" | "onError"> {
  /** The expected PIN. Its length sets the number of dots. Compared in the browser. Default: `2468`. */
  code?: string;
  /** Title above the dots. Read once on connect. Default: `Enter your PIN`. */
  label?: string;
  /** Status text under the title. Defaults to `<n> digits`, where `<n>` is the length of `code`. */
  hint?: string;
  /** Status text after a correct PIN. Default: `Unlocked`. */
  success?: string;
  /** Fires when the entered digits match `code`. */
  onUnlock?: (event: ElementModule.HPinEventMap["unlock"]) => void;
  /** Fires on a wrong PIN. `tries` is the number of attempts left: 2, 1, then 0. Does not bubble and is not composed: listen on the element itself, as the React `onError` prop does. */
  onError?: (event: ElementModule.HPinEventMap["error"]) => void;
}

/**
 * PIN pad · `<hf-pin>` · LumeSec Elements, Pixel HD.
 * Numeric PIN pad with rippling keys and dot feedback: a wrong code shakes into red static, the right one sends a green wave.
 * @see https://elements.lumesec.ai/components/pixel-hd/pin
 */
export function HfPin({ code, label, hint, success, onUnlock, onError, ...props }: HfPinProps) {
  return useLumesecElement(
    "hf-pin",
    props,
    { "code": code, "label": label, "hint": hint, "success": success },
    { "unlock": onUnlock, "error": onError },
  );
}

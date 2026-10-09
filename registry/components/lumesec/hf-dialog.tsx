"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-dialog.element";
import type * as ElementModule from "@/components/lumesec/hf-dialog.element";

/** The `<hf-dialog>` element, with its properties and methods. */
export type HfDialogElement = ElementModule.HDialog;

export interface HfDialogProps extends Omit<LumesecElementProps<HfDialogElement>, "label" | "heading" | "description" | "onOpen" | "onClose"> {
  /** Text of the trigger button. Observed. Default: `Invite teammates`. */
  label?: string;
  /** Dialog title, which also labels the dialog. Observed. Default: `Invite teammates`. */
  heading?: string;
  /** Text under the title, which also describes the dialog. Observed. Default: `They’ll get an email with a link to join the workspace.`. */
  description?: string;
  /** Fires when the dialog opens. */
  onOpen?: (event: ElementModule.HDialogEventMap["open"]) => void;
  /** Fires after the dialog closes. `returnValue` is `send` with the form's `emails` and `role`, `cancel` for Cancel, Escape or a backdrop click, an empty string for the close button, or the argument passed to `hide()`; it is `undefined` when `hide()` is called without one. */
  onClose?: (event: ElementModule.HDialogEventMap["close"]) => void;
}

/**
 * Dialog · `<hf-dialog>` · LumeSec Elements, Pixel HD.
 * Modal invite dialog on the native dialog element: focus is trapped, Escape closes it, and pixels fly from the trigger to build the panel.
 * @see https://elements.lumesec.ai/components/pixel-hd/dialog
 */
export function HfDialog({ label, heading, description, onOpen, onClose, ...props }: HfDialogProps) {
  return useLumesecElement(
    "hf-dialog",
    props,
    { "label": label, "heading": heading, "description": description },
    { "open": onOpen, "close": onClose },
  );
}

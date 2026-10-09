"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-dropzone.element";
import type * as ElementModule from "@/components/lumesec/hf-dropzone.element";

/** The `<hf-dropzone>` element, with its properties and methods. */
export type HfDropzoneElement = ElementModule.HDropzone;

export interface HfDropzoneProps extends Omit<LumesecElementProps<HfDropzoneElement>, "onFiles" | "onUploaded"> {
  /** Fires once per drop or file-picker selection that contains files, with every selected file. */
  onFiles?: (event: ElementModule.HDropzoneEventMap["files"]) => void;
  /** Fires per file when its simulated progress reaches 100%. `size` is in bytes. Not fired for files over 25 MB. */
  onUploaded?: (event: ElementModule.HDropzoneEventMap["uploaded"]) => void;
}

/**
 * Drop zone · `<hf-dropzone>` · LumeSec Elements, Pixel HD.
 * File drop zone drawn as a ripple simulation; dropped or picked files are listed with a simulated dotted progress bar.
 *
 * Demo data: Upload progress is simulated on a timer; only the file names and sizes come from the files the user drops. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/dropzone
 */
export function HfDropzone({ onFiles, onUploaded, ...props }: HfDropzoneProps) {
  return useLumesecElement("hf-dropzone", props, {}, { files: onFiles, uploaded: onUploaded });
}

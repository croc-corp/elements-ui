"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-upload.element";
import type * as ElementModule from "@/components/lumesec/px-upload.element";

/** The `<px-upload>` element, with its properties and methods. */
export type PxUploadElement = ElementModule.Upload;

export interface PxUploadProps extends Omit<LumesecElementProps<PxUploadElement>, "limitMb" | "onError" | "onUploaded"> {
  /** Size limit in megabytes (1 MB = 1,000,000 bytes); a missing, invalid or non-positive value uses 30. Read each time a file is started. Default: `30`. */
  limitMb?: number;
  /** Fires when a file is over the limit. `size` is in bytes. Does not bubble, so it never reaches the window's global `error` handlers; listen on the element. */
  onError?: (event: ElementModule.UploadEventMap["error"]) => void;
  /** Fires when the simulated upload completes. `size` is in bytes. */
  onUploaded?: (event: ElementModule.UploadEventMap["uploaded"]) => void;
}

/**
 * Pixel upload · `<px-upload>` · LumeSec Elements, Pixel Lab.
 * Upload drop zone where the file icon dissolves pixel by pixel into the progress bar, which regroups into a check; oversized files shake red.
 *
 * Demo data: Nothing is uploaded and the progress is simulated; the file name and size come from the chosen file and `limit-mb` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/upload
 */
export function PxUpload({ limitMb, onError, onUploaded, ...props }: PxUploadProps) {
  return useLumesecElement(
    "px-upload",
    props,
    { "limit-mb": limitMb },
    { "error": onError, "uploaded": onUploaded },
  );
}

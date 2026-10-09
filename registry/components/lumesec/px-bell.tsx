"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-bell.element";
import type * as ElementModule from "@/components/lumesec/px-bell.element";

/** The `<px-bell>` element, with its properties and methods. */
export type PxBellElement = ElementModule.Bell;

export interface PxBellProps extends Omit<LumesecElementProps<PxBellElement>, "count" | "onNotify" | "onRead"> {
  /** Unread count, rounded to a whole number of at least 0. Changing it updates the count without ringing the bell. Default: `2`. */
  count?: number;
  /** Fires on each new notification with the new unread count. */
  onNotify?: (event: ElementModule.BellEventMap["notify"]) => void;
  /** Fires when everything is marked as read, from a click on the bell or from `clearAll()`. */
  onRead?: (event: ElementModule.BellEventMap["read"]) => void;
}

/**
 * Notification bell · `<px-bell>` · LumeSec Elements, Pixel Lab.
 * Pixel notification bell that swings with a lagging clapper and pops its badge on new items; clicking it clears the badge in a spray of pixels.
 *
 * Data: Pass the unread count as `count` and call `notify()` or `clearAll()`. Without it the bell starts at 2 unread.
 * @see https://elements.lumesec.ai/components/pixel-lab/bell
 */
export function PxBell({ count, onNotify, onRead, ...props }: PxBellProps) {
  return useLumesecElement(
    "px-bell",
    props,
    { "count": count },
    { "notify": onNotify, "read": onRead },
  );
}

"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-launch.element";
import type * as ElementModule from "@/components/lumesec/px-launch.element";

/** The `<px-launch>` element, with its properties and methods. */
export type PxLaunchElement = ElementModule.Launch;

export interface PxLaunchProps extends Omit<
  LumesecElementProps<PxLaunchElement>,
  "version" | "onLiftoff" | "onLaunched"
> {
  /** Version shown in the "Launched · <version> is live" status. Read when the rocket leaves the frame. Default: `v2.14`. */
  version?: string;
  /** Fires when the countdown reaches zero and the rocket lifts off. */
  onLiftoff?: (event: ElementModule.LaunchEventMap["liftoff"]) => void;
  /** Fires when the rocket has left the frame. */
  onLaunched?: (event: ElementModule.LaunchEventMap["launched"]) => void;
}

/**
 * Release rocket · `<px-launch>` · LumeSec Elements, Pixel Lab.
 * Release animation with a pixel rocket: a three-second countdown, smoke on the pad, then liftoff while the stars streak past.
 *
 * Demo data: The countdown and the live state run on a timer, not on your release; only `version` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/launch
 */
export function PxLaunch({ version, onLiftoff, onLaunched, ...props }: PxLaunchProps) {
  return useLumesecElement("px-launch", props, { version: version }, { liftoff: onLiftoff, launched: onLaunched });
}

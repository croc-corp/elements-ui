"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-deploy.element";
import type * as ElementModule from "@/components/lumesec/px-deploy.element";

/** The `<px-deploy>` element, with its properties and methods. */
export type PxDeployElement = ElementModule.Deploy;

export interface PxDeployProps extends Omit<LumesecElementProps<PxDeployElement>, "version" | "onDeploy" | "onLive"> {
  /** Version shown in the "Live · <version>" label. Read when the deploy goes live. Default: `v2.14.0`. */
  version?: string;
  /** Fires when the slide is committed and the deploy sequence starts. */
  onDeploy?: (event: ElementModule.DeployEventMap["deploy"]) => void;
  /** Fires 1.6 seconds after `deploy`, when the label switches to Live. */
  onLive?: (event: ElementModule.DeployEventMap["live"]) => void;
}

/**
 * Slide to deploy · `<px-deploy>` · LumeSec Elements, Pixel Lab.
 * Slide-to-deploy control whose pixel trail heats up as you drag; releasing past 90% bursts, runs a deploy scan and shows Live.
 *
 * Demo data: The deploy run and the Live state are simulated on a timer, not on your deploy; only `version` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/deploy
 */
export function PxDeploy({ version, onDeploy, onLive, ...props }: PxDeployProps) {
  return useLumesecElement(
    "px-deploy",
    props,
    { "version": version },
    { "deploy": onDeploy, "live": onLive },
  );
}

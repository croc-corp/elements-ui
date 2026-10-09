"use client";

import * as React from "react";

import { PxRing } from "@/components/lumesec/px-ring";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxRingDemo() {
  const [usage, setUsage] = React.useState(72);

  return (
    <div className="grid w-full max-w-[380px] gap-[14px]">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <PxRing value={usage}>Weekly usage</PxRing>
        <PxRing size={84}>Syncing</PxRing>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        <button type="button" className={controlButton} onClick={() => setUsage((value) => Math.min(100, value + 10))}>
          +10%
        </button>
        <button type="button" className={controlButton} onClick={() => setUsage(0)}>
          Reset
        </button>
      </div>
    </div>
  );
}

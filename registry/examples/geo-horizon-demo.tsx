"use client";

import * as React from "react";

import { GeoHorizon } from "@/components/lumesec/geo-horizon";

export default function GeoHorizonDemo() {
  const titleId = React.useId();
  return (
    <GeoHorizon aria-labelledby={titleId} capHeight={0.4} className="h-[420px] w-full rounded-[14px] border border-border">
      <p className="m-0 flex items-center gap-2 font-mono text-[11px] leading-4 tracking-[0.14em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="size-1.5 rounded-[1px] bg-lumesec" />
        Global network
      </p>
      <h2
        id={titleId}
        className="m-0 max-w-[680px] text-[23px] leading-[1.15] font-semibold tracking-[-0.022em] text-balance text-foreground sm:text-[29px]"
      >
        Requests between 12 regions, traced end to end
      </h2>
      <p className="m-0 max-w-[520px] text-[14px] leading-[1.5] text-pretty text-muted-foreground">
        From the edge that receives a request to the region that answers it.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="h-[34px] cursor-pointer rounded-lg border border-foreground bg-foreground px-3.5 font-[inherit] text-[13px] font-medium text-background outline-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
        >
          View regions
        </button>
        <button
          type="button"
          className="h-[34px] cursor-pointer rounded-lg border border-border bg-card px-3.5 font-[inherit] text-[13px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
        >
          Read the docs
        </button>
      </div>
    </GeoHorizon>
  );
}

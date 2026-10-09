"use client";

import * as React from "react";

import { GeoAccess, type GeoAccessHandle } from "@/components/lumesec/geo-access";

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoAccessDemo() {
  const access = React.useRef<GeoAccessHandle>(null);
  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoAccess ref={access} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => access.current?.replay()} className={BUTTON}>
          Replay
        </button>
      </div>
    </div>
  );
}

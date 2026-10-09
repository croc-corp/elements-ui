"use client";

import * as React from "react";

import { UiContextMeter, type UiContextMeterHandle } from "@/components/lumesec/ui-context-meter";

const ACTION =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function UiContextMeterDemo() {
  const meter = React.useRef<UiContextMeterHandle>(null);
  return (
    <div className="grid w-full max-w-[400px] gap-4">
      <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
        <UiContextMeter ref={meter} defaultValue={46} capacity={200000} />
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        <button type="button" className={ACTION} onClick={() => meter.current?.add(14)}>
          Add a file (+14 %)
        </button>
        <button type="button" className={ACTION} onClick={() => meter.current?.compact()}>
          Compact
        </button>
      </div>
    </div>
  );
}

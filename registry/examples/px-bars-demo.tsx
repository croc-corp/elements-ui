"use client";

import * as React from "react";

import { PxBars, type PxBarsDatum } from "@/components/lumesec/px-bars";

const WEEKS: Record<"week" | "last", PxBarsDatum[]> = {
  week: [
    { label: "Mon", value: 12 },
    { label: "Tue", value: 18 },
    { label: "Wed", value: 9 },
    { label: "Thu", value: 22 },
    { label: "Fri", value: 17 },
    { label: "Sat", value: 6 },
    { label: "Sun", value: 4 },
  ],
  last: [
    { label: "Mon", value: 8 },
    { label: "Tue", value: 11 },
    { label: "Wed", value: 15 },
    { label: "Thu", value: 13 },
    { label: "Fri", value: 20 },
    { label: "Sat", value: 9 },
    { label: "Sun", value: 3 },
  ],
};

const BUTTON =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxBarsDemo() {
  const [week, setWeek] = React.useState<"week" | "last">("week");
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <div className="grid w-[min(380px,100%)] gap-3.5">
        <PxBars data={WEEKS[week]} unit="runs" label="Runs per day" />
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" aria-pressed={week === "week"} className={BUTTON} onClick={() => setWeek("week")}>
            This week
          </button>
          <button type="button" aria-pressed={week === "last"} className={BUTTON} onClick={() => setWeek("last")}>
            Last week
          </button>
        </div>
      </div>
    </div>
  );
}

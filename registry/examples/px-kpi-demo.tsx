"use client";

import * as React from "react";

import { PxKpi } from "@/components/lumesec/px-kpi";

interface Metric {
  value: number;
  data: number[];
}

const BUTTON =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

/** Moves a metric by a random factor and appends it to the history, which keeps its length. */
function drift(metric: Metric, low: number, spread: number, scale: number): Metric {
  const value = Math.round(metric.value * (low + Math.random() * spread));
  return { value, data: [...metric.data.slice(1), Math.round(value / scale)] };
}

export default function PxKpiDemo() {
  const [revenue, setRevenue] = React.useState<Metric>({ value: 48210, data: [30, 32, 31, 35, 38, 36, 40, 44, 43, 48] });
  const [latency, setLatency] = React.useState<Metric>({ value: 182, data: [230, 226, 214, 220, 207, 201, 196, 190, 186, 182] });

  const refresh = () => {
    setRevenue(drift(revenue, 0.94, 0.14, 1000));
    setLatency(drift(latency, 0.9, 0.18, 1));
  };

  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <div className="grid w-[min(380px,100%)] gap-3.5">
        <PxKpi
          label="Revenue this month"
          value={revenue.value}
          previous={42900}
          format="currency"
          data={revenue.data}
          note="vs. last month"
        />
        <PxKpi label="p95 latency" value={latency.value} previous={207} format="ms" invert data={latency.data} />
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" className={BUTTON} onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

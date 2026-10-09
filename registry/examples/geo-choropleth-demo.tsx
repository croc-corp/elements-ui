"use client";

import * as React from "react";

import { GeoChoropleth, type CountryValue } from "@/components/lumesec/geo-choropleth";

/** Invented requests per day. */
const REQUESTS: readonly CountryValue[] = [
  { code: "US", value: 412000 },
  { code: "IN", value: 268000 },
  { code: "DE", value: 168000 },
  { code: "GB", value: 142000 },
  { code: "BR", value: 131000 },
  { code: "JP", value: 118000 },
  { code: "FR", value: 96000 },
  { code: "CA", value: 88000 },
  { code: "KR", value: 64000 },
  { code: "AU", value: 57000 },
  { code: "NL", value: 52000 },
  { code: "ID", value: 47000 },
  { code: "MX", value: 44000 },
  { code: "ES", value: 41000 },
  { code: "IT", value: 39000 },
  { code: "CN", value: 33000 },
  { code: "PL", value: 31000 },
  { code: "SE", value: 28000 },
  { code: "TR", value: 26000 },
  { code: "VN", value: 24000 },
  { code: "PH", value: 21000 },
  { code: "NG", value: 19000 },
  { code: "ZA", value: 17000 },
  { code: "AR", value: 16000 },
  { code: "SA", value: 15000 },
  { code: "AE", value: 14000 },
  { code: "EG", value: 12000 },
  { code: "CO", value: 11000 },
  { code: "TH", value: 10500 },
  { code: "UA", value: 9800 },
  { code: "IL", value: 9400 },
  { code: "NO", value: 8700 },
  { code: "FI", value: 7600 },
  { code: "CL", value: 7100 },
  { code: "PK", value: 6800 },
  { code: "KE", value: 5200 },
  { code: "MA", value: 4300 },
  { code: "PE", value: 3900 },
  { code: "KZ", value: 3100 },
  { code: "NZ", value: 2900 },
  { code: "RU", value: 2400 },
];

/** Invented sign-ups per week, for the same countries. */
const SIGN_UPS: readonly CountryValue[] = [
  { code: "IN", value: 9400 },
  { code: "US", value: 8200 },
  { code: "BR", value: 6100 },
  { code: "ID", value: 4800 },
  { code: "NG", value: 3900 },
  { code: "PH", value: 3100 },
  { code: "MX", value: 2900 },
  { code: "VN", value: 2600 },
  { code: "DE", value: 2300 },
  { code: "GB", value: 2100 },
  { code: "PK", value: 1900 },
  { code: "EG", value: 1800 },
  { code: "TR", value: 1600 },
  { code: "FR", value: 1500 },
  { code: "KE", value: 1350 },
  { code: "CO", value: 1250 },
  { code: "JP", value: 1200 },
  { code: "AR", value: 1100 },
  { code: "ZA", value: 1050 },
  { code: "TH", value: 980 },
  { code: "SA", value: 900 },
  { code: "ES", value: 860 },
  { code: "MA", value: 790 },
  { code: "PE", value: 720 },
  { code: "IT", value: 680 },
  { code: "PL", value: 610 },
  { code: "CA", value: 560 },
  { code: "UA", value: 540 },
  { code: "CL", value: 480 },
  { code: "KR", value: 430 },
  { code: "AU", value: 400 },
  { code: "KZ", value: 360 },
  { code: "AE", value: 330 },
  { code: "NL", value: 300 },
  { code: "CN", value: 280 },
  { code: "SE", value: 240 },
  { code: "IL", value: 210 },
  { code: "RU", value: 190 },
  { code: "NO", value: 150 },
  { code: "FI", value: 130 },
  { code: "NZ", value: 110 },
];

const METRICS = {
  requests: { name: "Requests", label: "Requests per day by country", unit: "requests", data: REQUESTS },
  signups: { name: "Sign-ups", label: "Sign-ups per week by country", unit: "sign-ups", data: SIGN_UPS },
} as const;

type Metric = keyof typeof METRICS;

export default function GeoChoroplethDemo() {
  const [metric, setMetric] = React.useState<Metric>("requests");
  const current = METRICS[metric];
  return (
    <div className="w-full">
      <div className="mx-auto grid w-full max-w-[660px] gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Metric"
            className="inline-flex h-[30px] items-center rounded-lg border border-border bg-card p-[2px]"
          >
            {(Object.keys(METRICS) as Metric[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
                className="h-[24px] cursor-pointer rounded-md px-2.5 font-[inherit] text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid aria-pressed:bg-muted aria-pressed:text-foreground motion-reduce:transition-none"
              >
                {METRICS[key].name}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-muted-foreground">Demo data, {current.data.length} countries</span>
        </div>
        <GeoChoropleth data={current.data} unit={current.unit} label={current.label} />
      </div>
    </div>
  );
}

"use client";

import * as React from "react";

import { EffortSlider } from "@/components/lumesec/effort-slider";
import { UiContextMeter } from "@/components/lumesec/ui-context-meter";
import { UiToggle } from "@/components/lumesec/ui-toggle";
import { repaintElements, useNearViewport } from "@/components/preview/component-preview";
import { cn } from "@/lib/utils";

const SWATCHES = [
  { id: "electric", label: "Electric", light: "#6219f3", dark: "#8654fb" },
  { id: "teal", label: "Teal", light: "#0f766e", dark: "#2dd4bf" },
  { id: "amber", label: "Amber", light: "#b45309", dark: "#f59e0b" },
  { id: "graphite", label: "Graphite", light: "#27272a", dark: "#e4e4e7" },
];

/** Change one token, watch every component on the bench follow. */
export function ThemeDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const [pick, setPick] = React.useState(SWATCHES[0]);

  const apply = (s: (typeof SWATCHES)[number]) => {
    setPick(s);
    // after the new token has rendered, so the canvases read the new colour
    requestAnimationFrame(repaintElements);
  };

  const vars = { "--accent-light": pick.light, "--accent-dark": pick.dark } as React.CSSProperties;

  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-border bg-[var(--code-bg)]">
      <div
        className="flex items-center gap-1.5 border-b border-border px-3 py-2.5"
        role="group"
        aria-label="Accent colour"
      >
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={pick.id === s.id}
            onClick={() => apply(s)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
              pick.id === s.id
                ? "border-input bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full [background:var(--sw-l)] dark:[background:var(--sw-d)]"
              style={{ "--sw-l": s.light, "--sw-d": s.dark } as React.CSSProperties}
            />
            {s.label}
          </button>
        ))}
      </div>
      <pre className="px-4 pt-3 font-mono text-[12.5px] leading-[1.7] text-muted-foreground">
        <span className="text-foreground">:root</span> {"{"}
        {"\n"}
        {"  "}--lumesec: <span className="text-foreground transition-colors">{pick.light}</span>;{"\n"}
        {"}"}
      </pre>
      <div
        style={vars}
        className="grid min-h-[300px] gap-4 px-4 pt-3 pb-5 [--lumesec:var(--accent-light)] dark:[--lumesec:var(--accent-dark)]"
      >
        {near && (
          <>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <UiToggle defaultChecked>Extended thinking</UiToggle>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <UiContextMeter defaultValue={64} capacity={200000} />
            </div>
            <div className="grid place-items-center rounded-xl border border-border bg-background px-4 py-4">
              <EffortSlider defaultValue="ultracode" className="w-full max-w-[380px]" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

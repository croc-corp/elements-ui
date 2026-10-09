"use client";

import * as React from "react";

import { PxToaster, type PxToasterHandle } from "@/components/lumesec/px-toaster";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxToasterDemo() {
  const toaster = React.useRef<PxToasterHandle>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(
      () =>
        toaster.current?.show({
          title: "Changes saved",
          description: "Your settings are up to date.",
          type: "success",
          duration: 0,
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="grid w-full max-w-[380px] gap-[14px]">
      <PxToaster ref={toaster} />
      <div className="flex flex-wrap justify-center gap-1.5">
        <button
          type="button"
          className={controlButton}
          onClick={() =>
            toaster.current?.show({
              title: "Changes saved",
              description: "Your settings are up to date.",
              type: "success",
            })
          }
        >
          Saved
        </button>
        <button
          type="button"
          className={controlButton}
          onClick={() =>
            toaster.current?.show({
              title: "Upload failed",
              description: "report.pdf is over the 30 MB limit.",
              type: "error",
            })
          }
        >
          Failed
        </button>
        <button
          type="button"
          className={controlButton}
          onClick={() =>
            toaster.current?.show({
              title: "3 files deleted",
              type: "info",
              duration: 6000,
              action: {
                label: "Undo",
                onClick: () => toaster.current?.show({ title: "Files restored", type: "success" }),
              },
            })
          }
        >
          With undo
        </button>
      </div>
    </div>
  );
}

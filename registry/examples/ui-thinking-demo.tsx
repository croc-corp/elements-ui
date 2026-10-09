"use client";

import * as React from "react";

import { UiThinking, type UiThinkingHandle } from "@/components/lumesec/ui-thinking";

const ACTION =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function UiThinkingDemo() {
  const thinking = React.useRef<UiThinkingHandle>(null);

  // the model "finishes" on its own after 6.4 s
  React.useEffect(() => {
    const timer = window.setTimeout(() => thinking.current?.finish(), 6400);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="grid w-full max-w-[400px] gap-4">
      <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
        <UiThinking ref={thinking}>
          Effort levels change how long the model reasons. Ultracode is different: it sends xhigh and lets the model
          plan multi-agent workflows on its own, so the slider should give it its own state rather than another grey
          step.
        </UiThinking>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        <button type="button" className={ACTION} onClick={() => thinking.current?.finish()}>
          Finish
        </button>
        <button type="button" className={ACTION} onClick={() => thinking.current?.restart()}>
          Restart
        </button>
      </div>
    </div>
  );
}

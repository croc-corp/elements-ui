"use client";

import * as React from "react";

import { UiToastStack, type UiToastStackHandle } from "@/components/lumesec/ui-toast-stack";

export default function UiToastStackDemo() {
  const toasts = React.useRef<UiToastStackHandle>(null);

  // two sample toasts arrive shortly after the demo mounts
  React.useEffect(() => {
    const first = window.setTimeout(() => toasts.current?.show(), 500);
    const second = window.setTimeout(() => toasts.current?.show(), 900);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, []);

  return <UiToastStack ref={toasts} className="w-full max-w-[660px]" />;
}

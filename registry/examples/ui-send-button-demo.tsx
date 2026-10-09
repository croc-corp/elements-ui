import { UiSendButton } from "@/components/lumesec/ui-send-button";

export default function UiSendButtonDemo() {
  return (
    <div className="flex w-full max-w-[380px] items-center gap-2.5 rounded-2xl border border-border bg-card py-2 pr-2 pl-4 text-muted-foreground shadow-[0_12px_30px_-18px_rgb(0_0_0/0.35)]">
      <span className="min-w-0 flex-1 text-[14.5px]">Ask anything…</span>
      <UiSendButton demoDuration={3} />
    </div>
  );
}

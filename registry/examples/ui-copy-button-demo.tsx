import { UiCopyButton } from "@/components/lumesec/ui-copy-button";

// short enough to fit next to the button in a gallery card without an ellipsis
const COMMAND = "npx shadcn add @lumesec/ui-copy-button";

export default function UiCopyButtonDemo() {
  return (
    <div className="flex w-full max-w-[480px] items-center gap-3 rounded-xl border border-border bg-card py-2 pr-2 pl-3.5">
      <code className="min-w-0 overflow-hidden font-mono text-[13px] text-ellipsis whitespace-nowrap text-foreground">
        {COMMAND}
      </code>
      <UiCopyButton text={COMMAND} />
    </div>
  );
}

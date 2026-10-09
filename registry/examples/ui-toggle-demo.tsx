import { UiToggle } from "@/components/lumesec/ui-toggle";

export default function UiToggleDemo() {
  return (
    <div className="grid w-full max-w-[400px] gap-4 rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <UiToggle defaultChecked hint="Think longer before answering">
        Extended thinking
      </UiToggle>
      <hr className="m-0 border-0 border-t border-border" />
      <UiToggle hint="Look up current information">Web search</UiToggle>
    </div>
  );
}

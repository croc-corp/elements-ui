import { UiDial } from "@/components/lumesec/ui-dial";

export default function UiDialDemo() {
  return (
    <div className="grid w-full max-w-[380px] justify-items-center">
      <UiDial defaultValue={0.7} min={0} max={1} step={0.1} label="Temperature" />
    </div>
  );
}

import { UiOdometer } from "@/components/lumesec/ui-odometer";

export default function UiOdometerDemo() {
  return (
    <div className="grid w-full max-w-[380px] justify-items-center">
      <UiOdometer defaultValue={8192} min={1024} max={65536} step={1024} />
    </div>
  );
}

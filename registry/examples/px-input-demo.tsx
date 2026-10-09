import { PxInput } from "@/components/lumesec/px-input";

export default function PxInputDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxInput
        name="email"
        label="Work email"
        type="email"
        required
        placeholder="you@example.com"
        hint="We’ll send the invite here"
        error="Enter a valid email address"
      />
    </div>
  );
}

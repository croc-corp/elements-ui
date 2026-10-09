import { PxPassword } from "@/components/lumesec/px-password";

export default function PxPasswordDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxPassword name="password" label="New password" minScore={3} />
    </div>
  );
}

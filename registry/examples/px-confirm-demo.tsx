import { PxConfirm } from "@/components/lumesec/px-confirm";

export default function PxConfirmDemo() {
  return (
    <PxConfirm timeout={3} doneText="Project deleted">
      Delete project
    </PxConfirm>
  );
}

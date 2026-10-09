import { PxCommand, type PxCommandItem } from "@/components/lumesec/px-command";

const COMMANDS: PxCommandItem[] = [
  { group: "Actions", label: "New chat", shortcut: "N" },
  { group: "Actions", label: "New project", shortcut: "P" },
  { group: "Actions", label: "Upload a file", shortcut: "U" },
  { group: "Actions", label: "Invite a teammate", shortcut: "I" },
  { group: "Go to", label: "Projects", shortcut: "G P" },
  { group: "Go to", label: "Usage and billing", shortcut: "G B" },
  { group: "Go to", label: "Settings", shortcut: "G S" },
  { group: "Go to", label: "Connectors", shortcut: "G C" },
  { group: "Preferences", label: "Toggle dark mode", shortcut: "⇧ D" },
  { group: "Preferences", label: "Keyboard shortcuts", shortcut: "?" },
];

export default function PxCommandDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxCommand hotkey items={COMMANDS} />
    </div>
  );
}

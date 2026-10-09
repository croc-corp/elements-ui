import { PxAccordion } from "@/components/lumesec/px-accordion";

export default function PxAccordionDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxAccordion
        defaultValue={["What is Ultracode?"]}
        items={[
          {
            title: "What is Ultracode?",
            content: "A mode that sends xhigh effort and lets the agent plan multi-agent workflows on its own.",
          },
          { title: "How is usage counted?", content: "Usage resets weekly. Longer reasoning and more agents use more of it." },
          { title: "Can I export my data?", content: "Yes. Settings has an export that includes chats, projects and files." },
        ]}
      />
    </div>
  );
}

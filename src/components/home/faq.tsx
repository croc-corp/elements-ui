import { ChevronDownIcon } from "@/components/icons";
import { pad2 } from "@/lib/utils";

/** The landing page questions; also published as FAQPage JSON-LD. */
export const HOME_FAQ = [
  {
    q: "Is LumeSec Elements free?",
    a: "Yes. Every component is free under the MIT license, including for commercial products, and the source is on GitHub.",
  },
  {
    q: "Do I need React or Tailwind CSS?",
    a: "For Interaction, Pixel UI and Location, yes: they are native React 19 components styled with Tailwind CSS v4, like shadcn/ui. Pixel Lab and Pixel HD are typed custom elements that style themselves inside a shadow root, so they also run in plain HTML, Vue, Svelte or Angular, and ship with a typed React wrapper.",
  },
  {
    q: "How do I install a component?",
    a: "With the shadcn CLI: register the @lumesec registry once, then run npx shadcn@latest add @lumesec/<name>. The TypeScript source lands in your repository, with shared modules installed once.",
  },
  {
    q: "Can the components match my theme?",
    a: "Yes. Every component reads your shadcn theme variables (--background, --card, --foreground, --border…) plus one set of --lumesec accent tokens, so your colours, fonts and dark mode apply to all of them.",
  },
  {
    q: "Do they work with server rendering?",
    a: "Yes. The React components render their full markup on the server and draw their canvas layers after hydration. The custom elements do not touch the DOM when imported on the server and upgrade in the browser. Both can be imported from Next.js server components.",
  },
  {
    q: "Who makes LumeSec Elements?",
    a: "LumeSec Technologies GmbH, the company behind SecureGrid and the AI Operating Platform. Elements is where its design team publishes the components it builds for those products.",
  },
];

/** Accordion on native details/summary: works without JavaScript, animates where supported. */
export function Faq() {
  return (
    <div className="divide-y divide-line border-t border-line">
      {HOME_FAQ.map((f, i) => (
        <details key={f.q} className="group/faq faq-item" name="home-faq" open={i === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-6 px-4 py-6 transition-colors hover:bg-surface/50 sm:px-8 [&::-webkit-details-marker]:hidden">
            <span className="tabular w-6 shrink-0 font-mono text-[12px] text-muted-foreground">{pad2(i + 1)}</span>
            <span className="flex-1 text-[18px] font-medium tracking-[-0.01em] sm:text-[20px]">{f.q}</span>
            <ChevronDownIcon size={16} className="shrink-0 text-muted-foreground transition-transform duration-500 ease-[var(--ease-expo)] group-open/faq:rotate-180" />
          </summary>
          <p className="max-w-[70ch] px-4 pb-7 pl-16 text-[15.5px] leading-[1.75] text-muted-foreground sm:px-8 sm:pl-20">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

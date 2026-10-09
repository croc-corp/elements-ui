import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code/code-block";
import { CodeTabs } from "@/components/code/code-tabs";
import { ProductCard } from "@/components/docs/product-card";
import { Bench } from "@/components/home/bench";
import { Faq, HOME_FAQ } from "@/components/home/faq";
import { InstallChip } from "@/components/home/install-chip";
import { CountUp, Reveal, RiseText } from "@/components/home/motion";
import { type Principle, Principles } from "@/components/home/principles";
import { TerminalDemo } from "@/components/home/terminal";
import { ThemeDemo } from "@/components/home/theme-demo";
import { ArrowRightIcon, CollectionGlyph } from "@/components/icons";
import { ComponentCard } from "@/components/preview/component-card";
import { ComponentPreview } from "@/components/preview/component-preview";
import { products, site } from "@/config/site";
import { collections, elementHref, getElement, newest, signatureOf, totalComponents } from "@/lib/catalog";
import { faqJsonLd, JsonLd } from "@/lib/seo";
import { countWord, pad2 } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: site.title },
  description: site.description,
  alternates: { canonical: "/" },
};

function SectionHead({
  n,
  eyebrow,
  title,
  lede,
  action,
}: {
  n: number;
  eyebrow: string;
  title: React.ReactNode;
  lede?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sl-rule px-4 pt-12 pb-10 sm:px-8 sm:pt-16">
      <p className="sl-eyebrow reveal">
        <span className="tabular text-foreground">{pad2(n)}</span>
        <span data-sep />
        <span>{eyebrow}</span>
      </p>
      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h2
            className="reveal text-[34px] leading-[1.05] font-medium tracking-[-0.035em] sm:text-[52px]"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            {title}
          </h2>
          {lede && (
            <p
              className="reveal mt-5 max-w-2xl text-[17px] leading-7 text-muted-foreground"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              {lede}
            </p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}

const STRIP = [
  {
    k: "components",
    v: totalComponents,
    label: "Components",
    note: `${countWord(collections.length)} collections // all live`,
  },
  { k: "cli", v: null, label: "One command", note: "shadcn add // you own the source" },
  { k: "fw", v: null, label: "TypeScript", note: "React components // typed custom elements" },
  { k: "a11y", v: null, label: "Accessible", note: "keyboard // ARIA // reduced motion" },
];

/** A component the landing page shows by tag; a missing one fails the build rather than the page. */
function element(tag: string) {
  const e = getElement(tag);
  if (!e) throw new Error(`The landing page shows <${tag}>, which is not in the catalog.`);
  return e;
}

export default function HomePage() {
  const principle = (tag: string, title: string, body: string): Principle => {
    const e = element(tag);
    return {
      tag,
      title,
      body,
      html: e.stage,
      layout: e.layout === "wide" ? "fill" : e.layout,
      href: elementHref(e),
      name: e.title,
    };
  };
  const principles = [
    principle(
      "effort-slider",
      "Plain until earned.",
      "Every level is an ordinary slider stop. Only the last one, Ultracode, grows a pixel trail, and only once the thumb arrives there.",
    ),
    principle(
      "ui-context-meter",
      "Growth has a direction.",
      "Effects start at an origin and travel one way, with an uneven front. Compaction sweeps back the other way, so the direction itself carries meaning.",
    ),
    principle(
      "ui-send-button",
      "Bursts reach past the edge.",
      "When a reply completes, the ring closes and sparks fly past the button's bounds on their own layer. A small sparkle inside the box would not register.",
    ),
    principle(
      "ui-odometer",
      "Numbers are mechanical.",
      "Counters roll digit by digit in tabular figures, in the direction of the change, so the width never jumps and the change is legible.",
    ),
    principle(
      "hf-stat",
      "Legibility beats pixels.",
      "Numbers and words are set in a regular font. The dot field glows and reacts around the value instead of forming it, so every figure stays readable and available to assistive technology.",
    ),
    principle(
      "hf-area",
      "The data leads.",
      "Charts move when the data changes, not for decoration: a new range morphs out of the old curve, and the header rolls to the value under the pointer.",
    ),
  ];
  const fresh = newest(8);
  const gauge = element("hf-gauge");

  const frameworks = [
    {
      value: "react",
      label: "React",
      code: `import { HfGauge } from "@/components/lumesec/hf-gauge";\n\nexport function Load({ value }: { value: number }) {\n  return <HfGauge value={value} label="Rate limit" zones="60,85" />;\n}`,
      lang: "tsx",
    },
    {
      value: "html",
      label: "HTML",
      code: `<script type="module" src="${site.url}/cdn/hf-gauge.js"></script>\n\n<hf-gauge value="72" label="Rate limit" zones="60,85"></hf-gauge>`,
      lang: "html",
    },
    {
      value: "vue",
      label: "Vue",
      code: `<script setup lang="ts">\nimport "@/components/lumesec/hf-gauge.element";\nconst value = ref(72);\n</script>\n\n<template>\n  <hf-gauge :value="value" label="Rate limit" zones="60,85" />\n</template>`,
      lang: "vue",
    },
    {
      value: "svelte",
      label: "Svelte",
      code: `<script lang="ts">\n  import "$lib/lumesec/hf-gauge.element";\n  let value = $state(72);\n</script>\n\n<hf-gauge {value} label="Rate limit" zones="60,85"></hf-gauge>`,
      lang: "svelte",
    },
  ];

  return (
    <div className="sl-page">
      <JsonLd data={faqJsonLd(HOME_FAQ)} />

      {/* Hero */}
      <section className="sl-panel sl-open-top" aria-labelledby="hero-title">
        <div className="px-4 pt-14 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
          <p className="sl-eyebrow page-enter">
            <span className="text-foreground">LumeSec Elements</span>
            <span data-sep />
            <span className="tabular">{totalComponents} components</span>
            <span data-sep />
            <span>shadcn registry</span>
            <span data-sep className="hidden sm:block" />
            <span className="hidden sm:inline">MIT</span>
          </p>
          <h1
            id="hero-title"
            className="mt-6 text-[clamp(46px,9.4vw,128px)] leading-[0.92] font-medium tracking-[-0.055em]"
          >
            <RiseText text="Built in the lab." />
            <br />
            <RiseText text="Shipped to your repo." offset={4} className="text-muted-foreground" />
          </h1>
          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
            <p className="page-enter max-w-[46rem] text-[18px] leading-[1.75] text-muted-foreground sm:text-[20px]">
              <span className="text-foreground">Interactive components</span> from the LumeSec design lab: controls,
              meters, charts and dot-matrix displays. <span className="text-foreground">Install one</span> with the
              shadcn CLI, read every line of it, and theme it with <span className="text-foreground">your tokens</span>.
            </p>
            <div className="page-enter grid gap-3">
              <InstallChip item="effort-slider" />
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/components"
                  className="group/b inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[.98]"
                >
                  Browse components
                  <ArrowRightIcon
                    size={15}
                    className="transition-transform duration-300 group-hover/b:translate-x-0.5"
                  />
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-muted/70 px-4 text-[14px] font-medium transition-colors hover:bg-muted active:scale-[.98]"
                >
                  Read the docs
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-10 font-mono text-[12px] text-muted-foreground">
            React 19 // Tailwind CSS v4 // strict TypeScript // custom elements for any framework
          </p>
        </div>
      </section>

      {/* Fig. 1 */}
      <Reveal>
        <Bench />
      </Reveal>

      {/* Strip */}
      <section className="sl-panel">
        <ul className="grid grid-cols-2 lg:grid-cols-4">
          {STRIP.map((s, i) => (
            <li
              key={s.k}
              className={`px-4 py-6 sm:px-8 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            >
              <p className="text-[15px] font-medium">
                {s.v !== null ? (
                  <>
                    <CountUp to={s.v} /> {s.label.toLowerCase()}
                  </>
                ) : (
                  s.label
                )}
              </p>
              <p className="mt-1 font-mono text-[12px] text-muted-foreground">{s.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="sl-stripe" aria-hidden />

      {/* 02 principles */}
      <Reveal as="section" className="sl-panel" aria-labelledby="principles-title">
        <SectionHead
          n={2}
          eyebrow="How they move"
          title={<span id="principles-title">Effects switch on for the state that matters.</span>}
          lede="Six rules came out of design reviews. They are why the motion reads as information rather than decoration."
        />
        <Principles items={principles} />
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 03 collections */}
      <Reveal as="section" className="sl-panel" aria-labelledby="collections-title">
        <SectionHead
          n={3}
          eyebrow="Collections"
          title={
            <span id="collections-title">{countWord(collections.length, true)} collections. One way of moving.</span>
          }
          action={
            <Link
              href="/collections"
              className="group/l reveal flex items-center gap-1.5 text-[14px] font-medium whitespace-nowrap"
            >
              All collections
              <ArrowRightIcon size={14} className="transition-transform duration-300 group-hover/l:translate-x-0.5" />
            </Link>
          }
        />
        <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
          {collections.map((c, i) => {
            const sig = signatureOf(c.slug);
            return (
              <Link
                key={c.slug}
                href={`/components/${c.slug}`}
                className="group/c reveal flex flex-col bg-background transition-colors hover:bg-surface"
                style={{ "--i": i } as React.CSSProperties}
              >
                {sig && (
                  <div className="pointer-events-none border-b border-line">
                    <ComponentPreview
                      variant="hero"
                      tag={sig.tag}
                      html={sig.stage}
                      layout={sig.layout === "wide" ? "fill" : sig.layout}
                      stageClass={sig.stageClass}
                      minHeight={250}
                      className="bg-transparent"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <p className="flex items-center justify-between font-mono text-[11.5px] text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <CollectionGlyph slug={c.slug} size={13} />
                      {pad2(i + 1)}
                    </span>
                    <span className="tabular">{c.count} components</span>
                  </p>
                  <h3 className="mt-4 flex items-center gap-2 text-[24px] font-medium tracking-[-0.025em]">
                    {c.title}
                    <ArrowRightIcon
                      size={16}
                      className="text-muted-foreground opacity-0 transition-all duration-300 ease-[var(--ease-expo)] group-hover/c:translate-x-1 group-hover/c:opacity-100"
                    />
                  </h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{c.summary}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 04 install / own / theme */}
      <Reveal as="section" className="sl-panel" aria-labelledby="workflow-title">
        <SectionHead
          n={4}
          eyebrow="How it works"
          title={<span id="workflow-title">Install. Own. Theme.</span>}
          lede="The shadcn CLI copies the source into your project. Shared engines install once. One set of tokens decides how every component looks."
        />
        <div className="grid gap-px bg-line lg:grid-cols-3">
          {[
            { n: 1, title: "Install", note: "// one command", body: <TerminalDemo /> },
            {
              n: 2,
              title: "Own",
              note: "// typed, readable",
              body: (
                <CodeBlock
                  title="components/lumesec/hf-gauge.tsx"
                  lang="tsx"
                  code={`export interface HfGaugeProps {\n  /** Current value, clamped to \`min\`–\`max\`. */\n  value?: number;\n  min?: number;\n  max?: number;\n  zones?: string;\n  label?: string;\n}\n\nexport function HfGauge(props: HfGaugeProps) {\n  return useLumesecElement("hf-gauge", …);\n}`}
                />
              ),
            },
            { n: 3, title: "Theme", note: "// one token", body: <ThemeDemo /> },
          ].map((step) => (
            <div key={step.n} className="flex flex-col bg-background">
              <div className="sl-rule flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <span className="tabular inline-flex size-6 items-center justify-center rounded-md border border-border font-mono text-[11px] text-muted-foreground">
                    {step.n}
                  </span>
                  <span className="text-[15px] font-medium">{step.title}</span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{step.note}</span>
              </div>
              <div className="flex-1 p-4 sm:p-6">{step.body}</div>
            </div>
          ))}
        </div>
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 05 everywhere */}
      <Reveal as="section" className="sl-panel" aria-labelledby="everywhere-title">
        <SectionHead
          n={5}
          eyebrow="Works where you do"
          title={<span id="everywhere-title">React where it fits. Any framework where it draws.</span>}
          lede="Controls and form fields are native React components on your Tailwind theme. The canvas-heavy collections are typed custom elements: they run in React with a typed wrapper, and in plain HTML, Vue or Svelte without one."
        />
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="bg-background p-4 sm:p-6">
            <div className="overflow-hidden rounded-xl border border-border bg-[var(--code-bg)]">
              <CodeTabs
                group="framework"
                className="[&>div:first-child]:bg-surface/70 [&>div:first-child]:px-2"
                items={frameworks.map((f) => ({
                  value: f.value,
                  label: f.label,
                  content: <CodeBlock code={f.code} lang={f.lang} bare item="hf-gauge" />,
                }))}
              />
            </div>
          </div>
          <div className="bg-background p-4 sm:p-6">
            <ComponentPreview tag={gauge.tag} html={gauge.stage} layout={gauge.layout} tryText={gauge.tryText} />
          </div>
        </div>
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 06 newest */}
      <Reveal as="section" className="sl-panel" aria-labelledby="new-title">
        <SectionHead
          n={6}
          eyebrow="Recently added"
          title={<span id="new-title">New on the bench.</span>}
          action={
            <Link
              href="/components?sort=newest"
              className="group/l reveal flex items-center gap-1.5 text-[14px] font-medium whitespace-nowrap"
            >
              Newest first
              <ArrowRightIcon size={14} className="transition-transform duration-300 group-hover/l:translate-x-0.5" />
            </Link>
          }
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {fresh.map((e, i) => (
            <ComponentCard
              key={e.tag}
              index={i}
              data={{
                tag: e.tag,
                title: e.title,
                collection: e.collection,
                href: elementHref(e),
                stage: e.stage,
                stageClass: e.stageClass,
                layout: e.layout,
                isNew: true,
                demo: e.data === "demo",
              }}
            />
          ))}
        </div>
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 07 products */}
      <Reveal as="section" className="sl-panel" aria-labelledby="products-title">
        <SectionHead
          n={7}
          eyebrow="From LumeSec"
          title={<span id="products-title">The products these components come from.</span>}
          lede="Elements is where the LumeSec design team publishes what it builds for SecureGrid and the AI Operating Platform."
        />
        <div className="grid gap-px bg-line md:grid-cols-2">
          {products.map((p, i) => (
            <div key={p.id} className="reveal bg-background p-4 sm:p-6" style={{ "--i": i } as React.CSSProperties}>
              <ProductCard product={p} className="h-full" />
            </div>
          ))}
        </div>
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* 08 faq */}
      <Reveal as="section" className="sl-panel" aria-labelledby="faq-title">
        <SectionHead n={8} eyebrow="Questions" title={<span id="faq-title">Before you install.</span>} />
        <Faq />
      </Reveal>

      <div className="sl-stripe" aria-hidden />

      {/* Closing */}
      <section className="sl-panel relative overflow-hidden" aria-labelledby="cta-title">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 80% at 50% 110%, color-mix(in oklab, var(--electric) 14%, transparent), transparent 70%)",
          }}
        />
        <div
          className="sl-dot-grid absolute inset-0 [mask-image:radial-gradient(70%_70%_at_50%_100%,black,transparent)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:py-32">
          <p className="font-mono text-[12px] text-muted-foreground">Free · MIT · {totalComponents} components</p>
          <h2
            id="cta-title"
            className="mt-6 text-[clamp(40px,6.4vw,84px)] leading-[0.95] font-medium tracking-[-0.05em]"
          >
            Start with
            <br />
            <span className="text-muted-foreground">one component.</span>
          </h2>
          <div className="mx-auto mt-10 max-w-[460px]">
            <InstallChip item="effort-slider" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link
              href="/docs/installation"
              className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Installation guide
            </Link>
            <Link
              href="/components"
              className="inline-flex h-10 items-center rounded-lg px-4 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Browse all {totalComponents}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

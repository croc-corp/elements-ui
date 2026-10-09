import { version } from "../../package.json";

/** The public origin, without a trailing slash. Set `NEXT_PUBLIC_SITE_URL` when self-hosting. */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://elements.lumesec.ai").replace(/\/$/, "");

/** Names, URLs and copy that describe the site. */
export const site = {
  name: "LumeSec Elements",
  shortName: "Elements",
  url: SITE_URL,
  title: "LumeSec Elements · Interactive components for shadcn",
  description:
    "Interactive components from the LumeSec design lab: controls, meters, charts and dot-matrix displays. React and TypeScript, installed with the shadcn CLI. You own the source.",
  registry: {
    namespace: "@lumesec",
    /** The `registries` entry for components.json. */
    url: `${SITE_URL}/r/{name}.json`,
  },
  repo: {
    url: "https://github.com/lumesec/elements-ui",
    branch: "main",
  },
  /** The release, from package.json. */
  version,
  company: {
    name: "LumeSec Technologies GmbH",
    url: "https://lumesec.ai",
    email: "hello@lumesec.ai",
    linkedin: "https://www.linkedin.com/company/lumesec",
    github: "https://github.com/lumesec",
    tagline: "For the ambitious and vigilant.",
  },
  keywords: [
    "shadcn registry",
    "shadcn components",
    "react components",
    "tailwind components",
    "typescript components",
    "web components",
    "custom elements",
    "ui components",
    "animated components",
    "micro-interactions",
    "dashboard components",
    "LumeSec",
  ],
} as const;

/** A site path as an absolute URL on the configured origin. */
export function absoluteUrl(path = "/") {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The LumeSec products with their own mark (see `ProductMark`). */
export type ProductId = "elements" | "aiop" | "securegrid" | "learn";

/** A LumeSec product, as the product cards show it. */
export type Product = {
  id: ProductId;
  name: string;
  /** Short line under the name. */
  tagline: string;
  description: string;
  href: string;
  cta: string;
  meta: string;
};

/** LumeSec products, shown in the docs rail, the footer and on the landing page. */
export const products: Product[] = [
  {
    id: "securegrid",
    name: "SecureGrid",
    tagline: "Ask anything. Leak nothing.",
    description:
      "Names, IBANs and API keys become placeholders before you paste into ChatGPT, Claude or Copilot. The answer gets the real values back. On your device.",
    href: "https://securegrid.dev/en",
    cta: "Download free",
    meta: "macOS · Windows · runs locally",
  },
  {
    id: "aiop",
    name: "AI Operating Platform",
    tagline: "Predictable AI. Built for Enterprise.",
    description:
      "The operating layer beneath the models you already use, so regulated institutions can run AI with identity, policy and signed evidence.",
    href: "https://lumesec.ai/contact?topic=platform",
    cta: "Request a briefing",
    meta: "Correlate · Contain · Attest",
  },
];

const LS = "https://lumesec.ai";

/** Pages on lumesec.ai, for the logo menu and the footer. */
export const lumesecPages = {
  solutions: [
    { label: "Platform", href: `${LS}/solutions/platform`, note: "The AI Operating Platform" },
    {
      label: "Document Understanding",
      href: `${LS}/solutions/document-understanding`,
      note: "Signed, auditable extraction.",
    },
    {
      label: "Process Automation",
      href: `${LS}/solutions/process-automation`,
      note: "Managed agents bound to identity.",
    },
    {
      label: "Financial Document Analysis",
      href: `${LS}/solutions/financial-document-analysis`,
      note: "Numbers with a chain of custody.",
    },
    { label: "Knowledge Management", href: `${LS}/solutions/knowledge-management`, note: "Scoped omniscience." },
    {
      label: "Risk / Compliance",
      href: `${LS}/solutions/risk-compliance-classification`,
      note: "Map AI systems to regulations.",
    },
    { label: "Identity", href: `${LS}/solutions/identity`, note: "One identity surface. Yours or ours." },
  ],
  company: [
    { label: "About LumeSec", href: `${LS}/company` },
    { label: "Mission, Vision & Values", href: `${LS}/company/mission-vision-values` },
    { label: "Team", href: `${LS}/company/team` },
    { label: "Advisory Board", href: `${LS}/company/advisory-board` },
    { label: "Partner Network", href: `${LS}/company/partner-network` },
    { label: "Careers", href: `${LS}/company/careers` },
    { label: "Brand", href: `${LS}/brand` },
    { label: "Press", href: `${LS}/press` },
  ],
  resources: [
    { label: "Services", href: `${LS}/services` },
    { label: "Concepts", href: `${LS}/concepts` },
    { label: "Blog", href: `${LS}/blog` },
    { label: "Research", href: `${LS}/research` },
    { label: "Case studies", href: `${LS}/case-studies` },
    { label: "Changelog", href: `${LS}/changelog` },
    { label: "Integrations", href: `${LS}/integrations` },
    { label: "FAQ", href: `${LS}/faq` },
  ],
  contact: { label: "Let's talk", href: `${LS}/contact` },
  brand: { label: "Brand guidelines", href: `${LS}/brand` },
} as const;

/** Footer columns. */
export const footerLinks = [
  {
    title: "Elements",
    links: [
      { label: "Components", href: "/components" },
      { label: "Introduction", href: "/docs" },
      { label: "Installation", href: "/docs/installation" },
      { label: "Theming", href: "/docs/theming" },
      { label: "Changelog", href: "/docs/changelog" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Products",
    links: [
      { label: "SecureGrid", href: "https://securegrid.dev/en" },
      { label: "AI Operating Platform", href: `${LS}/solutions/platform` },
      { label: "Learn", href: "https://learn.lumesec.ai" },
      { label: "Elements", href: "/" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "LumeSec Technologies", href: LS },
      { label: "GitHub", href: "https://github.com/lumesec" },
      { label: "LinkedIn", href: "https://www.linkedin.com/company/lumesec" },
      { label: "Contact", href: `${LS}/contact` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Imprint", href: `${LS}/legal/imprint` },
      { label: "Privacy policy", href: `${LS}/legal/privacy-policy` },
      { label: "License", href: "/docs/license" },
    ],
  },
] as const;

import { DocsFrame } from "@/components/docs/docs-frame";
import { getNav } from "@/lib/nav";

/** Guides and component pages share the sub-navigation and the sidebar. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsFrame nav={getNav()}>{children}</DocsFrame>;
}

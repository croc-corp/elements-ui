import { CodeTabs } from "@/components/code/code-tabs";
import { CopyButton } from "@/components/code/copy-button";
import { SourceFiles } from "@/components/code/source-files";
import { site } from "@/config/site";
import type { ElementMeta } from "@/lib/catalog";
import { highlight } from "@/lib/highlight";
import { registryFiles } from "@/lib/registry-files";

const PACKAGE_MANAGERS = [
  { id: "pnpm", run: "pnpm dlx" },
  { id: "npm", run: "npx" },
  { id: "yarn", run: "yarn dlx" },
  { id: "bun", run: "bunx --bun" },
] as const;

/** One highlighted shell command with a copy button. */
async function CommandLine({
  cmd,
  item,
  event = "copy_install",
}: {
  cmd: string;
  item: string;
  event?: "copy_install" | "copy_code";
}) {
  // shiki output for a command built from catalog data
  const html = await highlight(cmd, "bash");
  return (
    <div className="flex items-center gap-2 bg-[var(--code-bg)] pr-1.5">
      <div className="code-scroll min-w-0 flex-1 [&_pre]:py-3" dangerouslySetInnerHTML={{ __html: html }} />
      <CopyButton text={cmd} event={event} item={item} />
    </div>
  );
}

/** CLI (pnpm / npm / yarn / bun, remembered) and a manual tab listing the source files. */
export function InstallBlock({ element }: { element: ElementMeta }) {
  const name = `${site.registry.namespace}/${element.tag}`;
  const url = `${site.url}/r/${element.tag}.json`;
  const install = PACKAGE_MANAGERS.map((p) => ({
    value: p.id,
    label: p.id,
    content: <CommandLine cmd={`${p.run} shadcn@latest add ${name}`} item={element.tag} />,
  }));
  const setup = PACKAGE_MANAGERS.map((p) => ({
    value: p.id,
    label: p.id,
    content: (
      <CommandLine
        cmd={`${p.run} shadcn@latest registry add ${site.registry.namespace}=${site.registry.url}`}
        item="registry"
        event="copy_code"
      />
    ),
  }));

  return (
    <div className="not-prose overflow-hidden rounded-xl border border-border">
      <CodeTabs
        group="install-mode"
        className="[&>div:first-child]:bg-surface/70 [&>div:first-child]:px-2"
        items={[
          {
            value: "cli",
            label: "CLI",
            content: (
              <div>
                <CodeTabs group="pm" items={install} className="[&>div:first-child]:px-2" />
                <details className="group/setup border-t border-border">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="font-mono text-[11px] text-foreground">First time</span>
                    Register the {site.registry.namespace} registry once, or install by URL
                    <span
                      className="ml-auto font-mono text-[11px] transition-transform group-open/setup:rotate-45"
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-border p-3">
                    <p className="text-[13px] text-muted-foreground">
                      Adds {site.registry.namespace} to your components.json:
                    </p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <CodeTabs group="pm" items={setup} className="[&>div:first-child]:px-2" />
                    </div>
                    <p className="text-[13px] text-muted-foreground">Or skip the setup and install by URL:</p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <CommandLine cmd={`npx shadcn@latest add ${url}`} item={element.tag} />
                    </div>
                  </div>
                </details>
              </div>
            ),
          },
          {
            value: "manual",
            label: "Manual",
            content: <SourceFiles files={registryFiles(element)} tag={element.tag} />,
          },
        ]}
      />
    </div>
  );
}

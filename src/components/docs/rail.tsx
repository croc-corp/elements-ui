import { Feedback } from "@/components/docs/feedback";
import { ProductCard } from "@/components/docs/product-card";
import { Toc, type TocEntry } from "@/components/docs/toc";
import { FlagIcon, PencilIcon } from "@/components/icons";
import { absoluteUrl, products, site } from "@/config/site";
import { cn } from "@/lib/utils";

/** The product shown on a page: stable per path so it doesn't change on reload. */
function productFor(path: string) {
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return products[h % products.length];
}

/** "Edit this page" on GitHub and "Report an issue" with the page and its source file filled in. */
function EditLinks({ path, file, title, className }: { path: string; file: string; title: string; className?: string }) {
  const edit = `${site.repo.url}/edit/${site.repo.branch}/${file}`;
  // prefills the "Documentation" issue form (.github/ISSUE_TEMPLATE/docs.yml)
  const query = { template: "docs.yml", title: `Docs: ${title}`, page: absoluteUrl(path), file };
  const issue = `${site.repo.url}/issues/new?${Object.entries(query)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
  return (
    <div className={cn("grid gap-1", className)}>
      <a href={edit} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <PencilIcon size={13} />
        Edit this page
      </a>
      <a href={issue} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <FlagIcon size={13} />
        Report an issue
      </a>
    </div>
  );
}

/** Right column: on this page, our products, feedback, edit links. */
export function DocsRail({ toc, path, file, title }: { toc: TocEntry[]; path: string; file: string; title: string }) {
  return (
    <aside className="sticky top-[calc(var(--header-height)+var(--subnav-height))] hidden h-[calc(100dvh-var(--header-height)-var(--subnav-height))] overflow-y-auto overscroll-contain border-l border-border px-6 pt-8 pb-10 xl:block">
      <Toc items={toc} />
      <ProductCard product={productFor(path)} className={toc.length ? "mt-8" : ""} />
      <Feedback path={path} className="mt-8 border-t border-border pt-6" />
      <EditLinks path={path} file={file} title={title} className="mt-4" />
    </aside>
  );
}

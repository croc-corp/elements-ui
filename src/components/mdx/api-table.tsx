import * as React from "react";

type Cell = React.ReactNode;

/** Plain text of a React node (for header labels and empty-cell checks). */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const childrenOf = (node: React.ReactNode) =>
  React.Children.toArray(React.isValidElement<{ children?: React.ReactNode }>(node) ? node.props.children : null).filter(React.isValidElement) as React.ReactElement<{
    children?: React.ReactNode;
  }>[];

/** Rows of a Markdown table as cell lists: [header, ...body]. */
function rowsOf(table: React.ReactNode): { head: Cell[]; body: Cell[][] } | null {
  const sections = React.Children.toArray(table).filter(React.isValidElement) as React.ReactElement<{ children?: React.ReactNode }>[];
  const thead = sections.find((s) => s.type === "thead");
  const tbody = sections.find((s) => s.type === "tbody");
  if (!thead || !tbody) return null;
  const headRow = childrenOf(thead)[0];
  if (!headRow) return null;
  const head = childrenOf(headRow).map((c) => c.props.children);
  const body = childrenOf(tbody).map((tr) => childrenOf(tr).map((c) => c.props.children));
  return { head, body };
}

const isEmpty = (c: Cell) => {
  const t = textOf(c).trim();
  return !t || t === "—" || t === "-";
};

/**
 * Reference tables whose last column is a description read better as a list: name and facts on one
 * line, the description at full width underneath. Other tables stay tables.
 */
export function ApiTable({ children }: { children: React.ReactNode }) {
  const rows = rowsOf(children);
  const last = rows ? textOf(rows.head.at(-1)).trim().toLowerCase() : "";
  if (!rows || last !== "description" || rows.head.length < 2) return null;
  const labels = rows.head.map((h) => textOf(h).trim());

  return (
    <div className="not-prose my-6 divide-y divide-line border-y border-border">
      {rows.body.map((cells, i) => {
        const name = cells[0];
        const facts = cells.slice(1, -1).map((c, j) => ({ label: labels[j + 1], cell: c })).filter((f) => !isEmpty(f.cell));
        const description = cells.at(-1);
        return (
          <div key={i} className="grid gap-2 py-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
              <span className="font-mono text-[13.5px] font-medium text-foreground [&_code]:font-mono">{name}</span>
              {facts.map((f) => (
                <span key={f.label} className="flex min-w-0 items-baseline gap-1.5">
                  <span className="font-mono text-[10.5px] text-muted-foreground">{f.label}</span>
                  <span className="min-w-0 font-mono text-[12px] break-words text-foreground/85 [&_code]:rounded-[4px] [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px]">
                    {f.cell}
                  </span>
                </span>
              ))}
            </div>
            {!isEmpty(description) && (
              <p className="max-w-[72ch] text-[14px] leading-relaxed text-muted-foreground [&_code]:rounded-[4px] [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground">
                {description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { usePaged } from "@/api/hooks";
import { cn, Icon } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { InlineInput } from "@/components/form";

/**
 * ⌘K. Screens and records from the server's search registry, first page only
 * (the registry pages at 25 like everything else). Arrow keys move, Enter opens.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { navigate } = useRouter();
  const list = usePaged("GET /api/v1/search", { enabled: true });
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const rows = list.q.trim() ? list.rows : list.rows.filter((r) => r.kind === "screen").slice(0, 12);
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCur((c) => Math.min(rows.length - 1, c + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    }
    if (e.key === "Enter" && rows[cur]) go(rows[cur].path);
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-[70] flex items-start justify-center bg-scrim px-4 pt-[12vh] pb-4 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Search" className="w-full max-w-[560px] overflow-hidden rounded-sheet border border-glass-border bg-glass shadow-3 backdrop-blur-[18px]">
        <div className="flex items-center gap-2.5 border-b border-glass-border px-4 py-[14px]">
          <Icon name="srch" size="m" className="text-subtle-foreground" />
          <InlineInput
            ref={input}
            className="flex-1 border-0 bg-transparent text-[15px] outline-none"
            placeholder="Screens, people, records"
            value={list.q}
            onChange={(v) => (list.setQ(v), setCur(0))}
            onKeyDown={onKey}
            aria-label="Search"
          />
        </div>
        <div className="max-h-[330px] overflow-y-auto p-1.5" role="listbox">
          {rows.length === 0 && !list.loading && <p className="px-[11px] py-6 text-center text-[12.5px] text-subtle-foreground">Nothing matches. Try a name or a screen.</p>}
          {rows.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={`${r.path}-${i}`}>
                {head && <div className="px-[11px] pt-2.5 pb-[5px] text-[10.5px] font-[650] tracking-[.1em] text-subtle-foreground uppercase">{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cur}
                  onMouseEnter={() => setCur(i)}
                  onClick={() => go(r.path)}
                  className={cn("flex w-full items-center gap-[11px] rounded-ctl px-[11px] py-[9px] text-left text-[13.5px]", i === cur && "bg-accent")}
                >
                  <Icon name={r.kind === "screen" ? "right" : "user"} className="text-accent-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="ml-auto text-[10.5px] text-subtle-foreground">{r.subtitle}</span>
                </button>
              </div>
            );
          })}
          {list.page && list.q.trim() && list.page.total > list.rows.length && (
            <p className="px-[11px] py-2 text-[11px] text-subtle-foreground">
              Showing the first {list.rows.length} of {list.page.total}. Keep typing to narrow it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

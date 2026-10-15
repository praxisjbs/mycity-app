import { useState } from "react";
import { usePaged } from "@/api/hooks";
import "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/data";
import { Icon } from "@/components/ui/Icon";
import { SearchBox } from "./Search";

/**
 * Pick people from the server (FRONTEND_GUIDE §4: never fetch "all" for a
 * dropdown). Shows the first page, searches as you type.
 */
export function PersonPicker({ value, onChange, multiple, placeholder = "Search people" }: { value: PersonRef[]; onChange: (v: PersonRef[]) => void; multiple?: boolean; placeholder?: string }) {
  const list = usePaged("GET /api/v1/employees");
  const [open, setOpen] = useState(false);
  const has = (id: string) => value.some((v) => v.employee_id === id);
  const toggle = (p: PersonRef) => {
    if (!multiple) return (onChange([p]), setOpen(false));
    onChange(has(p.employee_id) ? value.filter((v) => v.employee_id !== p.employee_id) : [...value, p]);
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.employee_id} className="inline-flex h-[26px] items-center gap-[5px] rounded-full bg-accent pr-1 pl-2.5 text-[12.5px]">
              {v.display_name}
              <button type="button" aria-label={`Remove ${v.display_name}`} className="flex size-5 items-center justify-center rounded-full hover:bg-card" onClick={() => onChange(value.filter((x) => x.employee_id !== v.employee_id))}>
                <Icon name="x" className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <SearchBox value={list.q} onChange={(q) => (list.setQ(q), setOpen(true))} placeholder={placeholder} className="mb-2" />
      {(open || !value.length) && (
        <div className="max-h-[250px] overflow-y-auto rounded-xl border border-border">
          {list.rows.map((r) => {
            const p: PersonRef = { employee_id: r.employee_id, display_name: r.display_name, job_title: r.job_title, department: r.department };
            const on = has(r.employee_id);
            return (
              <button key={r.employee_id} type="button" onClick={() => toggle(p)} className="flex w-full items-center gap-2.5 border-b border-border px-[11px] py-[9px] text-left last:border-b-0 hover:bg-muted">
                <Avatar name={r.display_name} size={30} />
                <span className="min-w-0 flex-1 text-[13px]">
                  <b className="block font-semibold">{r.display_name}</b>
                  <span className="text-[11.5px] text-subtle-foreground">
                    {r.job_title} · {r.department}
                  </span>
                </span>
                <span className={cn("flex size-5 flex-none items-center justify-center rounded-full border-[1.5px] text-secondary-foreground", on ? "border-secondary bg-secondary" : "border-input")}>{on && <Icon name="tick" className="size-3" />}</span>
              </button>
            );
          })}
          {list.page && list.page.total > list.rows.length && <p className="px-[11px] py-2 text-[11px] text-subtle-foreground">First {list.rows.length} of {list.page.total}. Type to narrow.</p>}
        </div>
      )}
    </div>
  );
}

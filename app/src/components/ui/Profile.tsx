import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { Icon } from "./Icon";

/** "Back to Employees" above a record page. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-[5px] pr-[11px] pl-2 text-[12.5px] font-semibold text-muted-foreground hover:border-subtle-foreground hover:text-foreground"
    >
      <Icon name="left" />
      {label}
    </button>
  );
}

/** The head of a record page (a 360): big initials, name, role, chips and actions. */
export function ProfileHeader({ name, role, chips, actions, brand, avatar }: { name: string; role: ReactNode; chips?: ReactNode; actions?: ReactNode; brand?: boolean; avatar?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start gap-4 rounded-card border border-border bg-card p-4 shadow-1 max-md:p-[14px]">
      {avatar ?? (
        <span
          className={cn(
            "flex size-[62px] flex-none items-center justify-center rounded-sheet text-[21px] font-bold tracking-[-.02em] max-md:size-[52px] max-md:text-[18px]",
            brand ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {initials(name)}
        </span>
      )}
      <span className="min-w-0 flex-1 max-md:basis-[180px]">
        <h2 className="text-[19px] tracking-[-.02em]">{name}</h2>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{role}</div>
        {chips && <div className="mt-[9px] flex flex-wrap gap-1.5">{chips}</div>}
      </span>
      {actions && <span className="flex flex-wrap gap-[7px] max-md:w-full">{actions}</span>}
    </div>
  );
}

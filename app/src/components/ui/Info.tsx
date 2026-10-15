import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/**
 * Long text behind an ⓘ (gate 8, FRONTEND_GUIDE §5).
 *
 * The button is a SIBLING of what it explains, never inside its label or
 * heading. The text stays in the DOM, visually hidden, tied to the button with
 * aria-describedby; pressing ⓘ shows it inline, below.
 *
 *   const info = useInfo();
 *   <h3>Leave Balance</h3><InfoButton {...info} label="About leave balance" />
 *   ...
 *   <InfoText {...info}>Accrues 1.75 days a month ...</InfoText>
 */
export function useInfo() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return { id, open, toggle: () => setOpen((o) => !o) };
}

export function InfoButton({ id, open, toggle, label }: { id: string; open: boolean; toggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-[22px] flex-none items-center justify-center rounded-full align-middle text-subtle-foreground hover:bg-accent hover:text-accent-foreground",
        open && "bg-accent text-accent-foreground",
      )}
      aria-label={label}
      aria-expanded={open}
      aria-controls={id}
      aria-describedby={id}
      onClick={toggle}
    >
      <Icon name="info" />
    </button>
  );
}

export function InfoText({ id, open, children, className }: { id: string; open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      id={id}
      className={cn(
        open ? "mt-[-6px] mb-[14px] rounded-box border border-border bg-muted px-3 py-2.5 text-[12.5px] leading-normal text-muted-foreground" : "sr-only",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Heading + ⓘ + its text, the common case in one piece. */
export function WithInfo({ heading, label, children, level = "h3" }: { heading: ReactNode; label: string; children: ReactNode; level?: "h1" | "h3" }) {
  const info = useInfo();
  const H = level;
  return (
    <>
      <span className="flex items-center gap-1.5">
        <H className={level === "h1" ? "text-[20px]" : "text-[13.5px] font-[650]"}>{heading}</H>
        <InfoButton {...info} label={label} />
      </span>
      <InfoText {...info} className={info.open ? "mt-2" : undefined}>
        {children}
      </InfoText>
    </>
  );
}

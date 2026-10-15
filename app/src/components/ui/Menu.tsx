import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@mycity/ui";

export type MenuItem = { label: ReactNode; icon?: IconName; onSelect: () => void; danger?: boolean } | "sep";

/**
 * A small menu anchored to the button that opened it (⋮, ＋). Closes on a
 * choice, Escape, or a click elsewhere.
 */
export function Menu({ trigger, items, align = "end" }: { trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; ref: React.Ref<HTMLButtonElement> }) => ReactNode; items: MenuItem[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = pop.current?.offsetWidth ?? 210;
    const height = pop.current?.offsetHeight ?? 0;
    const left = align === "end" ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(false), btn.current?.focus());
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    setTimeout(() => pop.current?.querySelector("button")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu", ref: btn })}
      {open &&
        createPortal(
          <div ref={pop} role="menu" className="fixed z-[78] min-w-[210px] animate-rise rounded-xl border border-border bg-popover p-1.5 shadow-3" style={pos}>
            {items.map((it, i) =>
              it === "sep" ? (
                <div key={i} className="mx-1 my-[5px] h-px bg-border" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  type="button"
                  className={"flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left text-[13px] hover:bg-accent focus-visible:bg-accent " + (it.danger ? "text-destructive" : "")}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                >
                  {it.icon && <Icon name={it.icon} className={it.danger ? "" : "text-accent-foreground"} />}
                  {it.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

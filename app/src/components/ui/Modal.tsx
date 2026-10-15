import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, IconButton } from "@mycity/ui";
import { useRouter } from "@/lib/router";

/**
 * THE modal (FRONTEND_GUIDE §8: one modal, used everywhere). On a phone it is a
 * bottom sheet; `full` makes it the whole screen there (a reader, a composer).
 *
 *   const modal = useModal();
 *   modal.open({ title: "New Task", body: (close) => <TaskForm onDone={close} /> });
 *
 * Opening a second one replaces the first, so there is never a stack of dialogs.
 * Escape and the backdrop close it; focus moves in, and returns on close.
 */
export interface ModalSpec {
  title: ReactNode;
  sub?: ReactNode;
  body: ReactNode | ((close: () => void) => ReactNode);
  footer?: ReactNode | ((close: () => void) => ReactNode);
  wide?: boolean;
  full?: boolean;
  onClose?: () => void;
}

interface ModalApi {
  open: (spec: ModalSpec) => void;
  close: () => void;
  isOpen: boolean;
}

const ModalContext = createContext<ModalApi | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ModalSpec | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setSpec((s) => {
      s?.onClose?.();
      return null;
    });
    const el = returnTo.current;
    returnTo.current = null;
    if (el) setTimeout(() => el.focus(), 0);
  }, []);

  const open = useCallback((next: ModalSpec) => {
    if (!returnTo.current) returnTo.current = document.activeElement as HTMLElement | null;
    setSpec(next);
  }, []);

  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && box.current) {
        const f = box.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const target = box.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select") ?? box.current?.querySelector<HTMLElement>("button");
      target?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [spec, close]);

  /* A new screen closes whatever was open on the last one. */
  const { location } = useRouter();
  const where = location.path + location.params.toString().replace(/(^|&)id=[^&]*/, "");
  useEffect(() => {
    setSpec(null);
    returnTo.current = null;
  }, [where]);

  const api = useMemo(() => ({ open, close, isOpen: !!spec }), [open, close, spec]);

  return (
    <ModalContext.Provider value={api}>
      {children}
      {spec && (
        <div
          className="fixed inset-x-0 top-(--env-bar) bottom-0 z-[75] flex items-center justify-center bg-scrim p-5 backdrop-blur-[2px] max-md:items-end max-md:p-0"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={cn(
              "flex max-h-[calc(100vh-40px)] w-full animate-rise flex-col rounded-sheet border border-border bg-card shadow-3",
              spec.wide ? "max-w-[780px]" : "max-w-[500px]",
              "max-md:max-h-[92dvh] max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-[18px]",
              spec.full && "max-md:h-dvh max-md:max-h-none max-md:rounded-none",
            )}
          >
            <div className="flex flex-none items-center gap-2.5 border-b border-border py-[13px] pr-[14px] pl-[18px]">
              <h3 id="modal-title" className="min-w-0 flex-1 text-[15px]">
                {spec.title}
              </h3>
              <IconButton icon="x" label="Close" size="sm" onClick={close} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
              {spec.sub && <p className="-mt-1 mb-3 text-[11.5px] text-subtle-foreground">{spec.sub}</p>}
              {typeof spec.body === "function" ? spec.body(close) : spec.body}
            </div>
            {spec.footer && (
              <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-border px-[18px] py-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
                {typeof spec.footer === "function" ? spec.footer(close) : spec.footer}
              </div>
            )}
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal outside ModalProvider");
  return ctx;
}

/** Footer spacer: pushes what follows to the right, keeps what precedes on the left. */
export const Grow = () => <span className="mr-auto" />;

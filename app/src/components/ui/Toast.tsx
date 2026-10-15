import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";

/**
 * Short confirmations ("Saved", "Sent"). Never a native alert (gate 16).
 * Call toast("Saved") from anywhere; <Toasts /> is mounted once in the app.
 */
type T = { id: number; text: string; fading: boolean };
let items: T[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(text: string) {
  const id = ++seq;
  items = [...items, { id, text, fading: false }];
  emit();
  setTimeout(() => {
    items = items.map((t) => (t.id === id ? { ...t, fading: true } : t));
    emit();
    setTimeout(() => {
      items = items.filter((t) => t.id !== id);
      emit();
    }, 320);
  }, 2600);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (s) => (subs.add(s), () => subs.delete(s)),
    () => items,
    () => items,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex flex-col gap-2 max-md:right-[14px] max-md:bottom-[78px] max-md:left-[14px]" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className="flex max-w-[320px] animate-rise items-center gap-[9px] rounded-box bg-sidebar px-[14px] py-[11px] text-[13px] text-sidebar-foreground shadow-3 transition-opacity duration-300 max-md:max-w-none"
          style={{ opacity: t.fading ? 0 : 1 }}
        >
          <Icon name="ok" className="text-primary" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

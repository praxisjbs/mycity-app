/**
 * @component FloatingButton
 * @group Shell
 * @summary The phone's floating button, bottom right above the bottom bar: a tap fans out the screen's New action, Clock In or Out, Praxis AI and Help, with Hide Here last (F18).
 * @use Once, in PhoneShell's fab slot; the app passes the actions for the screen in view. Hide Here keeps it hidden until the person leaves the page (the app clears `hidden` on a new page).
 * @avoid Desktop (it has none: the top bar holds the clock, the page header the New action); a second floating button; dragging it anywhere.
 * @phone The whole point. It tucks away while the page scrolls down and returns on scrolling up; it hides while a sheet or dialog is open and while the keyboard is up; the page keeps clear space under its content so it never hides data.
 * @a11y A button named Quick Actions that says whether its fan is open; the fan is a list of named buttons, the first focused on opening; Esc or a tap outside closes it and focus returns. Hidden, it leaves the tab order.
 * @status stable
 * @example <FloatingButton actions={[{ key: "clock", label: "Clock In", icon: "clock", onSelect: clockIn }]} onHideHere={hideHere} />
 */
import { useContext, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { useBackClose } from "../lib/history";
import { Icon, type IconName } from "../icons/Icon";
import { FanContext, useShellScroll } from "./scroll";

/** One action in the fan. */
export interface FabAction {
  /** Its key. */
  key: string;
  /** Verb Noun, at most 3 words (New Task, Clock In). */
  label: string;
  /** Its glyph. */
  icon: IconName;
  /** What it does; the fan closes first. */
  onSelect: () => void;
}

export interface FloatingButtonProps {
  /** The fan, top to bottom as read: the screen's New action when it has one, Clock In or Out, Praxis AI, Help. */
  actions: FabAction[];
  /** Hide Here: the app hides the button until the person leaves the page. */
  onHideHere: () => void;
  /** Hidden by Hide Here. */
  hidden?: boolean;
  /** The button's name; Quick Actions unless set. */
  label?: string;
  /** Open the fan from the start (the gallery). */
  defaultOpen?: boolean;
}

const TEXT_ENTRY = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]";
const OPEN_OVERLAY = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/** Is a sheet, modal or dialog open anywhere on the page? */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector(OPEN_OVERLAY));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, []);
  return open;
}

/** Is the person typing (a text field has focus, so the phone's keyboard is up)? */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const on = (e: FocusEvent) => setTyping(e.target instanceof Element && e.target.matches(TEXT_ENTRY));
    const off = (e: FocusEvent) => setTyping(e.relatedTarget instanceof Element && e.relatedTarget.matches(TEXT_ENTRY));
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return typing;
}

export function FloatingButton({ actions, onHideHere, hidden = false, label = "Quick Actions", defaultOpen = false }: FloatingButtonProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { direction, atTop } = useShellScroll();
  const overlay = useOverlayOpen();
  const typing = useTyping();
  const away = hidden || overlay || typing || (direction === "down" && !atTop);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  const fan = useId();
  const setFanOpen = useContext(FanContext);

  // The phone shell dims the page behind an open fan.
  useEffect(() => {
    setFanOpen(open);
    return () => setFanOpen(false);
  }, [open, setFanOpen]);
  // The phone's Back folds the fan away before it leaves the screen (F29).
  useBackClose(open, () => setOpen(false));

  useEffect(() => {
    if (away) setOpen(false);
  }, [away]);

  // Esc or a tap outside closes the fan; focus goes back to the button.
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("ul button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        main.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const choose = (act: () => void) => {
    setOpen(false);
    main.current?.focus();
    act();
  };

  const items: FabAction[] = [...actions, { key: "hide-here", label: "Hide Here", icon: "hide", onSelect: onHideHere }];

  return (
    <div
      ref={root}
      data-fab=""
      aria-hidden={away || undefined}
      className={cn("relative transition-all duration-(--dur) ease-out", away ? "pointer-events-none translate-y-24 opacity-0" : "translate-y-0 opacity-100")}
    >
      {open && (
        <ul id={fan} aria-label={label} className="absolute right-0 bottom-full mb-3 flex animate-rise flex-col items-end gap-2.5">
          {items.map((a) => (
            <li key={a.key}>
              <button type="button" data-ui="button" onClick={() => choose(a.onSelect)} className="flex min-h-tap items-center gap-2.5 text-right">
                <span className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-card-foreground shadow-2">{a.label}</span>
                <span className="flex size-12 flex-none items-center justify-center rounded-full bg-card text-accent-foreground shadow-2">
                  <Icon name={a.icon} size="m" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        ref={main}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? fan : undefined}
        tabIndex={away ? -1 : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-3"
      >
        <Icon name="plus" size="l" className={cn("transition-transform duration-(--dur)", open && "rotate-45")} />
      </button>
    </div>
  );
}

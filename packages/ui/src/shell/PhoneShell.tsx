/**
 * @component PhoneShell
 * @group Shell
 * @summary The staff app's phone frame: the top bar and title rail, the page, which alone scrolls, the floating button, and the bottom bar.
 * @use Once, by the staff app's shell, at 760 px and below; it lays out PhoneHeader, the screen, FloatingButton and BottomBar, and tells them which way the page scrolls.
 * @avoid Desktop (DesktopShell); a screen drawing its own bottom bar or floating button; the public site (PublicPage).
 * @phone The whole point: a native app frame. The page keeps clear space under its content for the floating button (F18), so the button never hides data, and only the page scrolls.
 * @a11y The page is the main landmark (with `landmarks`), marked data-ui="scroller" and data-ui="page" for the screen gates; the bottom bar is the Main navigation.
 * @status stable
 * @example <PhoneShell header={<PhoneHeader ... />} bottomBar={<BottomBar ... />} fab={<FloatingButton ... />}>{screen}</PhoneShell>
 */
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { ShellScrollContext, useScrollDirection } from "./scroll";

export interface PhoneShellProps {
  /** The PhoneHeader: the top bar and title rail. */
  header: ReactNode;
  /** The screen. */
  children: ReactNode;
  /** The BottomBar. */
  bottomBar: ReactNode;
  /** The FloatingButton; when given, the page keeps clear space under its content for it. */
  fab?: ReactNode;
  /** A notice floating above the bottom bar (ShellNotice). */
  notice?: ReactNode;
  /** A fit page: it fills the height and only its panes scroll. */
  fit?: boolean;
  /** Changes when the screen changes (its path): the page scrolls back to the top and the title returns. */
  pageKey?: string;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
}

export function PhoneShell({ header, children, bottomBar, fab, notice, fit = false, pageKey, landmarks = true }: PhoneShellProps) {
  const Main = landmarks ? "main" : "div";
  const scroller = useRef<HTMLElement | null>(null);
  const { state, onScroll, reset } = useScrollDirection();
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
    reset();
  }, [pageKey, reset]);

  return (
    <ShellScrollContext.Provider value={state}>
      <div data-shell="phone" className="flex h-full min-h-0 flex-col bg-muted">
        {header}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Main
            ref={(el: HTMLElement | null) => {
              scroller.current = el;
            }}
            data-ui="scroller"
            onScroll={onScroll}
            className={cn("min-h-0 flex-1 overflow-x-hidden px-3.5 pt-3.5", fit ? "flex flex-col overflow-y-hidden pb-3.5" : cn("overflow-y-auto", fab ? "pb-24" : "pb-6"))}
          >
            <div data-ui="page" className={cn(fit && "flex min-h-0 flex-1 flex-col")}>
              {children}
            </div>
          </Main>
          {notice != null && <div className={cn("pointer-events-none absolute inset-x-3 flex justify-center *:pointer-events-auto", fab && !fit ? "bottom-22" : "bottom-3")}>{notice}</div>}
          {fab != null && !fit && <div className="pointer-events-none absolute right-4 bottom-4 *:pointer-events-auto">{fab}</div>}
        </div>
        {bottomBar}
      </div>
    </ShellScrollContext.Provider>
  );
}

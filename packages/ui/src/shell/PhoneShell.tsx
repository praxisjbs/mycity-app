/**
 * @component PhoneShell
 * @group Shell
 * @summary The staff app's phone frame: the top bar and title rail, the page, which alone scrolls and pulls to refresh, the floating button, and the bottom bar.
 * @use Once, by the staff app's shell, at 760 px and below; it lays out PhoneHeader, the screen, FloatingButton and BottomBar, and tells them which way the page scrolls. `onRefresh` and `onReload` give the page its pull (F28).
 * @avoid Desktop (DesktopShell); a screen drawing its own bottom bar or floating button; the public site (PublicPage).
 * @phone The whole point: a native app frame. The page keeps clear space under its content for the floating button (F18), so the button never hides data, and only the page scrolls. While the button's fan is open the page dims behind it. Pulled down at its top the page refreshes in place, and pulled on past the second notch it reloads the app (F28); a fit page has no pull, and the browser's own pull never runs.
 * @a11y The page is the main landmark (with `landmarks`), marked data-ui="scroller" and data-ui="page" for the screen gates; the bottom bar is the Main navigation.
 * @status stable
 * @example <PhoneShell header={<PhoneHeader ... />} bottomBar={<BottomBar ... />} fab={<FloatingButton ... />}>{screen}</PhoneShell>
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { PullIndicator } from "./PullIndicator";
import { usePull } from "./pull";
import { FanContext, ShellScrollContext, useScrollDirection } from "./scroll";

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
  /** The urgent bar (UrgentBar), under the header on every screen while something urgent waits on the person. */
  alert?: ReactNode;
  /** A fit page: it fills the height and only its panes scroll. */
  fit?: boolean;
  /** Changes when the screen changes (its path): the page scrolls back to the top and the title returns. */
  pageKey?: string;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
  /** Pull to refresh (F28): every read on the screen again, in place. The pin turns until its promise settles. */
  onRefresh?: () => Promise<unknown>;
  /** Pulled on past the second notch: restart the app. A promise it returns settles only if the page stays. */
  onReload?: () => unknown;
}

export function PhoneShell({ header, children, bottomBar, fab, notice, alert, fit = false, pageKey, landmarks = true, onRefresh, onReload }: PhoneShellProps) {
  const Main = landmarks ? "main" : "div";
  const scroller = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState<HTMLElement | null>(null);
  const setScroller = useCallback((el: HTMLElement | null) => {
    scroller.current = el;
    setPage(el);
  }, []);
  const indicator = useRef<HTMLDivElement | null>(null);
  const pull = usePull(page, indicator, { onRefresh, onReload, enabled: !fit });
  const { state, onScroll, reset } = useScrollDirection();
  const [fan, setFan] = useState(false);
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
    reset();
  }, [pageKey, reset]);

  return (
    <ShellScrollContext.Provider value={state}>
      <FanContext.Provider value={setFan}>
        <div data-shell="phone" className="flex h-full min-h-0 flex-col bg-muted">
          {header}
          {alert != null && <div className="flex-none">{alert}</div>}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {onRefresh && !fit && <PullIndicator ref={indicator} state={pull} />}
            <Main
              ref={setScroller}
              data-ui="scroller"
              onScroll={onScroll}
              className={cn("min-h-0 flex-1 overflow-x-hidden overscroll-y-none px-3.5 pt-3.5", fit ? "flex flex-col overflow-y-hidden pb-3.5" : cn("overflow-y-auto", fab ? "pb-24" : "pb-6"))}
            >
              <div data-ui="page" className={cn(fit && "flex min-h-0 flex-1 flex-col")}>
                {children}
              </div>
            </Main>
            {notice != null && <div className={cn("pointer-events-none absolute inset-x-3 flex justify-center *:pointer-events-auto", fab && !fit ? "bottom-22" : "bottom-3")}>{notice}</div>}
            {fab != null && !fit && fan && <div aria-hidden="true" data-fan-scrim="" className="absolute inset-0 animate-rise bg-scrim" />}
            {fab != null && !fit && <div className="pointer-events-none absolute right-4 bottom-4 *:pointer-events-auto">{fab}</div>}
          </div>
          {bottomBar}
        </div>
      </FanContext.Provider>
    </ShellScrollContext.Provider>
  );
}

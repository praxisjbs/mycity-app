/**
 * @component DesktopShell
 * @group Shell
 * @summary The staff app's desktop frame: the rail at the left, the top bar, the module's tab strip and the page, which alone scrolls.
 * @use Once, by the staff app's shell, above 760 px; it lays out the Rail, TopBar, Tabs and the screen it is given. A fit page (a chat, the mailbox) fills the height and only its panes scroll.
 * @avoid A phone (PhoneShell is the phone's own frame, gate 11); a screen laying out its own navigation; the public site (PublicPage).
 * @phone Never shown: at 760 px and below the shell renders PhoneShell instead.
 * @a11y The page is the main landmark (with `landmarks`), marked data-ui="scroller" and data-ui="page" for the screen gates; the rail and the top bar carry their own landmarks and names.
 * @status stable
 * @example <DesktopShell rail={<Rail ... />} topBar={<TopBar ... />} tabs={<Tabs ... />}>{screen}</DesktopShell>
 */
import { useEffect, useState, type ReactNode, type WheelEvent } from "react";
import { cn } from "../lib/cn";

export interface DesktopShellProps {
  /** The Rail. */
  rail: ReactNode;
  /** The TopBar. */
  topBar: ReactNode;
  /** The module's tab strip (Tabs), under the top bar. */
  tabs?: ReactNode;
  /** The screen. */
  children: ReactNode;
  /** A fit page: it fills the height and only its panes scroll; scrolling past a pane's end slides the page's header away. */
  fit?: boolean;
  /** A notice floating at the foot of the page (ShellNotice: the update prompt, the install offer). */
  notice?: ReactNode;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
}

/** The nearest element under the pointer that scrolls vertically, up to (not including) the page. */
function paneOf(target: EventTarget | null, page: HTMLElement): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== page) {
    if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

export function DesktopShell({ rail, topBar, tabs, children, fit = false, notice, landmarks = true }: DesktopShellProps) {
  const Main = landmarks ? "main" : "div";
  const [hideHead, setHideHead] = useState(false);
  useEffect(() => {
    if (!fit) setHideHead(false);
  }, [fit]);

  // On a fit page, scrolling down past a pane's end hides the page header; scrolling up at a pane's top brings it back.
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    if (!fit || Math.abs(e.deltaY) < 4) return;
    const pane = paneOf(e.target, e.currentTarget);
    const top = !pane || pane.scrollTop <= 0;
    const end = !pane || pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    if (e.deltaY > 0 && end && !hideHead) setHideHead(true);
    else if (e.deltaY < 0 && top && hideHead) setHideHead(false);
  };

  return (
    <div data-shell="desktop" className="flex h-full min-h-0">
      {rail}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted">
        {topBar}
        {tabs != null && <div className="flex-none border-b border-border bg-background px-4">{tabs}</div>}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Main
            data-ui="scroller"
            onWheel={onWheel}
            className={cn("min-h-0 flex-1 overflow-x-hidden px-4", fit ? "flex flex-col overflow-y-hidden pb-4" : "overflow-y-auto pt-4.5 pb-11", fit && (hideHead ? "pt-2.5" : "pt-4.5"))}
          >
            <div data-ui="page" className={cn("mx-auto w-full max-w-335", fit && "fit-page flex min-h-0 flex-1 flex-col", hideHead && "hidehead")}>
              {children}
            </div>
          </Main>
          {notice != null && <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center *:pointer-events-auto">{notice}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * @component PhonePage
 * @group Overlays
 * @summary A full-screen page that slides in from the right over the screen on a phone, like a native app's next screen: Back, a title, its own actions, a body that scrolls.
 * @use A place a person goes into and comes back from without leaving the screen they were on: the notification pane, Notification Settings over it.
 * @avoid A form or a record on desktop (use Modal or SidePanel); a short choice (use Sheet); a real screen with its own address (a route).
 * @phone This is its phone form: the whole screen, under the status bar and above the home bar, swiped right or Back to close. On desktop it draws the same page as a panel on the right.
 * @a11y A modal dialog named by `title` (Radix underneath, through Vaul): focus moves in and is trapped, Esc and Back close it, focus returns to the opener. Back is a named button; `actions` are IconButtons with labels.
 * @status beta
 * @example <PhonePage open={open} onClose={close} title="Notifications" actions={<IconButton icon="cog" label="Notification Settings" />}>{rows}</PhonePage>
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "../lib/cn";
import { IconButton } from "../actions/Button";
import { ActionGroup } from "../actions/ActionGroup";
import { focusInto, useReturnFocus } from "./context";

export interface PhonePageProps {
  /** Whether the page is showing. */
  open: boolean;
  /** Called when the person goes back: Back, a swipe to the right, Esc. */
  onClose: () => void;
  /** The page's title, at most 3 words, Title Case. */
  title: ReactNode;
  /** IconButtons at the right of the header (Mark All Read, a gear). */
  actions?: ReactNode;
  /** Something fixed under the header that does not scroll away (a segmented control). */
  bar?: ReactNode;
  /** The body; it scrolls. */
  children?: ReactNode;
  /** Called with the scrolling body, for a list that loads more near its end or pulls to refresh. */
  bodyRef?: (el: HTMLDivElement | null) => void;
  /** Where the page mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
}

export function PhonePage({ open, onClose, title, actions, bar, children, bodyRef, container, bodyClassName }: PhonePageProps) {
  const content = useRef<HTMLDivElement | null>(null);
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  const returnFocus = useReturnFocus(open);

  return (
    <Drawer.Root open={open} onOpenChange={(next) => !next && onClose()} direction="right" repositionInputs={false}>
      <Drawer.Portal container={container ?? undefined}>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Drawer.Content
          ref={content}
          data-ui="modal"
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusInto(content.current, true);
          }}
          onCloseAutoFocus={returnFocus}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background pt-safe pb-safe text-foreground outline-none desk:max-w-md desk:border-l desk:border-border desk:shadow-3"
        >
          <div className="flex flex-none items-center gap-1 border-b border-border bg-card px-1.5 py-1.5">
            <IconButton icon="left" label="Back" onClick={onClose} />
            <Drawer.Title data-ui="title" className="min-w-0 flex-1 truncate text-md font-strong">
              {title}
            </Drawer.Title>
            {actions != null && (
              <span className="flex flex-none items-center gap-0.5">
                <ActionGroup>{actions}</ActionGroup>
              </span>
            )}
          </div>
          {bar != null && <div className="flex-none border-b border-border bg-card px-3 py-2">{bar}</div>}
          <div ref={bodyRef} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

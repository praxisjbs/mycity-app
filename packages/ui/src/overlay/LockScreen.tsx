/**
 * @component LockScreen
 * @group Overlays
 * @summary The full-screen lock over the staff app when a session ends: who is signed in, why it locked, and their password to carry on.
 * @use The staff app's session lock only (the time limit, the idle limit, a session ended elsewhere). The work underneath stays exactly as it was.
 * @avoid Any other prompt (use Modal or useConfirm); the first sign-in (the sign-in screen).
 * @phone Fills the screen the same way: the card sits in 16 px gutters and its buttons stack full width.
 * @a11y Radix Dialog underneath: aria-modal, focus moves to the first field and stays inside, Esc and the backdrop do nothing. It stacks over any dialog already open. The title names it; the reason is its description.
 * @status beta
 * @example <LockScreen open name="Cynthia Osakunih" email="cynthia@mycityapp.io" title="Session Locked" reason="Locked after 30 minutes idle" footer={buttons}>{pinField}</LockScreen>
 */
import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../lib/cn";
import { Avatar } from "../display/Avatar";
import { FooterContext, IN_FOOTER, focusInto } from "./context";

export interface LockScreenProps {
  /** Whether the screen is locked. */
  open: boolean;
  /** The signed-in person's full name. */
  name: string;
  /** Their sign-in email, under the name. */
  email: string;
  /** Their photo, if they have one; the initials otherwise. */
  photo?: string | null;
  /** At most 4 words, Title Case ("Session Locked"). */
  title: string;
  /** Why it locked, one short line ("Locked after 30 minutes idle"). */
  reason: string;
  /** The credential field (in a Form whose id the footer's submit button names). */
  children: ReactNode;
  /** Buttons only, stacked full width down one centred column: the primary (Unlock) and any alternates first, then the way out (Sign Out) in red, set apart below a hairline. */
  footer: ReactNode;
  /** Where it mounts; document.body by default (the gallery passes its frame). */
  container?: HTMLElement | null;
  /** Layout classes for the card only. */
  className?: string;
}

export function LockScreen({ open, name, email, photo, title, reason, children, footer, container, className }: LockScreenProps) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-deep/95 p-4 backdrop-blur-xl">
          <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 size-140 rounded-full glow-primary" />
          <Dialog.Content
            ref={box}
            data-ui="lock-screen"
            aria-modal="true"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              focusInto(box.current, false);
            }}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            className={cn("relative w-full max-w-95 animate-rise rounded-sheet border border-border bg-card p-6 text-card-foreground shadow-3 outline-none", className)}
          >
            <div className="flex flex-col items-center text-center">
              <Avatar name={name} src={photo} size="xl" tone="brand" />
              <Dialog.Title className="mt-4 text-2xl font-strong">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{reason}</Dialog.Description>
              <p className="mt-4 font-semibold">{name}</p>
              <p className="text-sm text-muted-foreground wrap-any">{email}</p>
            </div>
            {children}
            <div data-ui="modal-footer" className="mt-6 flex flex-col gap-2 [&>button]:w-full">
              <FooterContext.Provider value={IN_FOOTER}>{footer}</FooterContext.Provider>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

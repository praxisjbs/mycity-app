/**
 * @component Toaster
 * @group Feedback
 * @summary Where toasts appear: mounted once per app; toast(), toast.success(), toast.error() and toast.info() show one from anywhere, at the bottom; notify() shows a notification's banner at the top.
 * @use The confirmation after an action (Rule created, Leave approved), with Undo where the action can be undone; a failure that has no field to sit on.
 * @avoid A field error (it sits on the field); news a person must act on (use a Banner); a confirmation before acting (use useConfirm); more than 8 words; window.alert (gate 16).
 * @phone Full width at the bottom, above the bottom bar (the shell sets --bottom-bar); swipe to dismiss; the Undo button is a 44 px target.
 * @a11y A polite live region named Notifications, so each toast is announced without moving focus; Undo is a real button reachable from the keyboard. Toasts fade only when motion is allowed.
 * @status stable
 * @example <Toaster />
 * @example toast("Rule created")
 * @example toast.success("Alert cleared", { undo: () => restore(alert) })
 */
import { Toaster as Sonner } from "sonner";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { NOTICES_TOASTER } from "./NotificationBanner";

export interface ToasterProps {
  /** Names this Toaster when a page mounts more than one; toast(text, { toasterId }) then picks it. */
  id?: string;
}

/** Above the phone's bottom bar; the shell publishes its height as --bottom-bar. */
const PHONE = { bottom: "calc(var(--bottom-bar, 64px) + 12px)", left: 12, right: 12 };
const DESKTOP = { bottom: 16, right: 16 };
/** Banners come in at the top: under the phone's status bar, under the desktop top bar. */
const NOTICE_PHONE = { top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: 8, right: 8 };
const NOTICE_DESKTOP = { top: 64, right: 16 };

const CLASSES = {
  toast:
    "flex w-full items-center gap-2.5 rounded-box bg-sidebar px-3.5 py-2.5 text-sm text-sidebar-foreground shadow-3 phone:min-h-tap",
  content: "min-w-0 flex-1",
  title: "font-normal",
  description: "text-xs text-sidebar-muted",
  icon: "flex flex-none items-center",
  actionButton:
    "ml-auto flex-none rounded-ctl px-2.5 py-1.5 text-sm font-semibold text-primary transition-colors duration-(--dur-fast) hover:bg-sidebar-hover phone:min-h-tap",
  cancelButton: "flex-none rounded-ctl px-2.5 py-1.5 text-sm font-semibold text-sidebar-muted hover:bg-sidebar-hover phone:min-h-tap",
  closeButton: "flex size-6 flex-none items-center justify-center rounded-full text-sidebar-muted hover:bg-sidebar-hover",
};

const ICONS = {
  success: <Icon name="ok" className="text-primary" />,
  error: <Icon name="alert" className="text-destructive" />,
  info: <Icon name="info" className="text-sidebar-muted" />,
  warning: <Icon name="alert" className="text-warning" />,
  loading: <Icon name="refresh" className="animate-spin text-sidebar-muted" />,
  close: <Icon name="x" size="s" />,
};

export function Toaster({ id }: ToasterProps) {
  const phone = useIsPhone();
  const offset = phone ? PHONE : DESKTOP;
  return (
    <>
      <Sonner
        id={id}
        position={phone ? "bottom-center" : "bottom-right"}
        offset={offset}
        mobileOffset={PHONE}
        visibleToasts={3}
        gap={8}
        containerAriaLabel="Notifications"
        icons={ICONS}
        toastOptions={{ unstyled: true, classNames: CLASSES }}
      />
      {!id && (
        <Sonner
          id={NOTICES_TOASTER}
          position={phone ? "top-center" : "top-right"}
          offset={phone ? NOTICE_PHONE : NOTICE_DESKTOP}
          mobileOffset={NOTICE_PHONE}
          visibleToasts={3}
          gap={8}
          containerAriaLabel="New Notifications"
          toastOptions={{ unstyled: true, classNames: { toast: "w-full" } }}
        />
      )}
    </>
  );
}

/** The merged name for Toaster; kept so App.tsx moves by an import change. */
export const Toasts = Toaster;

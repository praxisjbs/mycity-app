/**
 * @component ShellNotice
 * @group Shell
 * @summary A small dark card floating at the foot of the shell for something about the app itself: a new version is ready, the app can be installed, the connection is back.
 * @use In the shell's notice slot (DesktopShell, PhoneShell): the update prompt (Reload), the install offer (Install App, Not Now). One at a time.
 * @avoid A result of something the person did (a toast); news about their work (the bell); anything that must interrupt (a ConfirmDialog).
 * @phone Above the floating button and the bottom bar, full width less the margins; its buttons are 44 px.
 * @a11y A status region, announced when it appears and never taking focus; its actions are named buttons, drawn in the dark theme so they keep their contrast on the dark card. At most 12 words.
 * @status stable
 * @example <ShellNotice icon="refresh" actions={<Button variant="primary" size="sm">Reload</Button>}>A new version is ready</ShellNotice>
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon";

export interface ShellNoticeProps {
  /** Its glyph, in the brand yellow. */
  icon?: IconName;
  /** One short line, at most 12 words. */
  children: ReactNode;
  /** One or two small Buttons; the primary last. */
  actions?: ReactNode;
}

export function ShellNotice({ icon = "info", children, actions }: ShellNoticeProps) {
  return (
    <div role="status" data-theme="dark" className="on-dark flex max-w-full animate-rise flex-wrap items-center gap-x-3 gap-y-2 rounded-box bg-sidebar px-4 py-3 text-sm text-sidebar-foreground shadow-3">
      <Icon name={icon} className="flex-none text-primary" />
      <span className="min-w-0 flex-1">{children}</span>
      {actions != null && <span className="flex flex-none flex-wrap items-center gap-2">{actions}</span>}
    </div>
  );
}

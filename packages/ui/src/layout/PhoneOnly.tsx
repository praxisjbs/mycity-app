/**
 * @component PhoneOnly
 * @group Layout
 * @summary Shows its content on a phone only; DesktopOnly shows it on a desktop only. What each shell leaves out is decided per screen.
 * @use The pieces a feature guide's §10 lists for one shell: icon cards on a phone, a chart or an extra column on desktop.
 * @avoid Hiding something by accident of width; the whole page twice (each shell is a layout, not a copy); a table on a phone (DataView draws the card list).
 * @phone PhoneOnly renders at 760 px and below, DesktopOnly at 761 px and above, the same width as useIsPhone() and the gates.
 * @a11y Hidden content is display:none, so it is out of the accessibility tree too. With `unmount` the hidden side is not rendered at all.
 * @status stable
 * @exports DesktopOnly
 * @example <PhoneOnly><IconCards>...</IconCards></PhoneOnly>
 * @example <DesktopOnly unmount><AreaChart /></DesktopOnly>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";

export interface PhoneOnlyProps {
  /** What only a phone shows. */
  children?: ReactNode;
  /** Do not render it at all on desktop (for something heavy); by default it is rendered and hidden with CSS, so there is no flash on first paint. */
  unmount?: boolean;
  /** `span` inside a line of text; `div` otherwise. */
  as?: "div" | "span";
  /** Layout classes only. */
  className?: string;
}

export function PhoneOnly({ children, unmount, as: Comp = "div", className }: PhoneOnlyProps) {
  const phone = useIsPhone();
  if (unmount && !phone) return null;
  return (
    <Comp data-shell="phone" className={cn("desk:hidden", className)}>
      {children}
    </Comp>
  );
}

export interface DesktopOnlyProps {
  /** What only a desktop shows. */
  children?: ReactNode;
  /** Do not render it at all on a phone (for something heavy, such as a chart); by default it is rendered and hidden with CSS. */
  unmount?: boolean;
  /** `span` inside a line of text; `div` otherwise. */
  as?: "div" | "span";
  /** Layout classes only. */
  className?: string;
}

export function DesktopOnly({ children, unmount, as: Comp = "div", className }: DesktopOnlyProps) {
  const phone = useIsPhone();
  if (unmount && phone) return null;
  return (
    <Comp data-shell="desktop" className={cn("phone:hidden", className)}>
      {children}
    </Comp>
  );
}

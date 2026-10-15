/**
 * @component Popover
 * @group Overlays
 * @summary A small panel anchored to the button that opens it: filters, a quick pick, a short preview.
 * @use A few controls that belong to one button (Filters, Columns, a date preset list), a preview that needs no page.
 * @avoid A list of actions (use Menu); a form that saves (use Modal); help text (use HelpTerm, which has its own popover).
 * @phone A bottom sheet titled by `title`, opened by a tap on the same button.
 * @a11y A non-modal dialog named by `title`: focus moves in, Esc or a click outside closes it, focus returns to the button. The button says it has a popup and whether it is open.
 * @status stable
 * @example <Popover title="Filter Leave" trigger={<Button icon="flag">Filters</Button>}>{filters}</Popover>
 */
import { useState, type ReactElement, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Sheet } from "./Sheet";

export interface PopoverProps {
  /** The button that opens it: one element that takes a ref. */
  trigger: ReactElement;
  /** Names the popover, at most 4 words: the sheet's title on a phone and the accessible name on desktop. */
  title: string;
  /** The panel's content, or a function of `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Controlled open state. Leave both unset to let the popover keep its own. */
  open?: boolean;
  /** Called when it opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Which side of the button on desktop. Default `bottom`. */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment along that side. Default `start`. */
  align?: "start" | "center" | "end";
  /** Extra classes for the desktop panel (a width from the scale, such as w-80). */
  className?: string;
  /** Where it mounts; document.body by default. */
  container?: HTMLElement | null;
}

export function Popover({ trigger, title, children, open: openProp, onOpenChange, side = "bottom", align = "start", className, container }: PopoverProps) {
  const phone = useIsPhone();
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);
  const body = typeof children === "function" ? children(close) : children;

  if (phone) {
    return (
      <>
        <Slot aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          {trigger}
        </Slot>
        <Sheet open={open} onClose={close} title={title} container={container}>
          {body}
        </Sheet>
      </>
    );
  }

  return (
    <Radix.Root open={open} onOpenChange={setOpen}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal container={container ?? undefined}>
        <Radix.Content
          aria-label={title}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn("z-50 w-72 animate-rise rounded-box border border-border bg-popover p-3 text-popover-foreground shadow-3 outline-none", className)}
        >
          {body}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

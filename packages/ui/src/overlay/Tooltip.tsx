/**
 * @component Tooltip
 * @group Overlays
 * @summary A small label that appears beside a control on hover or keyboard focus, desktop only.
 * @use A truncated name in full, the words behind an icon-only control that is not an IconButton (IconButton draws its own from its label). Every hover label in the product: never the browser's title attribute (gate 21).
 * @avoid Help or explanation (use HelpTerm); anything a person must read to act; anything on a phone, where there is no hover.
 * @phone Nothing: the child renders alone, since a touch screen has no hover and the control already carries its name.
 * @a11y Opens on hover after a short pause and at once on keyboard focus; Esc closes it; the text is announced as the control's description. The control keeps its own accessible name. It passes a ref and props through to its child, so it can sit inside a Menu or Dialog trigger. Never the browser's own title tooltip (gate 21).
 * @status stable
 * @example <Tooltip label={file.name}><span className="truncate">{file.name}</span></Tooltip>
 */
import { forwardRef, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-tooltip";
import { Slot } from "@radix-ui/react-slot";
import { useIsPhone, useMediaQuery } from "../lib/media";

export interface TooltipProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The words: at most 3 for a control's name, Title Case. */
  label: ReactNode;
  /** The control it labels: one element that takes a ref (a button, an IconButton). */
  children: ReactElement;
  /** Which side of the control. Default `bottom`. */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment along that side. Default `center`. */
  align?: "start" | "center" | "end";
  /** Hover pause before it shows, in ms. Default 300. */
  delay?: number;
  /** Where it mounts; document.body by default. */
  container?: HTMLElement | null;
}

/** Props and a ref given to the Tooltip (a trigger's asChild) pass through to its child. */
export const Tooltip = forwardRef<HTMLElement, TooltipProps>(function Tooltip({ label, children, side = "bottom", align = "center", delay = 300, container, ...rest }, ref) {
  const phone = useIsPhone();
  const touch = useMediaQuery("(hover: none)");
  if (phone || touch) {
    return (
      <Slot {...rest} ref={ref}>
        {children}
      </Slot>
    );
  }
  return (
    <Radix.Provider delayDuration={delay} skipDelayDuration={200}>
      <Radix.Root>
        <Radix.Trigger asChild {...rest} ref={ref as never}>
          {children}
        </Radix.Trigger>
        <Radix.Portal container={container ?? undefined}>
          <Radix.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-xs animate-rise rounded-ctl bg-foreground px-2 py-1 text-xs font-semibold text-background shadow-2"
          >
            {label}
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
    </Radix.Provider>
  );
});

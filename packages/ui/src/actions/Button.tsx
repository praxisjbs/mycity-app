/**
 * @component Button
 * @group Actions
 * @summary The pill button: default, primary (the yellow one), ghost and danger, with an optional icon either side.
 * @use Every action a person takes: Create Rule, Clock In, Export. A link that looks like a button passes asChild with an <a>.
 * @avoid A second primary on one surface (one yellow button per surface); a bare icon (use IconButton); the sign in or clock in call to action (use BigButton).
 * @phone At least 44 px tall; a footer stretches the primary to full width at the bottom.
 * @a11y A native button (type="button" unless set). While busy it stays focusable, says aria-busy and ignores presses. Verb Noun labels, Title Case.
 * @status stable
 * @exports IconButton, BigButton
 * @example <Button variant="primary" icon="plus">New Rule</Button>
 * @example <Button variant="ghost" iconRight="right">View All</Button>
 */
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";

const VARIANT: Record<ButtonVariant, string> = {
  default: "border-input bg-background text-foreground hover:border-subtle-foreground hover:bg-muted",
  primary: "on-primary border-primary bg-primary text-primary-foreground hover:brightness-95",
  ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "border-destructive bg-background text-destructive hover:bg-destructive-soft",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap select-none transition-colors duration-(--dur-fast) ease-out disabled:opacity-40 aria-busy:cursor-progress";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the yellow one, one per surface; `danger` is for destructive actions, confirmed in a dialog. */
  variant?: ButtonVariant;
  /** A glyph before the label. */
  icon?: IconName;
  /** A glyph after the label (a chevron for "View All"). */
  iconRight?: IconName;
  /** `md` follows the density (36 or 40 px); `sm` is 28 px on desktop. Both are 44 px on a phone. */
  size?: "md" | "sm";
  /** Fills the width: the call to action at the foot of a form or page. */
  block?: boolean;
  /** Shows a spinner in place of the icon and ignores presses until the work finishes. */
  busy?: boolean;
  /** Renders the single child element (an <a>, a router Link) with the button's look instead of a <button>. */
  asChild?: boolean;
  /** The label: Verb Noun, Title Case, at most 3 words. */
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", icon, iconRight, size = "md", block, busy, asChild, className, children, type, onClick, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      data-ui="button"
      data-variant={variant}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={press}
      className={cn(
        BASE,
        block ? "h-11 w-full px-4 text-sm" : size === "md" ? "h-control px-3.5 text-sm" : "h-7 px-3 text-xs phone:h-control",
        "phone:min-h-tap",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <LoaderCircle className="size-4 flex-none animate-spin" aria-hidden="true" /> : icon && <Icon name={icon} />}
      <Slottable>{children}</Slottable>
      {iconRight && !busy && <Icon name={iconRight} />}
    </Comp>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** The glyph. */
  icon: IconName;
  /** What the button does, in words: its accessible name and its tooltip. Required. */
  label: string;
  /** `md` follows the density; `sm` is 32 px on desktop. Both are 44 px on a phone. */
  size?: "md" | "sm";
  /** A small red dot for something new (the bell). */
  dot?: boolean;
}

/** A square icon-only button (top bar, panel headers). Its label is required: it is the accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", dot, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      data-ui="button"
      className={cn(
        "relative inline-flex flex-none items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-40",
        size === "md" ? "size-control" : "size-8 phone:size-control",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "md" ? "m" : "s"} />
      {dot && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background bg-destructive" />}
    </button>
  );
});

export interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A glyph after the label. */
  icon?: IconName;
  /** Shows a spinner and ignores presses until the work finishes. */
  busy?: boolean;
}

/** The big yellow call to action, full width (Sign In, Clock In). */
export const BigButton = forwardRef<HTMLButtonElement, BigButtonProps>(function BigButton(
  { className, children, icon, busy, type = "button", onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-ui="button"
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => (busy ? e.preventDefault() : onClick?.(e))}
      className={cn(
        "on-primary mt-5.5 flex h-11.5 w-full items-center justify-center gap-2 rounded-full bg-primary text-md font-strong text-primary-foreground transition duration-(--dur-fast) hover:brightness-95 active:scale-98 disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {children}
      {busy ? <LoaderCircle className="size-4 flex-none animate-spin" aria-hidden="true" /> : icon && <Icon name={icon} />}
    </button>
  );
});

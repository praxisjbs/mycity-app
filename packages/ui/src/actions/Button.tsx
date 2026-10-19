/**
 * @component Button
 * @group Actions
 * @summary The pill button: default, primary (the yellow one), ghost and danger, with an optional icon either side; busy from the press until the work it starts is done.
 * @use Every action a person takes: Create Rule, Clock In, Export. Hand it the work (onClick={save}, an async handler) and it spins and ignores a second press until the work settles. A link that looks like a button passes asChild with an <a>.
 * @avoid A second primary on one surface (one yellow button per surface); a bare icon (use IconButton); the sign in or clock in call to action (use BigButton); throwing the work away (onClick={() => void save()}: the lint refuses it, F26).
 * @phone At least 44 px tall; a footer stretches the primary to full width at the bottom. Busy keeps its size and colour, so nothing beside it moves.
 * @a11y A native button (type="button" unless set). Busy, it keeps its colour, softens, shows a spinner and says aria-busy; it and the buttons in its ActionGroup ignore presses but stay focusable and named (aria-disabled, never disabled). Verb Noun labels, Title Case.
 * @status stable
 * @exports IconButton, BigButton
 * @example <Button variant="primary" icon="plus">New Rule</Button>
 * @example <Button variant="primary" onClick={save}>Save Worksite</Button>
 * @example <Button variant="ghost" iconRight="right">View All</Button>
 */
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Tooltip } from "../overlay/Tooltip";
import { pressState, useElementRef, usePress } from "./press";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";

const VARIANT: Record<ButtonVariant, string> = {
  default: "border-input bg-background text-foreground hover:border-subtle-foreground hover:bg-muted",
  primary: "on-primary border-primary bg-primary text-primary-foreground hover:brightness-95",
  ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "border-destructive bg-background text-destructive hover:bg-destructive-soft",
};

/** Busy softens the button and keeps its colour (the brand yellow stays yellow); waiting dims it further. */
const PRESS = "data-[press=busy]:cursor-progress data-[press=busy]:opacity-75 data-[press=waiting]:cursor-not-allowed data-[press=waiting]:opacity-50";

const BASE = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap select-none transition duration-(--dur-fast) ease-out disabled:opacity-40",
  PRESS,
);

/** What a press may hand back: nothing, or the work it started, which keeps the button busy until it settles. */
export type PressHandler<E> = (e: E) => unknown;

const Spin = ({ className }: { className: string }) => <LoaderCircle className={cn("flex-none animate-spin", className)} aria-hidden="true" />;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
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
  /**
   * The press. Return the work (onClick={save}, or an async handler) and the button is busy from the
   * press until it settles: a spinner, presses ignored, and its ActionGroup waiting with it.
   */
  onClick?: PressHandler<MouseEvent<HTMLButtonElement>>;
  /** Busy by the caller's own measure (a mutation's pending), for work the press does not return. */
  busy?: boolean;
  /** Renders the single child element (an <a>, a router Link) with the button's look instead of a <button>. */
  asChild?: boolean;
  /** The label: Verb Noun, Title Case, at most 3 words. */
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", icon, iconRight, size = "md", block, busy: busyProp, asChild, className, children, type, onClick, ...rest },
  ref,
) {
  const [el, setEl] = useElementRef(ref);
  const { busy, waiting, press } = usePress(onClick, busyProp, el);
  const Comp = asChild ? Slot : "button";
  // The spinner takes the place of the leading icon, else the trailing one; a button with neither
  // spins over its label, which stays (unseen, still its name) so the button keeps its width.
  // A link drawn as a button (asChild) has no box of its own to spin over: it leads with the spinner.
  const bare = busy && !icon && !iconRight;
  const over = bare && !asChild;
  const spin = <Spin className="size-4" />;
  return (
    <Comp
      ref={setEl}
      type={asChild ? undefined : (type ?? "button")}
      data-ui="button"
      data-variant={variant}
      data-press={pressState({ busy, waiting })}
      aria-busy={busy || undefined}
      aria-disabled={busy || waiting || undefined}
      onClick={press}
      className={cn(
        BASE,
        over && "relative",
        block ? "h-11 w-full px-4 text-sm" : size === "md" ? "h-control px-3.5 text-sm" : "h-7 px-3 text-xs phone:h-control",
        "phone:min-h-tap",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon && (busy ? spin : <Icon name={icon} />)}
      {bare && asChild && spin}
      <Slottable>{over ? <span className="opacity-0">{children}</span> : children}</Slottable>
      {iconRight && (busy && !icon ? spin : <Icon name={iconRight} />)}
      {over && <span className="absolute inset-0 flex items-center justify-center">{spin}</span>}
    </Comp>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "onClick"> {
  /** The glyph. */
  icon: IconName;
  /** What the button does, in words: its accessible name and its tooltip. Required. */
  label: string;
  /** `md` follows the density; `sm` is 32 px on desktop. Both are 44 px on a phone. */
  size?: "md" | "sm";
  /** A small red dot for something new (the bell). */
  dot?: boolean;
  /** The press. Return the work and the glyph turns to a spinner until it settles, presses ignored meanwhile. */
  onClick?: PressHandler<MouseEvent<HTMLButtonElement>>;
  /** Busy by the caller's own measure, for work the press does not return. */
  busy?: boolean;
}

/** A square icon-only button (top bar, panel headers). Its label is required: it is the accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", dot, busy: busyProp, className, type = "button", onClick, ...rest },
  ref,
) {
  const [el, setEl] = useElementRef(ref);
  const { busy, waiting, press } = usePress(onClick, busyProp, el);
  return (
    <Tooltip label={label}>
      <button
        ref={setEl}
        type={type}
        aria-label={label}
        data-ui="button"
        data-press={pressState({ busy, waiting })}
        aria-busy={busy || undefined}
        aria-disabled={busy || waiting || undefined}
        onClick={press}
        className={cn(
          "relative inline-flex flex-none items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-40",
          PRESS,
          size === "md" ? "size-control" : "size-8 phone:size-control",
          className,
        )}
        {...rest}
      >
        {busy ? <Spin className={size === "md" ? "size-5" : "size-4"} /> : <Icon name={icon} size={size === "md" ? "m" : "s"} />}
        {dot && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background bg-destructive" />}
      </button>
    </Tooltip>
  );
});

export interface BigButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** A glyph after the label. */
  icon?: IconName;
  /** The press. Return the work and it spins until the work settles, presses ignored meanwhile. */
  onClick?: PressHandler<MouseEvent<HTMLButtonElement>>;
  /** Busy by the caller's own measure (a sign-in form's submit). */
  busy?: boolean;
}

/** The big yellow call to action, full width (Sign In, Clock In). */
export const BigButton = forwardRef<HTMLButtonElement, BigButtonProps>(function BigButton(
  { className, children, icon, busy: busyProp, type = "button", onClick, ...rest },
  ref,
) {
  const [el, setEl] = useElementRef(ref);
  const { busy, waiting, press } = usePress(onClick, busyProp, el);
  return (
    <button
      ref={setEl}
      type={type}
      data-ui="button"
      data-press={pressState({ busy, waiting })}
      aria-busy={busy || undefined}
      aria-disabled={busy || waiting || undefined}
      onClick={press}
      className={cn(
        "on-primary mt-5.5 flex h-11.5 w-full items-center justify-center gap-2 rounded-full bg-primary text-md font-strong text-primary-foreground transition duration-(--dur-fast) hover:brightness-95 active:scale-98 disabled:opacity-60",
        PRESS,
        className,
      )}
      {...rest}
    >
      {children}
      {busy ? <Spin className="size-4" /> : icon && <Icon name={icon} />}
    </button>
  );
});

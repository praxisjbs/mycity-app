import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";

type Variant = "default" | "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  iconRight?: IconName;
  size?: "md" | "sm";
  /** Saving: clicks are ignored, but the button stays enabled and reachable (§8.3: Submit is never disabled). */
  busy?: boolean;
  children?: ReactNode;
}

/** The pill button. `primary` is the yellow one: one per surface. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", icon, iconRight, size = "md", busy, className, children, type = "button", onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-ui="button"
      aria-busy={busy || undefined}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-[background,border-color,filter] disabled:opacity-40 aria-busy:cursor-progress aria-busy:opacity-70",
        size === "md" ? "h-[34px] px-[13px] text-[12.5px]" : "h-7 px-[11px] text-[11.5px]",
        "max-md:h-auto max-md:min-h-11",
        variant === "primary" && "on-primary border-primary bg-primary text-primary-foreground hover:brightness-[.96]",
        variant === "default" && "border-input bg-background hover:border-subtle-foreground hover:bg-muted",
        variant === "ghost" && "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
});

/** Square icon button with a tooltip label (top bar, panel headers). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: "md" | "sm"; dot?: boolean }>(
  function IconButton({ icon, label, size = "md", dot, className, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        title={label}
        aria-label={label}
        className={cn(
          "relative flex items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          size === "md" ? "size-9" : "size-8",
          "max-md:size-11",
          className,
        )}
        {...rest}
      >
        <Icon name={icon} size={size === "md" ? "m" : "s"} />
        {dot && <i className="absolute top-[7px] right-[7px] size-[7px] rounded-full border-2 border-background bg-destructive" />}
      </button>
    );
  },
);

/** The big yellow call to action (sign in, clock in). */
export function BigButton({ className, children, icon, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) {
  return (
    <button
      className={cn(
        "on-primary mt-[22px] flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-[650] text-primary-foreground transition-[transform,filter] hover:brightness-[.96] active:scale-[.985] disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {children}
      {icon && <Icon name={icon} />}
    </button>
  );
}

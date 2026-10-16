/**
 * @component Brand
 * @group Shell
 * @summary The MyCity pin mark, alone or with the name beside it, in the brand colours of the surface it sits on.
 * @use The top of the desktop rail, the phone top bar (the pin alone), the sign-in splash and the public site's header.
 * @avoid An icon inside a button or a list (use Icon name="pin"); a document or a letterhead (documents carry the full logo).
 * @phone The pin alone in the phone top bar, at 24 px; with the name on the public site and the sign-in screen.
 * @a11y An image named "MyCity App" (or `label`) when it stands alone; with the name shown, the drawing is decorative and the name is read.
 * @status stable
 * @example <Brand />
 * @example <Brand name="MyCityApp" size="m" />
 * @example <Brand tone="on-dark" size="xl" />
 */
import { cn } from "../lib/cn";

export interface BrandProps {
  /** `s` 20 px, `m` 24 px (the default: top bars), `l` 32 px, `xl` 56 px (the splash). */
  size?: "s" | "m" | "l" | "xl";
  /** The name beside the pin ("MyCityApp", "MyCity App"); the pin alone when left out. */
  name?: string;
  /** `auto`: City Green on a light surface, the yellow in the dark theme; `on-dark`: the yellow on the Deep Green rail or splash. */
  tone?: "auto" | "on-dark";
  /** The accessible name when the pin stands alone. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

const BOX = { s: "size-5", m: "size-6", l: "size-8", xl: "size-14" } as const;
const TEXT = { s: "text-base", m: "text-md", l: "text-xl", xl: "text-3xl" } as const;

/** The pin from the logo: the drop with its hole cut out (even-odd), on a 24 px grid. */
const PIN = "M12 1.6c-4.2 0-7.6 3.4-7.6 7.6 0 5.7 7.6 13.2 7.6 13.2s7.6-7.5 7.6-13.2c0-4.2-3.4-7.6-7.6-7.6zM12 5.3a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 1 0 0-4.6z";

export function Brand({ size = "m", name, tone = "auto", label = "MyCity App", className }: BrandProps) {
  const fill = tone === "on-dark" ? "fill-primary" : "fill-secondary dark:fill-primary";
  const pin = (
    <svg
      viewBox="0 0 24 24"
      className={cn("flex-none", BOX[size], fill)}
      {...(name ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      focusable="false"
    >
      <path d={PIN} fillRule="evenodd" />
    </svg>
  );
  if (!name) return <span className={cn("inline-flex", className)}>{pin}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {pin}
      <b className={cn("font-strong tracking-tight whitespace-nowrap", TEXT[size], tone === "on-dark" ? "text-sidebar-foreground" : "text-foreground")}>{name}</b>
    </span>
  );
}

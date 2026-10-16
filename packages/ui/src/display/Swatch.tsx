/**
 * @component Swatch
 * @group Display
 * @summary A square of one palette token's colour, beside its name and its value.
 * @use Settings · Appearance, where a person checks the brand's own palette in the theme they are in.
 * @avoid Showing a colour a screen chose rather than a token; a swatch of a colour nobody can name.
 * @phone The same square at the same size; the name and value wrap beside it.
 * @a11y Decorative: the token's name and its value are words beside the square, so the colour is never the only thing said.
 * @status stable
 * @example <Swatch token="--primary" />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

export interface SwatchProps {
  /** The token, as it is written in tokens.css (`--primary`, `--chart-1`). */
  token: string;
  /** `md` (30 px, the default) or `sm` (24 px), for a denser list. */
  size?: "sm" | "md";
  /** Layout classes only (spacing). */
  className?: string;
}

const SIZE = { sm: "size-6 rounded-ctl", md: "size-7.5 rounded-box" } as const;

export function Swatch({ token, size = "md", className }: SwatchProps) {
  return (
    <i
      aria-hidden="true"
      /* The one runtime value is which token to show, as a variable the class reads. */
      style={{ "--swatch": `var(${token})` } as CSSProperties}
      className={cn("block flex-none border border-border bg-(--swatch)", SIZE[size], className)}
    />
  );
}

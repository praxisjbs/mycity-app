/**
 * @component Skeleton
 * @group Display
 * @summary A shimmering placeholder in the shape of what is loading: lines of text, a block or a circle; Spinner is the small turning ring for a wait with no shape.
 * @use Skeleton while a card, a list or a page loads, so the layout does not jump when the data lands; Spinner inside a small area that is waiting (a sheet's body, beside a label).
 * @avoid A Spinner for a whole page or list (use Skeleton); a Spinner inside a Button (Button has busy); either one after the data has failed (use the error state).
 * @phone The same shapes, full width.
 * @a11y Skeleton lines and Spinner are a status region named "Loading" (or the label given); a single Skeleton shape is decorative, so a group of them should sit in one labelled Skeleton or a container with aria-busy. Under reduced motion neither moves.
 * @status stable
 * @exports Spinner
 * @example <Skeleton lines={4} />
 * @example <Skeleton shape="circle" className="size-8" />
 * @example <Spinner label="Loading payslips" />
 */
import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";

/* Varied widths so lines read as text, from the fraction scale (no arbitrary values). */
const WIDTHS = ["w-3/4", "w-full", "w-11/12", "w-1/2", "w-5/6"];

export interface SkeletonProps {
  /** A number of text lines, as a status region; leave unset for one shape sized by className. */
  lines?: number;
  /** One shape: `line` (a text line, the default), `block` (a card or an image), `circle` (an avatar). */
  shape?: "line" | "block" | "circle";
  /** What assistive technology hears while lines load; "Loading" unless set. */
  label?: string;
  /** Size and spacing for a single shape (h-24, size-8, w-40). */
  className?: string;
}

const SHAPE = { line: "h-3.5 w-full rounded-full", block: "h-24 w-full rounded-box", circle: "size-8 rounded-full" } as const;

export function Skeleton({ lines, shape = "line", label = "Loading", className }: SkeletonProps) {
  if (lines != null) {
    return (
      <div role="status" aria-label={label} aria-busy="true" className={cn("flex flex-col gap-3", className)}>
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <span key={i} data-skeleton="" className={cn("block h-3.5 animate-pulse rounded-full bg-muted", WIDTHS[i % WIDTHS.length])} />
        ))}
      </div>
    );
  }
  return <span aria-hidden="true" data-skeleton="" className={cn("block animate-pulse bg-muted", SHAPE[shape], className)} />;
}

export interface SpinnerProps {
  /** `s` 16 px (the default), `m` 20 px, `l` 24 px. */
  size?: "s" | "m" | "l";
  /** What assistive technology hears; "Loading" unless set. */
  label?: string;
  /** Layout classes, or a token text colour. */
  className?: string;
}

const SPIN = { s: "size-4", m: "size-5", l: "size-6" } as const;

/** A small turning ring for a short wait in a small area. */
export function Spinner({ size = "s", label = "Loading", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center text-muted-foreground", className)}>
      <LoaderCircle aria-hidden="true" className={cn("flex-none animate-spin", SPIN[size])} strokeWidth={1.75} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * @component LinkCard
 * @group Display
 * @summary A link's card, as on WhatsApp: the page's picture, the site, the title and a line of its description, opening the page.
 * @use The first link of a chat message, under its text; the composer's card while a message with a link is written, with Remove Preview.
 * @avoid A link the product makes itself (a Button or a router Link); a mail's links (EmailFrame keeps them); a card for every link in a message (only the first gets one).
 * @phone The same card, the width of its bubble: a wide picture runs across its top, a small or square one sits at its side; the whole card is the tap target.
 * @a11y The card is one link named by the page's title that says it opens a new tab; the picture is decorative beside the title; Remove Preview is a named button; a loading card says so.
 * @status beta
 * @example <LinkCard href="https://nfelia.com/" title="Nfelia: Fashion in Lagos" site="Nfelia" description="Shop the latest." image={src} imageWidth={1200} imageHeight={630} hasImage />
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn";
import { hostOf } from "../lib/links";
import { useSeen } from "../lib/seen";
import { IconButton } from "../actions/Button";
import { Skeleton } from "./Skeleton";

export interface LinkCardProps {
  /** Where the card opens: the link as posted. */
  href: string;
  /** The page's title. */
  title?: string;
  /** The site, as the page names itself, else its host. */
  site?: string;
  /** A line of the page's description, when it has one. */
  description?: string | null;
  /** The page's picture, ready to draw (fetched with the session); null while it loads. */
  image?: string | null;
  /** Whether the card has a picture at all, so its place is kept while it loads. */
  hasImage?: boolean;
  /** The picture's width in pixels: a wide one runs across the top. */
  imageWidth?: number | null;
  /** The picture's height in pixels. */
  imageHeight?: number | null;
  /** The composer's card while the page is read: its shape, shimmering. */
  loading?: boolean;
  /** The composer's card: a card that does not open, with Remove Preview. */
  onRemove?: () => void;
  /** Where it sits: in the sender's own bubble, in another's, or on the page (the composer). */
  tone?: "mine" | "theirs" | "plain";
  /** Called once when the card first comes near the screen, so its picture is fetched only then. */
  onSeen?: () => void;
  /** Layout classes only (spacing, width). */
  className?: string;
}

/** A picture this wide, and at least this much wider than tall, runs across the card. */
const WIDE_MIN_PX = 400;
const WIDE_MIN_RATIO = 1.3;

const TONE = {
  mine: "border-l-primary bg-white/10",
  theirs: "border-l-secondary bg-black/5",
  plain: "border-l-secondary border-y border-r border-border bg-muted",
} as const;

export function LinkCard({
  href,
  title,
  site,
  description,
  image,
  hasImage,
  imageWidth,
  imageHeight,
  loading,
  onRemove,
  tone = "theirs",
  onSeen,
  className,
}: LinkCardProps) {
  const seen = useSeen<HTMLElement>(onSeen);
  const ratio = imageWidth && imageHeight ? imageWidth / imageHeight : null;
  const wide = Boolean(ratio && imageWidth && imageWidth >= WIDE_MIN_PX && ratio >= WIDE_MIN_RATIO);
  const picture = hasImage || image ? (image ? <img src={image} alt="" className="size-full object-cover" /> : <span className="block size-full animate-pulse bg-black/10" />) : null;

  const words: ReactNode = loading ? (
    <span className="flex flex-col gap-1.5 py-0.5" aria-label="Loading the link's card" role="status">
      <Skeleton className="w-2/5" />
      <Skeleton className="w-4/5" />
      <Skeleton className="w-3/5" />
    </span>
  ) : (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-2xs font-strong opacity-80">{site || hostOf(href)}</span>
      <span className="line-clamp-2 text-sm font-strong leading-snug">{title}</span>
      {description && <span className="line-clamp-2 text-xs leading-snug opacity-80">{description}</span>}
      <span className="truncate text-2xs opacity-70">{hostOf(href)}</span>
    </span>
  );

  const body = (
    <>
      {picture && wide && (
        <span
          style={{ "--ratio": String(Math.min(2, ratio ?? 1.91)) } as CSSProperties}
          className="block aspect-(--ratio) w-full overflow-hidden"
        >
          {picture}
        </span>
      )}
      <span className="flex items-start gap-2.5 p-2.5">
        {picture && !wide && <span className="size-16 flex-none overflow-hidden rounded-ctl bg-muted">{picture}</span>}
        <span className="min-w-0 flex-1">{words}</span>
        {onRemove && (
          <IconButton icon="x" label="Remove Preview" size="sm" className="-mt-1 -mr-1.5 flex-none" onClick={onRemove} />
        )}
      </span>
    </>
  );

  const frame = cn("block w-full max-w-80 overflow-hidden rounded-box border-l-2 text-left", TONE[tone], className);
  if (onRemove || loading) {
    return (
      <span ref={seen} data-copy="content" className={frame}>
        {body}
      </span>
    );
  }
  return (
    <a ref={seen} href={href} target="_blank" rel="noopener noreferrer" data-copy="content" className={cn(frame, "hover:opacity-90")}>
      {body}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

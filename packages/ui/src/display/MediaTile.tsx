/**
 * @component MediaTile
 * @group Display
 * @summary A photo, a video's first frame or a file, drawn in place at its own shape before it has loaded; MediaAlbum puts four or more side by side, two by two.
 * @use A photo or a video in a chat message, an album of them sent together, the picks in Send Files, a conversation's shared files on a profile.
 * @avoid A document someone needs to read (FileCard opens it); a picture to inspect closely in a page (ImageViewer); decoration (Illustration).
 * @phone The bubble's own width (256 px), its height from the picture's shape, a very tall or very wide one cropped to fit; the whole tile is the tap target.
 * @a11y Each tile is a button named Open with the file's name; a video says it is one and how long; "+N" is read as how many more; Remove is a named button. The picture itself is decorative beside that name.
 * @status beta
 * @exports MediaAlbum
 * @example <MediaTile src={src} alt="Set.jpg" width={1600} height={1200} onOpen={open} />
 * @example <MediaAlbum tiles={photos.map((p) => ({ key: p.id, src: p.src, alt: p.name }))} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import { useSeen } from "../lib/seen";
import { IconButton } from "../actions/Button";
import { Icon, type IconName } from "../icons/Icon";

export interface MediaTileProps {
  /** The picture, ready to draw (fetched with the session): a photo's 960 px size, a video's poster; null while it loads or when there is none. */
  src: string | null;
  /** The file's name: what the tile is, in words. */
  alt: string;
  /** The picture's width, so its place is kept before it loads; a square when unknown. */
  width?: number | null;
  /** The picture's height. */
  height?: number | null;
  /** A photo, a video (a play mark and its length over it), or another file (its glyph and name). */
  kind?: "photo" | "video" | "file";
  /** The glyph of another file (`doc`, `sheet`, `slides`). */
  glyph?: IconName;
  /** A video's length as it is read ("0:42"). */
  duration?: string | null;
  /** How many more an album holds past this, its fourth tile: "+N" over it. */
  more?: number;
  /** In a bubble at its own shape, or a square tile (an album, a grid of picks). */
  fit?: "bubble" | "square";
  /** Opens it full screen. */
  onOpen?: () => void;
  /** Takes it out (Send Files): a small X in its corner. */
  onRemove?: () => void;
  /** Called once when it first comes near the screen, so its picture is fetched only then. */
  onSeen?: () => void;
  /** Layout classes only (spacing). */
  className?: string;
}

/** How far a photo in a bubble may be from square before it is cropped: 4:5 tall, 2:1 wide. */
const TALLEST = 0.8;
const WIDEST = 2;

const name = (kind: MediaTileProps["kind"], alt: string, duration?: string | null) =>
  kind === "video" ? `Open video ${alt}${duration ? `, ${duration}` : ""}` : `Open ${alt}`;

export function MediaTile({
  src,
  alt,
  width,
  height,
  kind = "photo",
  glyph,
  duration,
  more,
  fit = "bubble",
  onOpen,
  onRemove,
  onSeen,
  className,
}: MediaTileProps) {
  const seen = useSeen<HTMLSpanElement>(onSeen);
  const ratio = width && height ? Math.min(WIDEST, Math.max(TALLEST, width / height)) : 1;
  const square = fit === "square";
  const label = more ? `${name(kind, alt, duration)}, and ${more} more` : name(kind, alt, duration);

  return (
    <span
      ref={seen}
      style={square ? undefined : ({ "--ratio": String(ratio) } as CSSProperties)}
      className={cn(
        "relative block overflow-hidden bg-muted",
        square ? "aspect-square w-full" : "aspect-(--ratio) w-72 max-w-full rounded-box phone:w-64",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="absolute inset-0 flex size-full items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {src ? (
          <img src={src} alt="" className="size-full object-cover" />
        ) : kind === "file" ? (
          <span className="flex max-w-full flex-col items-center gap-1 px-2 text-center text-muted-foreground">
            <Icon name={glyph ?? "doc"} size="l" />
            <span data-copy="content" className="line-clamp-2 text-2xs break-all">{alt}</span>
          </span>
        ) : (
          <span aria-hidden="true" className={cn("absolute inset-0", kind === "video" ? "bg-deep" : "animate-pulse bg-black/10")} />
        )}
        {kind === "video" && !more && (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-deep/60 text-on-deep">
              <Icon name="play" size="l" />
            </span>
          </span>
        )}
        {kind === "video" && duration && !more && (
          <span aria-hidden="true" className="absolute bottom-1.5 left-1.5 rounded-full bg-deep/60 px-1.5 py-0.5 text-2xs text-on-deep">
            {duration}
          </span>
        )}
        {more ? (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-deep/60 text-2xl font-bold text-on-deep">
            +{more}
          </span>
        ) : null}
      </button>
      {onRemove && (
        <IconButton
          icon="x"
          label={`Remove ${alt}`}
          size="sm"
          className="absolute top-1 right-1 bg-deep/60 text-on-deep hover:bg-deep hover:text-on-deep"
          onClick={onRemove}
        />
      )}
    </span>
  );
}

export interface MediaAlbumProps {
  /** The photos and videos sent together, in order; four or more. */
  tiles: Array<Omit<MediaTileProps, "fit" | "more" | "className"> & { key: string }>;
  /** Layout classes only (spacing). */
  className?: string;
}

/** Four or more photos sent together: two by two, the fourth carrying how many more there are. */
export function MediaAlbum({ tiles, className }: MediaAlbumProps) {
  const shown = tiles.slice(0, 4);
  const more = tiles.length - shown.length;
  return (
    <span role="group" aria-label={`${tiles.length} photos`} className={cn("grid w-72 max-w-full grid-cols-2 gap-0.5 overflow-hidden rounded-box phone:w-64", className)}>
      {shown.map(({ key, ...tile }, i) => (
        <MediaTile key={key} {...tile} fit="square" more={i === 3 && more > 0 ? more : undefined} />
      ))}
    </span>
  );
}

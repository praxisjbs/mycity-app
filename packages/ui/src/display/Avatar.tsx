/**
 * @component Avatar
 * @group Display
 * @summary A person's photo, or their initials in a round chip when there is none, with an optional presence dot; Who is the avatar with the name and a second line.
 * @use Beside a person's name in a list, a card, a chat, a record header (Who for the name and role together).
 * @avoid An organisation's logo; a stack of avatars with no names and no label; a decorative picture.
 * @phone The same sizes; `md` and up in lists so the row reaches 44 px.
 * @a11y Decorative (hidden) beside a visible name. Standalone, pass label (the person's name): it becomes an image with that name, and its presence is said too. Who marks the name as content.
 * @status stable
 * @exports Who
 * @example <Avatar name="Cynthia Osakunih" presence="online" />
 * @example <Who name="Tobi Adeyemi" role="Field Sales, Lekki" />
 */
import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { initials } from "../lib/format";

/** The named sizes: xs 20 px, sm 28 px (the default), md 32 px, lg 40 px, xl 48 px, 2xl 72 px (a profile header). */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/** Whether the person is here: online (green), away (amber), busy (red), offline (grey ring). */
export type Presence = "online" | "away" | "busy" | "offline";

const SIZE: Record<AvatarSize, string> = {
  xs: "size-5 text-2xs",
  sm: "size-7 text-2xs",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-12 text-lg",
  "2xl": "size-18 text-3xl",
};
const DOT: Record<AvatarSize, string> = { xs: "size-2", sm: "size-2.5", md: "size-2.5", lg: "size-3", xl: "size-3.5", "2xl": "size-3.5" };
const PRESENCE: Record<Presence, string> = { online: "bg-success", away: "bg-warning", busy: "bg-destructive", offline: "bg-muted-foreground" };
const PRESENCE_WORD: Record<Presence, string> = { online: "Online", away: "Away", busy: "Busy", offline: "Offline" };

/** A merged pixel size (21, 27, 32, 42) to the nearest named size. */
function sizeOf(size: AvatarSize | number): AvatarSize {
  if (typeof size === "string") return size;
  if (size <= 23) return "xs";
  if (size <= 29) return "sm";
  if (size <= 35) return "md";
  if (size <= 43) return "lg";
  if (size <= 60) return "xl";
  return "2xl";
}

export interface AvatarProps {
  /** The person's full name; the initials come from it. */
  name: string;
  /** A photo URL (the person's profile picture). The initials show while it loads or if it fails. */
  src?: string | null;
  /** A named size, or a merged pixel size (27, 32, 42), which takes the nearest named one. */
  size?: AvatarSize | number;
  /** `soft` (the default) is the accent chip; `brand` is the yellow one, for the signed-in person. */
  tone?: "soft" | "brand";
  /** A presence dot at the lower right. */
  presence?: Presence;
  /** The merged flag for presence="online"; kept so screens move by an import change. */
  online?: boolean;
  /** The person's name for assistive technology, when no visible name sits beside the avatar. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Avatar({ name, src, size = "sm", tone = "soft", presence, online, label, className }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const s = sizeOf(size);
  const state = presence ?? (online ? "online" : undefined);
  const photo = src && failed !== src ? src : null;
  const a11y = label
    ? { role: "img" as const, "aria-label": state ? `${label}, ${PRESENCE_WORD[state]}` : label }
    : { "aria-hidden": true as const };
  return (
    <span
      data-avatar=""
      className={cn(
        "relative inline-flex flex-none items-center justify-center rounded-full font-strong select-none",
        SIZE[s],
        tone === "brand" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        className,
      )}
      {...a11y}
    >
      {photo ? (
        <img src={photo} alt="" className="size-full rounded-full object-cover" onError={() => setFailed(photo)} />
      ) : (
        initials(name)
      )}
      {state && (
        <span
          data-presence={state}
          className={cn("absolute -right-px -bottom-px rounded-full border-2 border-card", DOT[s], PRESENCE[state], state === "offline" && "bg-card ring-1 ring-muted-foreground ring-inset")}
        />
      )}
    </span>
  );
}

export interface WhoProps {
  /** The person's full name, shown and used for the initials. */
  name: string;
  /** The second line: role, department or place (Field Sales, Lekki). */
  role?: ReactNode;
  /** The merged name for `role`; kept so screens move by an import change. */
  sub?: ReactNode;
  /** The person's photo URL. */
  src?: string | null;
  /** The avatar's size; sm (28 px) unless set. Merged pixel sizes are accepted. */
  size?: AvatarSize | number;
  /** The avatar's presence dot; also said to assistive technology. */
  presence?: Presence;
  /** Layout classes only (spacing). */
  className?: string;
}

/** Avatar, name and a second line. The name and the line are the person's data (data-copy="content"). */
export function Who({ name, role, sub, src, size = "sm", presence, className }: WhoProps) {
  const line = role ?? sub;
  return (
    <span data-copy="content" className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar name={name} src={src} size={size} presence={presence} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {line != null && line !== "" && <span className="block truncate text-2xs text-muted-foreground">{line}</span>}
        {presence && <span className="sr-only">{PRESENCE_WORD[presence]}</span>}
      </span>
    </span>
  );
}

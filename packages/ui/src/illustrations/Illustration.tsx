/**
 * @component Illustration
 * @group Display
 * @summary A small line drawing in the theme's colours, for empty states, first run, results and the clock prompts.
 * @use Inside EmptyState (by name), on a first-run page, beside a success or recoverable error result, on the Clock In and Clock Out prompts.
 * @avoid A data screen that has data on it; decoration for its own sake; a drawing that repeats what the words already say. Never a picture with text in it.
 * @phone The same drawing; EmptyState draws it at the smaller size on a phone.
 * @a11y Decorative (aria-hidden) by default, because the title beside it says the same. Pass label only when the drawing stands alone and carries meaning.
 * @status beta
 * @exports EmptyIllustration, SearchIllustration, SuccessIllustration, ErrorIllustration, LockedIllustration, OfflineIllustration, FirstRunIllustration, ClockInIllustration, ClockOutIllustration
 * @example <Illustration name="Empty" />
 * @example <ClockInIllustration size="l" />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** The drawings, by the name EmptyState and the screens use. */
export type IllustrationName = "Empty" | "Search" | "Success" | "Error" | "Locked" | "Offline" | "FirstRun" | "ClockIn" | "ClockOut";

/** How big the drawing is: `s` 72 px wide, `m` 96 px (the default), `l` 128 px. */
export type IllustrationSize = "s" | "m" | "l";

const SIZE: Record<IllustrationSize, string> = { s: "w-18", m: "w-24", l: "w-32" };

/*
 * Every stroke and fill is a token: the lines take currentColor (the caller's
 * text colour, muted by default), the soft shapes take --accent and --muted, the
 * one highlight takes --primary or a status colour. No colour is written here.
 */
const LINE = "fill-none stroke-current";
const SOFT = "fill-accent";
const GROUND = "fill-muted";

/** The shared ground every drawing stands on. */
const Ground = () => <ellipse className={GROUND} cx="60" cy="84" rx="44" ry="6" />;

const ART: Record<IllustrationName, () => ReactNode> = {
  Empty: () => (
    <>
      <Ground />
      <path className={SOFT} d="M30 44h60v34a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4z" />
      <path className={LINE} d="M30 44h60v34a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4zM30 44l10-16h40l10 16M48 44a12 8 0 0 0 24 0" />
      <path className="fill-none stroke-primary" d="M60 10v8M46 14l4 6M74 14l-4 6" />
    </>
  ),
  Search: () => (
    <>
      <Ground />
      <circle className={SOFT} cx="54" cy="44" r="22" />
      <circle className={LINE} cx="54" cy="44" r="22" />
      <path className={LINE} d="M70 60l18 18M44 40a10 10 0 0 1 10-8" />
      <path className="fill-none stroke-primary" d="M88 78l4 4" />
    </>
  ),
  Success: () => (
    <>
      <Ground />
      <circle className="fill-success-soft" cx="60" cy="44" r="28" />
      <circle className={LINE} cx="60" cy="44" r="28" />
      <path className="fill-none stroke-success" d="M47 45l9 9 18-20" />
      <path className="fill-none stroke-primary" d="M22 22l4 4M98 22l-4 4M60 8v6" />
    </>
  ),
  Error: () => (
    <>
      <Ground />
      <path className="fill-destructive-soft" d="M60 14l34 60H26z" />
      <path className={LINE} d="M60 14l34 60H26z" />
      <path className="fill-none stroke-destructive" d="M60 36v18M60 62v2" />
    </>
  ),
  Locked: () => (
    <>
      <Ground />
      <path className={SOFT} d="M36 42h48v34a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4z" />
      <path className={LINE} d="M36 42h48v34a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4zM46 42V30a14 14 0 0 1 28 0v12" />
      <circle className="fill-primary" cx="60" cy="58" r="4" />
      <path className={LINE} d="M60 62v8" />
    </>
  ),
  Offline: () => (
    <>
      <Ground />
      <path className={SOFT} d="M34 66a14 14 0 0 1 2-28 20 20 0 0 1 38-4 16 16 0 0 1 12 32z" />
      <path className={LINE} d="M34 66a14 14 0 0 1 2-28 20 20 0 0 1 38-4 16 16 0 0 1 12 32z" />
      <path className="fill-none stroke-destructive" d="M28 22l64 56" />
    </>
  ),
  FirstRun: () => (
    <>
      <Ground />
      <path className={SOFT} d="M60 12c12 10 16 26 12 44H48c-4-18 0-34 12-44z" />
      <path className={LINE} d="M60 12c12 10 16 26 12 44H48c-4-18 0-34 12-44zM48 56l-8 10h12M72 56l8 10H68" />
      <circle className="fill-primary" cx="60" cy="34" r="5" />
      <path className="fill-none stroke-primary" d="M54 66l2 10M66 66l-2 10M60 66v12" />
    </>
  ),
  ClockIn: () => (
    <>
      <Ground />
      <circle className={SOFT} cx="56" cy="46" r="28" />
      <circle className={LINE} cx="56" cy="46" r="28" />
      <path className={LINE} d="M56 30v16l10 6" />
      <circle className="fill-success" cx="86" cy="70" r="10" />
      <path className="fill-none stroke-card" d="M81 70l4 4 7-8" />
    </>
  ),
  ClockOut: () => (
    <>
      <Ground />
      <circle className={SOFT} cx="56" cy="46" r="28" />
      <circle className={LINE} cx="56" cy="46" r="28" />
      <path className={LINE} d="M56 30v16l-10 6" />
      <circle className="fill-primary" cx="86" cy="70" r="10" />
      <path className="fill-none stroke-primary-foreground" d="M82 70h8M87 66l4 4-4 4" />
    </>
  ),
};

/** Every drawing's name, in a fixed order (the gallery shows them all). */
export const ILLUSTRATION_NAMES = Object.keys(ART) as IllustrationName[];

export interface IllustrationProps {
  /** Which drawing. */
  name: IllustrationName;
  /** `s` 72 px, `m` 96 px (the default), `l` 128 px wide. */
  size?: IllustrationSize;
  /** Gives the drawing a name for assistive technology; without it the drawing is decorative. */
  label?: string;
  /** Layout classes, or a token text colour for the lines (text-muted-foreground by default). */
  className?: string;
}

export function Illustration({ name, size = "m", label, className }: IllustrationProps) {
  const Art = ART[name];
  return (
    <svg
      viewBox="0 0 120 96"
      data-illustration={name}
      className={cn("h-auto flex-none text-muted-foreground", SIZE[size], className)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <Art />
    </svg>
  );
}

/** The props of one named drawing: Illustration's, without the name. */
type NamedProps = Omit<IllustrationProps, "name">;

/** The empty box: a list or a search with nothing in it. */
export type EmptyIllustrationProps = NamedProps;
export const EmptyIllustration = (props: EmptyIllustrationProps) => <Illustration name="Empty" {...props} />;
/** The magnifier: a search or a filter that matched nothing. */
export type SearchIllustrationProps = NamedProps;
export const SearchIllustration = (props: SearchIllustrationProps) => <Illustration name="Search" {...props} />;
/** The tick in a circle: a finished action. */
export type SuccessIllustrationProps = NamedProps;
export const SuccessIllustration = (props: SuccessIllustrationProps) => <Illustration name="Success" {...props} />;
/** The warning triangle: an error the person can recover from. */
export type ErrorIllustrationProps = NamedProps;
export const ErrorIllustration = (props: ErrorIllustrationProps) => <Illustration name="Error" {...props} />;
/** The padlock: a page the person may not open. */
export type LockedIllustrationProps = NamedProps;
export const LockedIllustration = (props: LockedIllustrationProps) => <Illustration name="Locked" {...props} />;
/** The struck cloud: no connection. */
export type OfflineIllustrationProps = NamedProps;
export const OfflineIllustration = (props: OfflineIllustrationProps) => <Illustration name="Offline" {...props} />;
/** The rocket: a module's first visit, before anything exists. */
export type FirstRunIllustrationProps = NamedProps;
export const FirstRunIllustration = (props: FirstRunIllustrationProps) => <Illustration name="FirstRun" {...props} />;
/** The clock with a green tick: the Clock In prompt. */
export type ClockInIllustrationProps = NamedProps;
export const ClockInIllustration = (props: ClockInIllustrationProps) => <Illustration name="ClockIn" {...props} />;
/** The clock with a yellow arrow: the Clock Out prompt. */
export type ClockOutIllustrationProps = NamedProps;
export const ClockOutIllustration = (props: ClockOutIllustrationProps) => <Illustration name="ClockOut" {...props} />;

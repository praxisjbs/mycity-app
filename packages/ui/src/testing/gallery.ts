import type { ReactNode } from "react";

/**
 * One gallery page (`X.gallery.tsx`, default export). The gallery app lists every
 * entry and shows each state twice, in a light and a dark frame side by side
 * (data-theme on the frame); a header switch sets the density for all of them.
 * The screen gates and the accessibility check crawl it.
 *
 * State names are Title Case, at most 3 words. Copy inside a state obeys the
 * screen rules (FRONTEND_GUIDE §5): Title Case chrome, Verb Noun buttons, word
 * limits, no dashes, real MyCity wording.
 */
export type GalleryState = () => ReactNode;

export interface GalleryEntry {
  /** The component's name, as in its `@component` header. */
  component: string;
  /** Each state, by its Title Case name. */
  states: Record<string, GalleryState>;
}

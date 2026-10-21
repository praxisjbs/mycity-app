/**
 * The typefaces Settings · Appearance offers (F30), each self-hosted: no font service is asked,
 * so the security policy's `font-src 'self'` holds. Geist is part of the base stylesheet; the
 * others are loaded only when an organisation picks one, each its own CSS chunk. The ids are the
 * contract's (packages/contract/schemas/appearance.js FONTS); a test holds the two lists equal.
 */

/** A typeface the hub can draw in. */
export type FontId = "geist" | "inter" | "ibm_plex_sans" | "plus_jakarta_sans" | "source_sans_3" | "open_sans";

/** Each face's family, as its @font-face names it. */
const FAMILY: Record<FontId, string> = {
  geist: '"Geist Variable", "Geist"',
  inter: '"Inter Variable"',
  ibm_plex_sans: '"IBM Plex Sans Variable"',
  plus_jakarta_sans: '"Plus Jakarta Sans Variable"',
  source_sans_3: '"Source Sans 3 Variable"',
  open_sans: '"Open Sans Variable"',
};

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, sans-serif";

/** Loads a face's @font-face rules; Geist's are always there. */
const LOADERS: Record<FontId, () => Promise<unknown>> = {
  geist: () => Promise.resolve(),
  inter: () => import("@fontsource-variable/inter"),
  ibm_plex_sans: () => import("@fontsource-variable/ibm-plex-sans"),
  plus_jakarta_sans: () => import("@fontsource-variable/plus-jakarta-sans"),
  source_sans_3: () => import("@fontsource-variable/source-sans-3"),
  open_sans: () => import("@fontsource-variable/open-sans"),
};

/** The ids, in the order the contract lists them. */
export const FONT_IDS = Object.keys(FAMILY) as FontId[];

const isFont = (id: string): id is FontId => Object.hasOwn(FAMILY, id);

/** The font-family a face is drawn with, the system's sans after it; Geist for an id it does not know. */
export function fontStack(id: string): string {
  return `${FAMILY[isFont(id) ? id : "geist"]}, ${FALLBACK}`;
}

const loading = new Map<FontId, Promise<unknown>>();

/** Loads a face once; a face that fails to load leaves the fallback showing, and is tried again next time. */
export function loadFont(id: string): Promise<unknown> {
  if (!isFont(id)) return Promise.resolve();
  let p = loading.get(id);
  if (!p) {
    p = LOADERS[id]().catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

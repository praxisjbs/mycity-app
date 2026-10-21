import appearanceSchemas from "@mycity/contract/schemas/appearance.js";
import type { Appearance, AppearanceApplied, AppearanceDarkSeeds, AppearanceFonts } from "@mycity/contract/contract.gen.ts";

/**
 * Settings · Appearance as the mock keeps it (docs/guides/foundation.md §6.15): the four dark
 * colours, the palette the last change replaced, the fonts and the two defaults. The rest of the
 * palette is the contract's deriveDark(), as on the server, so the mock and the API agree.
 */
const A = appearanceSchemas;
type Seeds = AppearanceDarkSeeds;

const state: {
  seeds: Seeds;
  previous: { seeds: Seeds; replaced_at: string } | null;
  fonts: AppearanceFonts;
  theme_default: Appearance["theme_default"];
  density_default: Appearance["density_default"];
  updated_at: string | null;
  updated_by: string | null;
} = {
  seeds: { ...A.DEFAULT_DARK },
  previous: null,
  fonts: { ...A.DEFAULT_FONTS },
  theme_default: "system",
  density_default: "compact",
  updated_at: null,
  updated_by: null,
};

const same = (a: Seeds, b: Seeds) => A.DARK_SEED_KEYS.every((k) => a[k] === b[k]);
const isDefault = (s: Seeds) => same(s, A.DEFAULT_DARK);

/** GET /settings/appearance, as the server answers it. */
export function appearanceView(): Appearance {
  const derived = A.deriveDark(state.seeds);
  return {
    dark: {
      seeds: { ...state.seeds },
      preset: A.presetOf(state.seeds),
      tokens: A.DARK_TOKENS.map((token) => ({ token, value: derived.tokens[token]!, nudged_from: derived.nudged[token] ?? null })),
      pairs: derived.pairs,
    },
    presets: A.DARK_PRESETS.map((p) => ({ key: p.key, name: p.name, seeds: { ...p.seeds } })),
    previous: state.previous ? { seeds: { ...state.previous.seeds }, preset: A.presetOf(state.previous.seeds), replaced_at: state.previous.replaced_at } : null,
    fonts: { ...state.fonts },
    font_options: A.FONTS.map((f) => ({ id: f.id, name: f.name })),
    theme_default: state.theme_default,
    density_default: state.density_default,
    updated_at: state.updated_at,
    updated_by: state.updated_by,
  };
}

/** What /auth/me carries for every screen. */
export function appearanceApplied(): AppearanceApplied {
  return {
    dark: isDefault(state.seeds) ? null : A.deriveDark(state.seeds).tokens,
    fonts: { ...state.fonts },
    theme_default: state.theme_default,
    density_default: state.density_default,
  };
}

/** A palette change, keeping the one it replaces; false when nothing changed. */
function putPalette(seeds: Seeds): boolean {
  if (same(seeds, state.seeds)) return false;
  state.previous = { seeds: { ...state.seeds }, replaced_at: new Date().toISOString() };
  state.seeds = { ...seeds };
  return true;
}

/** PATCH /settings/appearance, already parsed by the contract: the fields that changed. */
export function updateAppearance(body: { dark?: Seeds | null; fonts?: AppearanceFonts; theme_default?: Appearance["theme_default"]; density_default?: Appearance["density_default"] }, by: string): string[] {
  const changed: string[] = [];
  if (body.dark !== undefined && putPalette(body.dark ?? { ...A.DEFAULT_DARK })) changed.push("dark");
  if (body.fonts && (body.fonts.heading !== state.fonts.heading || body.fonts.body !== state.fonts.body)) {
    state.fonts = { ...body.fonts };
    changed.push("fonts");
  }
  if (body.theme_default && body.theme_default !== state.theme_default) {
    state.theme_default = body.theme_default;
    changed.push("theme_default");
  }
  if (body.density_default && body.density_default !== state.density_default) {
    state.density_default = body.density_default;
    changed.push("density_default");
  }
  if (changed.length) {
    state.updated_at = new Date().toISOString();
    state.updated_by = by;
  }
  return changed;
}

/** POST /settings/appearance/restore: false when there is nothing to bring back. */
export function restorePrevious(by: string): boolean {
  if (!state.previous) return false;
  if (putPalette(state.previous.seeds)) {
    state.updated_at = new Date().toISOString();
    state.updated_by = by;
  }
  return true;
}

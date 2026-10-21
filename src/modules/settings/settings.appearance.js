"use strict";
/**
 * Settings · Appearance (docs/guides/foundation.md §6.15; FRONTEND_FOUNDATION F30): the hub's
 * dark palette, its two fonts and the theme and density a person starts with, kept as setting
 * rows. The public site, documents and email are not touched by any of it.
 *
 *   appearance.dark             the four colours pasted; none is MyCity's own (DEFAULT_DARK)
 *   appearance.dark_previous    { seeds, replaced_at }: the palette the last change replaced,
 *                               which Restore Previous brings back
 *   appearance.fonts            { heading, body }; none is Geist for both
 *   appearance.theme_default    system, light or dark, for a person who has not chosen one
 *   appearance.density_default  compact or comfortable, the same
 *
 * The rest of the dark palette is derived from the four colours by the contract (deriveDark)
 * on every read, never stored, so a token added to the maths later reaches a palette saved
 * before it. A change repaints the hub for everyone, so it needs a fresh sign-in, as a key on
 * Integrations does (403 REAUTH_REQUIRED), and is recorded for the Audit Log.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const security = require("../security/security.service");
const repo = require("./settings.repo");
const { EVENTS } = require("./settings.events");

const A = c.appearance;

const KEYS = Object.freeze({
  dark: "appearance.dark",
  previous: "appearance.dark_previous",
  fonts: "appearance.fonts",
  theme_default: "appearance.theme_default",
  density_default: "appearance.density_default",
});
const ALL = Object.values(KEYS);

const DEFAULTS = Object.freeze({ theme_default: "system", density_default: "compact" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The four colours as stored, or MyCity's own when none are (or a stored row no longer derives). */
function seedsOf(stored) {
  if (stored && !Object.keys(A.deriveDark(stored).problems).length)
    return Object.fromEntries(A.DARK_SEED_KEYS.map((k) => [k, A.normalHex(stored[k])]));
  return { ...A.DEFAULT_DARK };
}

/** What the setting rows hold, each part defaulted. */
async function readStored(db) {
  const rows = await repo.settingsByKey(db, ALL);
  const fonts = rows[KEYS.fonts];
  return {
    seeds: seedsOf(rows[KEYS.dark]),
    previous: rows[KEYS.previous] && rows[KEYS.previous].seeds ? rows[KEYS.previous] : null,
    fonts: fonts && A.FontId.safeParse(fonts.heading).success && A.FontId.safeParse(fonts.body).success ? { heading: fonts.heading, body: fonts.body } : { ...A.DEFAULT_FONTS },
    theme_default: A.ThemeDefault.safeParse(rows[KEYS.theme_default]).success ? rows[KEYS.theme_default] : DEFAULTS.theme_default,
    density_default: A.DensityDefault.safeParse(rows[KEYS.density_default]).success ? rows[KEYS.density_default] : DEFAULTS.density_default,
  };
}

const isDefault = (seeds) => A.DARK_SEED_KEYS.every((k) => seeds[k] === A.DEFAULT_DARK[k]);

/** GET /settings/appearance: the palette with every derived token and its pairs, the presets, fonts and defaults. */
async function appearance(db = pool) {
  const s = await readStored(db);
  const derived = A.deriveDark(s.seeds);
  const last = await repo.lastChangeOf(db, ALL);
  return {
    dark: {
      seeds: s.seeds,
      preset: A.presetOf(s.seeds),
      tokens: A.DARK_TOKENS.map((token) => ({ token, value: derived.tokens[token], nudged_from: derived.nudged[token] || null })),
      pairs: derived.pairs,
    },
    presets: A.DARK_PRESETS.map((p) => ({ key: p.key, name: p.name, seeds: { ...p.seeds } })),
    previous: s.previous
      ? { seeds: seedsOf(s.previous.seeds), preset: A.presetOf(seedsOf(s.previous.seeds)), replaced_at: s.previous.replaced_at }
      : null,
    fonts: s.fonts,
    font_options: A.FONTS.map((f) => ({ id: f.id, name: f.name })),
    theme_default: s.theme_default,
    density_default: s.density_default,
    updated_at: last ? new Date(last.updated_at).toISOString() : null,
    updated_by: last ? last.updated_by || null : null,
  };
}

/**
 * What /auth/me hands every screen of the hub: the dark tokens when the palette is not MyCity's
 * own (tokens.css already holds those), the fonts and the defaults.
 */
async function applied(db = pool) {
  const s = await readStored(db);
  return {
    dark: isDefault(s.seeds) ? null : A.deriveDark(s.seeds).tokens,
    fonts: s.fonts,
    theme_default: s.theme_default,
    density_default: s.density_default,
  };
}

/** Writes a new palette, keeping the one it replaces for Restore Previous. Nothing when it is the same. */
async function putPalette(client, before, seeds, actor) {
  if (A.DARK_SEED_KEYS.every((k) => before.seeds[k] === seeds[k])) return false;
  await repo.putSetting(client, KEYS.previous, { seeds: before.seeds, replaced_at: new Date().toISOString() }, actor.user_id);
  await repo.putSetting(client, KEYS.dark, isDefault(seeds) ? null : seeds, actor.user_id);
  return true;
}

/**
 * PATCH /settings/appearance: any of the palette (null: MyCity's own), the fonts and the two
 * defaults. Saving what is already there records nothing.
 */
async function updateAppearance(body, actor) {
  await security.assertFresh(pool, actor);
  await tx(async (client) => {
    await repo.lockSettings(client, ALL);
    const before = await readStored(client);
    const changed = {};
    if (body.dark !== undefined) {
      const seeds = body.dark === null ? { ...A.DEFAULT_DARK } : body.dark;
      if (await putPalette(client, before, seeds, actor)) changed.dark = seeds;
    }
    if (body.fonts && (body.fonts.heading !== before.fonts.heading || body.fonts.body !== before.fonts.body)) {
      const isGeist = body.fonts.heading === A.DEFAULT_FONTS.heading && body.fonts.body === A.DEFAULT_FONTS.body;
      await repo.putSetting(client, KEYS.fonts, isGeist ? null : body.fonts, actor.user_id);
      changed.fonts = body.fonts;
    }
    for (const key of ["theme_default", "density_default"]) {
      if (body[key] === undefined || body[key] === before[key]) continue;
      await repo.putSetting(client, KEYS[key], body[key] === DEFAULTS[key] ? null : body[key], actor.user_id);
      changed[key] = body[key];
    }
    if (!Object.keys(changed).length) return;
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "setting", id: "appearance" },
      actor,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, k === "dark" ? before.seeds : before[k]])),
      after: changed,
      payload: { area: "appearance", fields: Object.keys(changed) },
    });
  });
  return appearance();
}

/** POST /settings/appearance/restore: the palette the last change replaced comes back, and swaps places with it. */
async function restorePrevious(actor) {
  await security.assertFresh(pool, actor);
  await tx(async (client) => {
    await repo.lockSettings(client, ALL);
    const before = await readStored(client);
    if (!before.previous) throw new AppError("NOTHING_TO_RESTORE", "There is no earlier palette", 409);
    const seeds = seedsOf(before.previous.seeds);
    if (!(await putPalette(client, before, seeds, actor))) return;
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "setting", id: "appearance" },
      actor,
      before: { dark: before.seeds },
      after: { dark: seeds },
      payload: { area: "appearance", fields: ["dark"], restored: true },
    });
  });
  return appearance();
}

module.exports = { KEYS, appearance, applied, updateAppearance, restorePrevious };

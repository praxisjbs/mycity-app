"use strict";
/**
 * A vacancy's public address, /jobs/<slug> (docs/guides/recruitment.md §6.1; MILESTONES §9, decided
 * 04/11/2026). Made once, at the vacancy's first publish, from its title and its location's city
 * ("Content Producer" in Lagos is content-producer-lagos), with -2, -3 on a clash. It never changes
 * afterwards: pausing, resuming and editing keep the same link.
 *
 *   base("Head, Sales & Revenue", "Lagos")      // "head-sales-revenue-lagos"
 *   await unique(client, "content-producer-lagos")  // "content-producer-lagos-2" when taken
 */
const MAX = 80;

/** Lower-case words of a-z and 0-9 joined by hyphens: accents folded, everything else dropped. */
function words(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The slug a title and a city make, before any clash is settled. A title that folds to nothing
 * (all symbols) is "role".
 * @param {string} title
 * @param {string|null} [city]
 */
function base(title, city = null) {
  const t = words(title).replace(/-and-/g, "-") || "role";
  const c = words(city);
  const joined = c && !t.endsWith(`-${c}`) ? `${t}-${c}` : t;
  return joined.slice(0, MAX).replace(/-+$/, "");
}

/**
 * The slug itself, or with the lowest suffix no other vacancy holds. Run inside the publish's
 * transaction; the column's UNIQUE settles two publishes racing for the same name.
 * @param {{query: Function}} client
 * @param {string} slug
 */
async function unique(client, slug) {
  const { rows } = await client.query(
    `SELECT slug::text AS slug FROM vacancy WHERE slug = $1::citext OR slug::text ~ ('^' || $2 || '-[0-9]+$')`,
    [slug, slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")],
  );
  const taken = new Set(rows.map((r) => r.slug.toLowerCase()));
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const next = `${slug}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/** A slug in the shape the public routes accept (the contract's SlugParams). */
const looksLikeSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(s || ""));

module.exports = { base, unique, words, looksLikeSlug };

"use strict";
/**
 * Maps: naming the locations saved while address search was down (docs/guides/addresses.md
 * §6.5, §7), and signing what the search and the pin hand out. The search and the pin write
 * nothing; every address is saved by its owner's own service through shared/places.
 *
 *   nameWaiting()   the places-name job: up to 25 waiting places a run, each named by the
 *                   provider and its owner's line rewritten by the owner's code, with place.named
 *   signed()        a place found or pinned, with our signature over it (shared/places/token.js)
 *   onePlace()      a Praxis AI card's place written in words (docs/guides/praxis-ai.md §6.11):
 *                   the token of the one place the search finds, never a guess among several
 *   cardPlace()     how a card names the place its token holds: its line, never the token
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { logger } = require("../../config/logger");
const places = require("../../shared/places/places");
const token = require("../../shared/places/token");
const geoapify = require("../../services/maps/geoapify.service");
const { EVENTS } = require("./maps.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Name what waits; stops at the first failure, so an outage costs one request a run. */
function nameWaiting() {
  return places.nameWaiting({
    pool,
    tx,
    nearest: (lat, lon) => geoapify.nearest(lat, lon, { level: "address" }),
    emit: (client, event) => emit(client, { ...event, key: EVENTS.PLACE_NAMED, actor: null }),
  });
}

/** A place as the contract's Place: its line, point and kind, and our signature over all of it. */
function signed(found, source) {
  return {
    place_id: found.place_id,
    formatted: found.formatted,
    lat: found.lat,
    lon: found.lon,
    kind: found.kind,
    token: token.sign({
      source,
      formatted: found.formatted,
      lat: found.lat,
      lon: found.lon,
      provider_id: found.provider_id === undefined ? found.place_id : found.provider_id,
      kind: found.kind,
      city: found.city,
      state: found.state,
      country_code: found.country_code,
      timezone: found.timezone || null,
      verified: true,
      pending: false,
    }),
  };
}

/** Is this a place token our API signed? */
const isOurs = (value) => typeof value === "string" && Boolean(c.maps.readPlaceToken(value)) && token.verify(value);

/**
 * The place a card's words name (decision 32's matching, applied to an address, F27): a token
 * already ours is kept; words are searched at the level asked, and only the one place found is
 * signed. None, several, or the search down leaves the words as they are, so the card marks the
 * field Pick one and the person picks it with AddressField on Edit.
 * @param {string} words
 * @param {{level?: "address"|"area"|"city"}} [opts]
 * @returns {Promise<string|null>} the token, or null
 */
async function onePlace(words, { level = "address" } = {}) {
  if (isOurs(words)) return words;
  try {
    const found = await geoapify.searchPlaces(words, { level });
    return found.length === 1 ? signed(found[0], "search").token : null;
  } catch (err) {
    logger.info({ err: err.code || err.message }, "maps: a card's place could not be searched; the person picks it");
    return null;
  }
}

/**
 * How a card names the place its token holds (praxis-ai.md decision 32): its line, as the field
 * shows it. A token that is not ours names nothing, and the card asks for the place again.
 * @param {string|null|undefined} value
 * @returns {Array<{type: "place", id: string, label: string}>}
 */
function cardPlace(value) {
  if (!isOurs(value)) return [];
  const place = c.maps.readPlaceToken(value);
  return place && place.formatted ? [{ type: "place", id: value, label: place.formatted }] : [];
}

module.exports = { nameWaiting, signed, onePlace, cardPlace };

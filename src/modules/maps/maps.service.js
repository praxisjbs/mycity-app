"use strict";
/**
 * Maps: naming the locations saved while address search was down (docs/guides/addresses.md
 * §6.5, §7). The search and the pin write nothing; every address is saved by its owner's own
 * service through shared/places.
 *
 *   nameWaiting()   the places-name job: up to 25 waiting places a run, each named by the
 *                   provider and its owner's line rewritten by the owner's code, with place.named
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const places = require("../../shared/places/places");
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

module.exports = { nameWaiting };

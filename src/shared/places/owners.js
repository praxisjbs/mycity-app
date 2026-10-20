"use strict";
/**
 * Every address field in the ERP, defined once (docs/guides/addresses.md §6.9). An owner is one
 * field of one record type; its `place` rows are keyed by the record (`owner_key`).
 *
 *   name      `<table>.<column>` of the readable line the owning module keeps
 *   module    the module that holds it, and so writes its line
 *   level     what a pick may be (contract PlaceLevel): address, area or city
 *   personal  the line and the place are personal data, read only through the owner's service
 *
 * The holding module registers how its readable line is rewritten when a waiting place is
 * named, from its own `<module>.events.js`, so the naming job writes another module's row only
 * through that module's code:
 *
 *   places.owner("worksite.address", { rename: (client, key, line) => repo.setAddressLine(client, key, line) });
 *
 * A new address field is a new entry here, a PlaceInput in its contract, places.save() in its
 * service and an AddressField on its screen; gate 22 (check/addresses.js) refuses one missing.
 */
const OWNERS = Object.freeze([
  Object.freeze({ name: "organisation.address", module: "settings", level: "address", personal: false }),
  Object.freeze({ name: "worksite.address", module: "worksites", level: "address", personal: false }),
  Object.freeze({ name: "attendance_field_site.address", module: "attendance", level: "address", personal: false }),
  Object.freeze({ name: "attendance_location_request.address", module: "attendance", level: "address", personal: true }),
  Object.freeze({ name: "attendance_home.address", module: "attendance", level: "address", personal: true }),
  Object.freeze({ name: "employee.home_address", module: "organisation", level: "address", personal: true }),
]);

const BY_NAME = new Map(OWNERS.map((o) => [o.name, o]));
const renames = new Map();

/** One owner's definition; throws for a name the registry does not hold. */
function get(name) {
  const o = BY_NAME.get(name);
  if (!o) throw new Error(`places: no address field "${name}"`);
  return o;
}

/**
 * The holding module says how its readable line is rewritten (a waiting place named).
 * @param {string} name
 * @param {{rename: (client: {query: Function}, key: string, line: string) => Promise<void>}} hooks
 */
function owner(name, { rename }) {
  get(name);
  if (typeof rename !== "function") throw new Error(`places: ${name} needs a rename function`);
  renames.set(name, rename);
}

/** The rename the owner registered, or undefined before its module loaded. */
const renameOf = (name) => renames.get(name);

module.exports = { OWNERS, get, owner, renameOf };

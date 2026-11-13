"use strict";
/**
 * What the assistant may read and do about worksites, for People: their names, codes, radius,
 * whether they are in use and how many people are assigned, a page of 25 at a time (a row leaves
 * out the coordinates); and, as cards the person confirms (docs/guides/praxis-ai.md §6.11,
 * decision 33), Add Worksite and Save Worksite, each through the function the screen's own button
 * calls. The address is picked as every address is (F27, docs/guides/addresses.md §9): the model
 * writes it in words, our address search signs the one place it finds, and anything else is marked
 * Pick one for the person to pick with the screen's own AddressField on Edit. The centre is the
 * place's point, as the form fills it from the pick.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const maps = require("../maps/maps.service");
const service = require("./worksites.service");

/** A worksite as the assistant reads it: everything but where it is. */
const withoutCoordinates = ({ latitude: _lat, longitude: _lng, ...row }) => row;

/** A place's token as the form sends it, with the centre the pick fills: its point. */
function placed(token) {
  const p = c.maps.readPlaceToken(token);
  return { address: { token }, latitude: p.lat, longitude: p.lon };
}

const worksiteLine = (status) => (w) => [{ type: "worksite", id: w.worksite_id, label: w.name, status, link: (routeMap.linkFor("worksite", w.worksite_id) || {}).path || null }];

const LABELS = { name: "Name", address: "Address", radius_m: "Radius", timezone: "Time Zone" };

module.exports = defineManifest({
  module: "people",
  actions: [
    {
      key: "worksites.create",
      label: "Add Worksite",
      description: "Add a worksite staff clock in at: its name, its address in words as precise as given (a building and street), the radius of its fence in metres (25 to 1,000) and its time zone",
      input: c.worksites.WorksiteAdd,
      permission: ["people", "create"],
      risk: "standard",
      form: "none: Add Worksite's form fills the centre from the address picked on its map, which the card picks the same way (WorksiteAdd)",
      fields: ["name", "address", "radius_m", "timezone"],
      picks: { address: "place" },
      // An address in words is the one place our search finds, signed; anything else is picked (F27).
      resolve: { address: (value) => maps.onePlace(value) },
      names: (values) => maps.cardPlace(values.address),
      asks: [
        { field: "name", question: "What is the worksite called?" },
        { field: "address", question: "Where is it?" },
        { field: "radius_m", question: "How wide is its fence?", choices: ["100 m", "150 m", "250 m"] },
      ],
      // The same function Add Worksite calls, with the form's own request (WorksiteCreate).
      run: (values, actor) => service.create(actor, parseBody(c.worksites.WorksiteCreate, { name: values.name, ...placed(values.address), radius_m: values.radius_m, timezone: values.timezone })),
      readback: worksiteLine("added"),
      labels: LABELS,
    },
    {
      key: "worksites.edit",
      label: "Save Worksite",
      description: "Change a worksite: its name, its address (in words), its radius or time zone, or retire it (active false) or restore it (true); only what changes",
      input: c.worksites.WorksiteChange,
      permission: ["people", "edit"],
      risk: "standard",
      form: "none: Edit Worksite's form changes the worksite open on People, Worksites and never names it; the card does",
      fields: ["worksite_id", "name", "address", "radius_m", "timezone", "active"],
      picks: { address: "place" },
      asks: [{ field: "worksite_id", question: "Which worksite?", read: "worksites.list" }],
      resolve: { worksite_id: (value, _actor, db) => service.idOf(db, value), address: (value) => maps.onePlace(value) },
      names: (values) => maps.cardPlace(values.address),
      records: (values, _actor, db) => service.cardWorksite(db, values.worksite_id),
      check: (client, values) => service.assertCardWorksite(client, values.worksite_id),
      // The same function Save Worksite calls: a new place moves the centre to its point, as the form does.
      run: (values, actor) => {
        const { worksite_id: id, address, ...rest } = values;
        return service.update(actor, id, parseBody(c.worksites.WorksiteUpdate, { ...rest, ...(address ? placed(address) : {}) }));
      },
      readback: worksiteLine("saved"),
      labels: { worksite_id: "Worksite", ...LABELS, active: "In Use" },
    },
  ],
  // The forms' own requests, reached through the cards that pick their place (gate 23, praxis-ai.md decision 33).
  not_offered: {
    WorksiteCreate: "via worksites.create: Add Worksite's own request, its centre filled from the address picked; the card is WorksiteAdd",
    WorksiteUpdate: "via worksites.edit: Edit Worksite's own request, which never names its worksite; the card is WorksiteChange",
  },
  reads: [
    {
      key: "worksites.list",
      summary: "none: configuration; charted from its table (decision 50)",
      description: "List the worksites staff clock in at, with their radius and how many people each has",
      params: c.worksites.WorksiteListQuery,
      permission: ["people", "view"],
      run: async (_client, params) => {
        const page = await service.list(params);
        return { ...page, data: page.data.map(withoutCoordinates) };
      },
      cite: (row) => ({ type: "worksite", id: row.worksite_id, label: row.name }),
    },
  ],
  routes: [{ intent: "add a worksite", screen: "people.worksites" }],
});

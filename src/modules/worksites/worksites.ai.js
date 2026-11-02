"use strict";
/**
 * What the assistant may read about worksites, for People: their names, codes, radius,
 * whether they are in use and how many people are assigned, a page of 25 at a time. A
 * row leaves out the coordinates. It never adds, changes or retires a worksite (A23);
 * it sends the person to People · Worksites.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./worksites.service");

/** A worksite as the assistant reads it: everything but where it is. */
const withoutCoordinates = ({ latitude: _lat, longitude: _lng, ...row }) => row;

module.exports = defineManifest({
  module: "people",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    WorksiteCreate: "a worksite's address is picked on a map, never typed, on People, Worksites",
  },
  reads: [
    {
      key: "worksites.list",
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

"use strict";
/**
 * ⌘K for clock-in devices: a device found by its label or its owner's name, within the
 * reader's `people` scope, as People · Devices lists it. A result opens the device on
 * People · Devices, and the owner's own on ESS · My Devices (shared/route-map.js device).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "device",
  module: "people",
  label: "Devices",
  words: ["device", "devices", "phone", "laptop"],
  from: "attendance_device ad JOIN employee e ON e.employee_id = ad.employee_id",
  key: "ad.attendance_device_id",
  columns: ["ad.label", "e.first_name", "e.last_name", "e.preferred_name"],
  select:
    "ad.attendance_device_id AS id, NULL::text AS ref, ad.label AS title, btrim(e.first_name || ' ' || e.last_name) AS sub, ad.status AS status",
  order: "ad.first_seen_at DESC",
  scope: { column: "ad.employee_id" },
});

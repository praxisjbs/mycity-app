"use strict";
/**
 * What the assistant may read about clock-in devices: the asker's own (ESS), and for
 * People the devices within their own `people` scope, a page of 25 at a time. A row
 * carries the label, the owner and the status, never an identifier of the device
 * itself. It never registers or removes a device (A23); it sends the person to the
 * screen that does.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./devices.service");

module.exports = defineManifest({
  module: "people",
  reads: [
    {
      key: "devices.mine",
      description: "List my own clock-in devices and whether each is registered",
      params: c.common.PageQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => service.listMine(actor, params),
      cite: (row) => ({ type: "device", id: row.attendance_device_id, label: row.label }),
    },
    {
      key: "devices.list",
      description: "List the devices staff clock in from, with who owns each and whether it is registered",
      params: c.devices.DeviceListQuery,
      permission: ["people", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({
        type: "device",
        id: row.attendance_device_id,
        label: `${row.employee.display_name}, ${row.label}`,
      }),
    },
  ],
  routes: [
    { intent: "register my device for clocking in", screen: "ess.my-devices" },
    { intent: "remove a staff member's clock-in device", screen: "people.devices" },
  ],
});

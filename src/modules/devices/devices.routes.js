"use strict";
/**
 * /api/v1/devices: the devices people clock in from (docs/guides/attendance.md §5, §6.6).
 *
 *   GET   /mine               the caller's own devices (self)
 *   POST  /mine               register the device this session is on (self; fresh sign-in)
 *   POST  /mine/:id/remove    take one of the caller's own off (self)
 *   GET   /                   `people` view: every device within the grant's scope
 *   GET   /:id                `people` view: one device
 *   POST  /:id/remove         `people` edit: take a device off, with a reason
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./devices.controller");

const router = express.Router();
const d = c.devices;

route(router, "get", "/mine",
  { query: c.common.PageQuery, response: d.MyDevicePage, self: true, summary: "My clock-in devices" },
  controller.listMine);

route(router, "post", "/mine",
  { body: d.DeviceRegister, response: d.MyDevice, self: true, summary: "Register the device I am on" },
  controller.registerMine);

route(router, "post", "/mine/:id/remove",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: d.MyDevice, self: true,
    summary: "Remove one of my devices" },
  controller.removeMine);

route(router, "get", "/",
  { query: d.DeviceListQuery, response: d.DevicePage, summary: "Clock-in devices" },
  requirePermission("people", "view"), controller.list);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: d.Device, summary: "One clock-in device" },
  requirePermission("people", "view"), controller.get);

route(router, "post", "/:id/remove",
  { params: c.common.IdParams, body: d.DeviceRemove, response: d.Device, summary: "Remove a device" },
  requirePermission("people", "edit"), controller.remove);

module.exports = { basePath: "/devices", surface: "staff", router };

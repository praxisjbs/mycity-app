"use strict";
/**
 * Devices: the browsers and phones a person clocks in from (docs/guides/attendance.md
 * §6.6). A device is the session's own (identity's known device, from the device
 * cookie set at sign-in), so nothing here carries a fingerprint, a cookie or its hash:
 * the person registers "this device", by the session they are in.
 *
 * Statuses a person reads:
 *   observed     seen on a punch, not registered (New on screen)
 *   registered   the person registered it; at most three at once
 *   removed      the person or People took it off; it may be registered again
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

const DeviceStatus = z.enum(["observed", "registered", "removed"]);

/** The most devices one person may have registered at once (12 and 13 October meetings). */
const MAX_REGISTERED = 3;

/** One of my devices. */
const MyDevice = z
  .object({
    attendance_device_id: uuid,
    label: z.string(),
    platform: z.string().nullable(),
    status: DeviceStatus,
    first_seen_at: isoDateTime,
    last_punch_at: isoDateTime.nullable(),
    registered_at: isoDateTime.nullable(),
    removed_at: isoDateTime.nullable(),
    this_device: z.boolean(),
  })
  .strict();
const MyDevicePage = Paged(MyDevice);

/** POST /devices/mine: register the device this session is on, optionally named. */
const DeviceRegister = z.object({ label: optionalText(80) }).strict();

/** One device as People see it. */
const Device = z
  .object({
    attendance_device_id: uuid,
    employee: PersonRef,
    label: z.string(),
    platform: z.string().nullable(),
    status: DeviceStatus,
    first_seen_at: isoDateTime,
    last_punch_at: isoDateTime.nullable(),
    registered_at: isoDateTime.nullable(),
    removed_at: isoDateTime.nullable(),
    removed_by_name: z.string().nullable(),
    removal_reason: z.string().nullable(),
  })
  .strict();
const DevicePage = Paged(Device);

/** GET /devices */
const DeviceListQuery = listQuery(
  { status: DeviceStatus.optional(), employee_id: uuid.optional() },
  ["first_seen_at", "last_punch_at"],
);

/** POST /devices/:id/remove: People take a device off, saying why. */
const DeviceRemove = z.object({ removal_reason: text(300) }).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  MyDevice: {
    table: "attendance_device",
    virtual: {
      platform: "known_device.platform",
      this_device: "the device is the one this session is on",
    },
  },
  MyDevicePage: { table: null, reason: "a page of my devices" },
  DeviceRegister: { table: "attendance_device" },
  Device: {
    table: "attendance_device",
    virtual: {
      employee: "the owner, from employee and department",
      platform: "known_device.platform",
      removed_by_name: "who removed it, from employee",
    },
  },
  DevicePage: { table: null, reason: "a page of devices" },
  DeviceListQuery: { table: null, reason: "list controls for the devices" },
  DeviceRemove: { table: "attendance_device" },
};

module.exports = {
  TABLES,
  MAX_REGISTERED,
  DeviceStatus,
  MyDevice,
  MyDevicePage,
  DeviceRegister,
  Device,
  DevicePage,
  DeviceListQuery,
  DeviceRemove,
};

"use strict";
/**
 * Notifications: the inbox behind the bell (M0 notifications module) and what a
 * notification says when it goes out by email.
 *
 * The inbox is the caller's own and read-only but for the read mark: rows are written
 * by the fan-out (shared/notifications/fanout.js), never through the API.
 *
 * Also here (brought forward from M6, docs/guides/notifications.md): the person's own
 * preferences per category and channel, their devices with web push on, the push a
 * service worker receives, and the two calls a service worker makes with its device
 * token (renewing its subscription, Mark Read).
 */
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");

/** Where a notification opens: derived from its record through shared/route-map.js, never stored. */
const NotificationLink = z
  .object({
    module: ModuleKey,
    tab: z.string(),
    path: z.string(),
  })
  .strict();

/**
 * How hard a notice insists (docs/guides/notifications.md §6): `important` is amber, `urgent` is
 * red, stays in the urgent bar and is alerted again until it closes.
 */
const NOTIFICATION_URGENCIES = ["normal", "important", "urgent"];
const NotificationUrgency = z.enum(NOTIFICATION_URGENCIES);

/**
 * One row of the bell. `link` is null when the record has no screen, or the reader cannot open it.
 * An urgent notice is open until acknowledged (`acknowledge_required`) or else until read;
 * `repeat_count` grows with each urgent repeat, so an app shows the banner again.
 */
const Notification = z
  .object({
    notification_id: uuid,
    category: z.string(),
    priority: z.enum(["normal", "high"]),
    urgency: NotificationUrgency,
    acknowledge_required: z.boolean(),
    acknowledged_at: isoDateTime.nullable(),
    repeat_count: z.number().int().min(0),
    title: z.string(),
    body: z.string().nullable(),
    entity_type: z.string().nullable(),
    entity_id: z.string().nullable(),
    link: NotificationLink.nullable(),
    read_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /notifications: newest first; `status` narrows to unread or read. */
const NotificationListQuery = listQuery({
  status: z.enum(["unread", "read"]).optional(),
});
const NotificationPage = Paged(Notification);

/** GET /notifications/urgent: the caller's open urgent notices, newest first (the urgent bar). */
const UrgentNoticeQuery = listQuery();

/** GET /notifications/unread-count: the bell's dot. */
const UnreadCount = z.object({ unread: z.number().int().min(0) }).strict();

/**
 * GET /notifications/badges: unread notifications per module, for the rail and the
 * More tiles. Only modules the reader may open, and only those with something unread.
 */
const NavBadges = z.record(ModuleKey, z.number().int().min(1));

/** Variables of templates/email/notification.html: one notification sent as an email. */
const NotificationEmailVars = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).default(""),
    link_url: z.string().url().nullable().default(null),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Read state, for closing notifications the device still shows
 * ------------------------------------------------------------------ */

/** GET /notifications/read-state?ids=a,b,c: at most 25 of the caller's own ids. */
const NotificationReadStateQuery = z
  .object({
    ids: z
      .string()
      .trim()
      .min(1)
      .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(uuid).min(1).max(25)),
  })
  .strict();

/** Which of the asked ids are read (an id that is not the caller's is left out). */
const NotificationReadState = z.object({ read: z.array(uuid) }).strict();

/* ------------------------------------------------------------------ *
 * Preferences: each category's three channels
 * ------------------------------------------------------------------ */

const NotificationChannel = z.enum(["in_app", "email", "push"]);

/** A category's channels, true where on. */
const NotificationChannels = z
  .object({ in_app: z.boolean(), email: z.boolean(), push: z.boolean() })
  .strict();

/** One category in Notification Settings, defaults applied. */
const NotificationCategoryPreference = z
  .object({
    category: z.string(),
    label: z.string(),
    /** Security: a channel that is on by default cannot be switched off. */
    locked: z.boolean(),
    channels: NotificationChannels,
    defaults: NotificationChannels,
  })
  .strict();

/** GET /notifications/preferences: every category, in display order. */
const NotificationPreferences = z
  .object({ categories: z.array(NotificationCategoryPreference) })
  .strict();

/** PUT /notifications/preferences: one category's one channel. */
const NotificationPreferenceUpdate = z
  .object({
    category: z.string().trim().regex(/^[a-z_]{2,40}$/),
    channel: NotificationChannel,
    enabled: z.boolean(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Web push
 * ------------------------------------------------------------------ */

/** GET /notifications/push/config: what a browser subscribes with. */
const PushConfig = z
  .object({
    enabled: z.boolean(),
    /** The VAPID public key, base64url (the applicationServerKey). */
    public_key: z.string().nullable(),
    /** A short id of that key: a browser subscribed under another key subscribes again. */
    key_id: z.string().nullable(),
  })
  .strict();

const pushEndpoint = z
  .string()
  .trim()
  .url()
  .max(1000)
  .refine((v) => v.startsWith("https://"), "must be https");
const pushKey = (min, max) => z.string().trim().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(min).max(max);

/**
 * POST /notifications/push/subscriptions: this browser's subscription (PushSubscription
 * .toJSON(), flattened). Saving it again from the same browser updates the device and
 * moves it to whoever is signed in. `device_token` is the token this browser already
 * holds, so it is kept rather than replaced.
 */
const PushSubscriptionCreate = z
  .object({
    endpoint: pushEndpoint,
    p256dh: pushKey(40, 200),
    auth: pushKey(8, 100),
    expires_at: isoDateTime.nullable().optional(),
    /** The device this browser was saved as, with its token, when its endpoint changed. */
    push_subscription_id: uuid.optional(),
    device_token: z.string().trim().min(20).max(100).optional(),
  })
  .strict();

/** One of the caller's devices with web push on. */
const PushDevice = z
  .object({
    push_subscription_id: uuid,
    label: z.string(),
    platform: z.string().nullable(),
    created_at: isoDateTime,
    last_seen_at: isoDateTime.nullable(),
    last_success_at: isoDateTime.nullable(),
  })
  .strict();

/** The device just saved, with its token when one was issued (shown once, kept by the browser). */
const PushDeviceSaved = PushDevice.extend({
  device_token: z.string().nullable(),
}).strict();

const PushDeviceListQuery = listQuery();
const PushDevicePage = Paged(PushDevice);

/** POST /notifications/push/test: one device, or every device of the caller. */
const PushTestRequest = z
  .object({ push_subscription_id: uuid.optional() })
  .strict();
const PushTestResult = z
  .object({ devices: z.number().int().min(0) })
  .strict();

/** What a service worker proves it is: its subscription and the token it was given. */
const deviceProof = {
  push_subscription_id: uuid,
  device_token: z.string().trim().min(20).max(100),
};

/** POST /notifications/push/renew: the browser replaced the subscription (pushsubscriptionchange). */
const PushRenew = z
  .object({
    ...deviceProof,
    endpoint: pushEndpoint,
    p256dh: pushKey(40, 200),
    auth: pushKey(8, 100),
    expires_at: isoDateTime.nullable().optional(),
  })
  .strict();

/** POST /notifications/push/read: Mark Read on a notification the device shows. */
const PushDeviceRead = z
  .object({
    ...deviceProof,
    notification_ids: z.array(uuid).min(1).max(25),
  })
  .strict();

/**
 * What a push carries to the service worker (version 1, under 3 KB). `path` opens the
 * record; `tag` groups a conversation on the device; `mode` says how a newer push for the
 * same tag behaves: `alert` replaces and alerts again, `quiet` replaces silently until it
 * is opened, `single` stands alone. `round` is 0 for the first alert and counts urgent repeats.
 */
const PushPayload = z
  .object({
    v: z.literal(1),
    id: uuid.nullable(),
    title: z.string(),
    body: z.string(),
    path: z.string().nullable(),
    tag: z.string(),
    mode: z.enum(["alert", "quiet", "single"]),
    category: z.string(),
    priority: z.enum(["normal", "high"]),
    urgency: NotificationUrgency,
    round: z.number().int().min(0),
    ts: isoDateTime,
    unread: z.number().int().min(0),
    test: z.boolean(),
  })
  .strict();

/** Gate 6 (check/contract-columns.js): which table each schema's keys are the columns of. */
const TABLES = {
  NotificationLink: { table: null, reason: "a screen derived from entity_type and entity_id through shared/route-map.js" },
  Notification: {
    table: "notification",
    virtual: { link: "derived from entity_type and entity_id through shared/route-map.js when read, never stored" },
  },
  NotificationListQuery: { table: null, reason: "list controls and the read filter for the bell" },
  NotificationPage: { table: null, reason: "a page of notifications" },
  UrgentNoticeQuery: { table: null, reason: "list controls for the caller's open urgent notices" },
  UnreadCount: { table: null, reason: "a count of the caller's unread notifications" },
  NotificationEmailVars: { table: null, reason: "the variables of templates/email/notification.html, not a row" },
  NotificationReadStateQuery: { table: null, reason: "the ids of shown notifications to check" },
  NotificationReadState: { table: null, reason: "which of those ids are read" },
  NotificationChannels: { table: null, reason: "a category's three channels, from defaults and notification_preference rows" },
  NotificationCategoryPreference: { table: null, reason: "a category from shared/notifications/categories.js with its channels" },
  NotificationPreferences: { table: null, reason: "every category with its channels" },
  NotificationPreferenceUpdate: { table: "notification_preference" },
  PushConfig: { table: null, reason: "the environment's VAPID public key and whether push is on" },
  PushSubscriptionCreate: {
    table: "push_subscription",
    virtual: { device_token: "compared with device_token_hash, never stored" },
  },
  PushDevice: { table: "push_subscription" },
  PushDeviceSaved: {
    table: "push_subscription",
    virtual: { device_token: "issued once when a device is saved; only its hash is stored" },
  },
  PushDeviceListQuery: { table: null, reason: "list controls for the caller's devices" },
  PushDevicePage: { table: null, reason: "a page of devices" },
  PushTestRequest: { table: "push_subscription" },
  PushTestResult: { table: null, reason: "how many devices a test went to" },
  PushRenew: {
    table: "push_subscription",
    virtual: { device_token: "compared with device_token_hash, never stored" },
  },
  PushDeviceRead: {
    table: null,
    reason: "a device's proof and the notifications it marks read",
  },
  PushPayload: { table: null, reason: "the encrypted message a push service carries to the service worker" },
};

module.exports = {
  TABLES,
  NOTIFICATION_URGENCIES,
  NotificationUrgency,
  NotificationLink,
  Notification,
  NotificationListQuery,
  NotificationPage,
  UrgentNoticeQuery,
  UnreadCount,
  NavBadges,
  NotificationEmailVars,
  NotificationReadStateQuery,
  NotificationReadState,
  NotificationChannel,
  NotificationChannels,
  NotificationCategoryPreference,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  PushConfig,
  PushSubscriptionCreate,
  PushDevice,
  PushDeviceSaved,
  PushDeviceListQuery,
  PushDevicePage,
  PushTestRequest,
  PushTestResult,
  PushRenew,
  PushDeviceRead,
  PushPayload,
};

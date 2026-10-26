"use strict";
/**
 * Notifications: the inbox behind the bell (M0 notifications module) and what a
 * notification says when it goes out by email.
 *
 * The inbox is the caller's own and read-only but for the read mark: rows are written
 * by the fan-out (shared/notifications/fanout.js), never through the API.
 *
 * Also here (brought forward from M6, docs/guides/notifications.md): the person's own
 * preferences per category and channel, their quiet hours and digest, their devices with
 * web push on, the push a service worker receives, and the two calls a service worker
 * makes with its device token (renewing its subscription, Mark Read); and Settings ·
 * Notifications, the company's rule per notice and its reminders.
 */
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");
const { PersonRef } = require("./organisation");

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
// Inline, so the generated type is the three values, not any string.
const NotificationUrgency = z.enum(["normal", "important", "urgent"]);
const NOTIFICATION_URGENCIES = NotificationUrgency.options;

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

/** A screen's slug within its module, as shared/route-map.js lists it ("employees", "my-leave"). */
const TabSlug = z.string().regex(/^[a-z][a-z0-9-]*$/);

const BadgeCount = z.number().int().min(1);

/**
 * GET /notifications/badges: unread notifications counted where they open, for the rail, the
 * bottom bar, the More tiles (`modules`) and each module's tabs (`tabs`, by the tab's slug). A
 * module's tabs add up to its count. Only screens the reader may open, and only those with
 * something unread.
 */
const NavBadges = z
  .object({
    modules: z.record(ModuleKey, BadgeCount),
    tabs: z.record(ModuleKey, z.record(TabSlug, BadgeCount)),
  })
  .strict();

/**
 * GET /notifications/unread-records?module=&tab=&ids=a,b,c: which of the records a list shows (at
 * most 25, its page) carry an unread notice of the caller's that opens on that screen, so the list
 * marks them.
 */
const UnreadRecordsQuery = z
  .object({
    module: ModuleKey,
    tab: TabSlug,
    ids: z
      .string()
      .trim()
      .min(1)
      .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(uuid).min(1).max(25)),
  })
  .strict();

/** The asked ids with something unread there (the others are left out). */
const UnreadRecords = z.object({ ids: z.array(uuid) }).strict();

/**
 * POST /notifications/read-record: a record was opened on a screen, so the caller's unread notices
 * about it that open there are read (its dot, the tab's count and the module's go).
 */
const RecordRead = z
  .object({
    module: ModuleKey,
    tab: TabSlug,
    entity_id: uuid,
  })
  .strict();

/** Variables of templates/email/notification.html: one notification sent as an email. */
const NotificationEmailVars = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).default(""),
    link_url: z.string().url().nullable().default(null),
  })
  .strict();

/**
 * Variables of templates/email/digest.html: a person's daily digest, the notices that arrived in
 * the last 24 hours and are still unread, newest first, at most 25 listed.
 */
const NotificationDigestEmailVars = z
  .object({
    count: z.number().int().min(1),
    more: z.number().int().min(0),
    items: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            body: z.string().max(1000).default(""),
            when: isoDateTime,
            link_url: z.string().url().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(25),
    open_url: z.string().url(),
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

/** A wall-clock time in Lagos, HH:MM, 24 hour. */
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/**
 * A person's quiet hours and digest switch (`notification_setting`, defaults until they change
 * one), with the company's digest: whether it is sent at all, and at what time.
 */
const NotificationPersonalSettings = z
  .object({
    /** Pushes wait until quiet hours end; urgent notices and Security come through. */
    quiet_enabled: z.boolean(),
    quiet_from: ClockTime,
    quiet_to: ClockTime,
    /** The person's own switch for the daily digest. */
    digest: z.boolean(),
    digest_offered: z.boolean(),
    digest_at: ClockTime,
  })
  .strict();

/** GET /notifications/preferences: every category, in display order, and the person's settings. */
const NotificationPreferences = z
  .object({
    categories: z.array(NotificationCategoryPreference),
    settings: NotificationPersonalSettings,
  })
  .strict();

/** PUT /notifications/preferences: one category's one channel. */
const NotificationPreferenceUpdate = z
  .object({
    category: z.string().trim().regex(/^[a-z_]{2,40}$/),
    channel: NotificationChannel,
    enabled: z.boolean(),
  })
  .strict();

/** PUT /notifications/preferences/quiet-hours: on or off, and the two times (never the same). */
const QuietHoursUpdate = z
  .object({ quiet_enabled: z.boolean(), quiet_from: ClockTime, quiet_to: ClockTime })
  .strict()
  .refine((v) => v.quiet_from !== v.quiet_to, { message: "Pick two different times", path: ["quiet_to"] });

/** PUT /notifications/preferences/digest: the person's own digest on or off. */
const DigestUpdate = z.object({ digest: z.boolean() }).strict();

/* ------------------------------------------------------------------ *
 * Settings · Notifications: the company's rule per notice, and its reminders
 * ------------------------------------------------------------------ */

/** A role a notice is copied to, as the role picker names it. */
const NoticeRole = z.object({ code: z.string(), name: z.string() }).strict();

/**
 * One notice in Settings · Notifications: what the code declares, with the company's rule applied.
 * `urgency` is null for a notice whose poster chooses it (an announcement); `copies` is false for a
 * notice personal to its audience (a direct message, mail, a person's own account).
 */
const NotificationRule = z
  .object({
    event_key: z.string(),
    /** The event's summary in the catalogue. */
    name: z.string(),
    category: z.string(),
    category_label: z.string(),
    /** Who it goes to as built: "Approvers", "People · Approve", "The channel's members". */
    who: z.array(z.string()),
    /** Security: always on, its channels on by default stay on, its urgency fixed. */
    locked: z.boolean(),
    copies: z.boolean(),
    enabled: z.boolean(),
    urgency: NotificationUrgency.nullable(),
    /** As the code says, before the company's rule; null when chosen per notice. */
    urgency_default: NotificationUrgency.nullable(),
    /** The company's default channels for this notice, used where a person has not chosen. */
    channels: NotificationChannels,
    /** The category's defaults, before the company's rule. */
    defaults: NotificationChannels,
    roles: z.array(NoticeRole),
    people: z.array(PersonRef),
    /** The company changed something (Reset to Default is offered). */
    changed: z.boolean(),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

/** GET /notifications/rules: in category order, filtered by category, searched by name. */
const NotificationRuleQuery = listQuery({
  category: z.string().trim().regex(/^[a-z_]{2,40}$/).optional(),
});
const NotificationRulePage = Paged(NotificationRule);

/** A notice's key in a path: a declared event key. */
const NotificationRuleParams = z
  .object({ key: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).max(120) })
  .strict();

/** PUT /notifications/rules/:key: the whole rule for one notice. `urgency` null: as the code says. */
const NotificationRuleUpdate = z
  .object({
    enabled: z.boolean(),
    urgency: NotificationUrgency.nullable(),
    in_app: z.boolean(),
    email: z.boolean(),
    push: z.boolean(),
    role_codes: z.array(z.string().trim().min(1).max(60)).max(25),
    employee_ids: z.array(uuid).max(25),
  })
  .strict();

/** The company's reminders (docs/guides/notifications.md §6), defaults applied. */
const NotificationReminders = z
  .object({
    approvals: z
      .object({ enabled: z.boolean(), every_hours: z.number().int().min(1).max(168) })
      .strict(),
    probation: z
      .object({ enabled: z.boolean(), days_ahead: z.number().int().min(1).max(90) })
      .strict(),
    digest: z.object({ enabled: z.boolean(), at_time: ClockTime }).strict(),
  })
  .strict();

/** PUT /notifications/reminders: all three at once. */
const NotificationRemindersUpdate = NotificationReminders;

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
  NavBadges: { table: null, reason: "counts of the caller's unread notifications per module and per tab, where each opens" },
  UnreadRecordsQuery: { table: null, reason: "one screen and the ids of the records its list shows" },
  UnreadRecords: { table: null, reason: "which of those records carry an unread notification" },
  RecordRead: {
    table: "notification",
    virtual: {
      module: "the screen's module, from shared/route-map.js: which entity types open there",
      tab: "the screen's tab, from shared/route-map.js: which entity types open there",
    },
  },
  NotificationEmailVars: { table: null, reason: "the variables of templates/email/notification.html, not a row" },
  NotificationDigestEmailVars: { table: null, reason: "the variables of templates/email/digest.html, not a row" },
  NotificationReadStateQuery: { table: null, reason: "the ids of shown notifications to check" },
  NotificationReadState: { table: null, reason: "which of those ids are read" },
  NotificationChannels: { table: null, reason: "a category's three channels, from defaults and notification_preference rows" },
  NotificationCategoryPreference: { table: null, reason: "a category from shared/notifications/categories.js with its channels" },
  NotificationPreferences: { table: null, reason: "every category with its channels" },
  NotificationPreferenceUpdate: { table: "notification_preference" },
  NotificationPersonalSettings: {
    table: "notification_setting",
    virtual: {
      digest_offered: "whether the company sends the digest, from the digest's notification_reminder_rule or its default",
      digest_at: "the company's digest time, from the digest's notification_reminder_rule or its default",
    },
  },
  QuietHoursUpdate: { table: "notification_setting" },
  DigestUpdate: { table: "notification_setting" },
  NoticeRole: { table: null, reason: "a role's code and name, as the role picker names it" },
  NotificationRule: {
    table: null,
    reason: "a notice declared in code (shared/notifications/fanout.js) with its notification_rule and notification_rule_recipient rows applied",
  },
  NotificationRuleQuery: { table: null, reason: "list controls and the category filter for Settings · Notifications" },
  NotificationRulePage: { table: null, reason: "a page of notices" },
  NotificationRuleParams: { table: null, reason: "a notice's event key in the path" },
  NotificationRuleUpdate: {
    table: "notification_rule",
    virtual: {
      role_codes: "notification_rule_recipient rows, one per role",
      employee_ids: "notification_rule_recipient rows, one per person",
    },
  },
  NotificationReminders: {
    table: null,
    reason: "the three company reminders, each a notification_reminder_rule row or its defaults",
  },
  NotificationRemindersUpdate: {
    table: null,
    reason: "the three company reminders, each saved as a notification_reminder_rule row",
  },
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
  UnreadRecordsQuery,
  UnreadRecords,
  RecordRead,
  NotificationEmailVars,
  NotificationDigestEmailVars,
  NotificationReadStateQuery,
  NotificationReadState,
  NotificationChannel,
  NotificationChannels,
  NotificationCategoryPreference,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  ClockTime,
  NotificationPersonalSettings,
  QuietHoursUpdate,
  DigestUpdate,
  NoticeRole,
  NotificationRule,
  NotificationRuleQuery,
  NotificationRulePage,
  NotificationRuleParams,
  NotificationRuleUpdate,
  NotificationReminders,
  NotificationRemindersUpdate,
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

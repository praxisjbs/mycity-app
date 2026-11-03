"use strict";
/**
 * What the assistant may do about notices, as cards the person confirms (docs/guides/praxis-ai.md
 * §6.11, decision 33). It reads no notice of its own: a notice is about another record, which that
 * record's own module answers. A person's own settings (a kind of notice on one channel, quiet hours,
 * the daily digest) are anyone's, as the bell's Settings are, under Self-Service; the company's rule
 * for a notice and its reminders are Settings · Notifications', under the Settings grant its routes
 * ask. Each card runs the service function the screen's own switch or Save calls. A browser's push
 * subscription is made on that browser, never here.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { given, asForm } = require("../../shared/ai/change");
const { oneNamed } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const service = require("./notifications.service");
const rules = require("./notifications.rules");

const settingsPath = routeMap.screenPath("settings", "notifications");
const mine = (label) => () => [{ type: "notification_setting", id: "mine", label, status: "saved", link: null }];

module.exports = defineManifest({
  module: "settings",
  // The forms a card reaches with its record named, and the one made on a device (gate 23, praxis-ai.md decision 33).
  not_offered: {
    QuietHoursUpdate: "via notices.quiet_hours: the bell's Settings saves the switch and both times together; the card changes what it names (QuietHoursChange)",
    NotificationRuleUpdate: "via notice_rules.edit: a notice's rule is changed in its row on Settings, Notifications, which never names it; the card does (NotificationRuleChange)",
    NotificationRemindersUpdate: "via notice_reminders.edit: the reminders' form saves all three together; the card changes what it names (NotificationRemindersChange)",
    PushSubscriptionCreate: "device: a browser turns its own notifications on, with the keys only that browser holds",
  },
  actions: [
    {
      key: "notices.preference",
      label: "Save Notice Setting",
      description: "Turn one kind of my notices on or off on one channel: in the app, by email or by push",
      input: c.notifications.NotificationPreferenceUpdate,
      permission: ["ess", "edit"],
      risk: "standard",
      form: "none: a kind of notice is a switch per channel on the bell's Settings; the card names the kind and the channel",
      asks: [
        { field: "category", question: "Which kind of notice?", options: async ({ actor }) => (await service.preferences(actor)).categories.map((k) => k.label) },
        { field: "channel", question: "In the app, by email or by push?", choices: ["In The App", "By Email", "By Push"] },
        { field: "enabled", question: "On or off?", choices: ["On", "Off"] },
      ],
      // A kind written by its words (decision 34): matched among the person's own kinds.
      resolve: {
        category: async (value, actor) => {
          const kind = oneNamed((await service.preferences(actor)).categories, value, (k) => [k.label, k.category]);
          return kind ? kind.category : null;
        },
      },
      run: (values, actor) => service.setPreference(actor, values),
      readback: mine("Notice settings"),
      labels: { category: "Kind", channel: "Channel", enabled: "On" },
    },
    {
      key: "notices.quiet_hours",
      label: "Save Quiet Hours",
      description: "Change my quiet hours: on or off, from when and until when; only what changes",
      input: c.notifications.QuietHoursChange,
      permission: ["ess", "edit"],
      risk: "standard",
      form: "none: the bell's Settings saves the switch and both times together; the card changes what it names",
      run: async (values, actor) => {
        const { settings } = await service.preferences(actor);
        const body = asForm(c.notifications.QuietHoursUpdate, { quiet_enabled: settings.quiet_enabled, quiet_from: settings.quiet_from, quiet_to: settings.quiet_to, ...given(values) });
        return service.setQuietHours(actor, body);
      },
      readback: mine("Quiet hours"),
      labels: { quiet_enabled: "On", quiet_from: "From", quiet_to: "Until" },
    },
    {
      key: "notices.digest",
      label: "Save Digest",
      description: "Turn my daily digest of notices on or off",
      input: c.notifications.DigestUpdate,
      permission: ["ess", "edit"],
      risk: "standard",
      form: "none: the daily digest is a switch on the bell's Settings",
      asks: [{ field: "digest", question: "Turn your daily digest on or off?", choices: ["On", "Off"] }],
      run: (values, actor) => service.setDigest(actor, values),
      readback: mine("Daily digest"),
      labels: { digest: "Daily Digest" },
    },
    {
      key: "notice_rules.edit",
      label: "Save Notice Rule",
      description: "Change the company's rule for one notice: on or off, its urgency, its channels, and the roles and people copied; only what changes",
      input: c.notifications.NotificationRuleChange,
      permission: ["settings", "edit"],
      risk: "standard",
      form: "none: a notice's rule is changed in its row on Settings, Notifications, which never names it; the card does",
      picks: { employee_ids: "colleague" },
      // Which notice, by its name (decision 34): the first notices to tap, a name matched among all of them.
      asks: [{ field: "event_key", question: "Which notice is it?", options: () => rules.names() }],
      resolve: { event_key: (value) => rules.keyOf(value) },
      names: async (values) => {
        const rule = values.event_key ? await rules.one(values.event_key).catch(() => null) : null;
        return rule ? (rule.people || []).map((p) => ({ type: "employee", id: p.employee_id, label: p.display_name })) : [];
      },
      records: async (values) => {
        const rule = values.event_key ? await rules.one(values.event_key).catch(() => null) : null;
        return rule ? [{ type: "notification_rule", id: rule.event_key, label: rule.name }] : [];
      },
      // Saved whole as the row's Save does: what the card leaves out kept as the rule stands.
      run: async (values, actor) => {
        const { event_key: key, ...changes } = values;
        const rule = await rules.one(key);
        const body = asForm(c.notifications.NotificationRuleUpdate, {
          enabled: rule.enabled,
          urgency: rule.urgency,
          in_app: rule.channels.in_app,
          email: rule.channels.email,
          push: rule.channels.push,
          role_codes: rule.roles.map((r) => r.code),
          employee_ids: rule.people.map((p) => p.employee_id),
          ...given(changes),
        });
        return rules.save(actor, key, body);
      },
      readback: (rule) => [{ type: "notification_rule", id: rule.event_key, label: rule.name, status: "saved", link: settingsPath }],
      labels: { event_key: "Notice", enabled: "On", urgency: "Urgency", in_app: "In The App", email: "By Email", push: "By Push", role_codes: "Roles Copied", employee_ids: "People Copied" },
    },
    {
      key: "notice_reminders.edit",
      label: "Save Reminders",
      description: "Change the company's reminders: approvals waiting (on or off, every so many hours), probation ending (on or off, days ahead) and the daily digest (on or off, its time); only what changes",
      input: c.notifications.NotificationRemindersChange,
      permission: ["settings", "edit"],
      risk: "standard",
      form: "none: the reminders' form saves all three together; the card changes what it names",
      run: async (values, actor) => {
        const now = await rules.remindersOf();
        const v = given(values);
        const pick = (key, saved) => (key in v ? v[key] : saved);
        const body = asForm(c.notifications.NotificationRemindersUpdate, {
          approvals: { enabled: pick("approvals_enabled", now.approvals.enabled), every_hours: pick("approvals_every_hours", now.approvals.every_hours) },
          probation: { enabled: pick("probation_enabled", now.probation.enabled), days_ahead: pick("probation_days_ahead", now.probation.days_ahead) },
          digest: { enabled: pick("digest_enabled", now.digest.enabled), at_time: pick("digest_at_time", now.digest.at_time) },
        });
        return rules.saveReminders(actor, body);
      },
      readback: () => [{ type: "notification_reminder", id: "company", label: "Reminders", status: "saved", link: settingsPath }],
      labels: {
        approvals_enabled: "Approvals Reminder",
        approvals_every_hours: "Every (Hours)",
        probation_enabled: "Probation Reminder",
        probation_days_ahead: "Days Ahead",
        digest_enabled: "Daily Digest",
        digest_at_time: "Digest Time",
      },
    },
  ],
});

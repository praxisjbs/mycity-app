"use strict";
/**
 * What the assistant may read from Settings, and change as cards the person confirms. Everyone may
 * ask about the working week, the public holidays and the organisation's own details, so those
 * reads need only Self-Service; numbering schemes need Settings view. Security rules and sessions
 * are not something the assistant answers. Its cards (docs/guides/praxis-ai.md §6.11, decision 33)
 * are Settings' own forms, each through the service function the screen's button calls, with the
 * Settings grant the screen asks: the organisation's details (never its address, which is picked on
 * the map), a public holiday added or changed, one day of the working week, a numbering scheme.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { given, asForm } = require("../../shared/ai/change");
const routeMap = require("../../shared/route-map");
const repo = require("./settings.repo");
const service = require("./settings.service");

const organisationPath = routeMap.screenPath("settings", "organisation");
const numberingPath = routeMap.screenPath("settings", "documents-and-numbering");
const dayFirst = (iso) => String(iso || "").slice(0, 10).split("-").reverse().join("/");
/** A holiday a card made or changed, read back. */
const holidayLine = (status) => (h) => [{ type: "public_holiday", id: h.public_holiday_id, label: `${h.name}, ${dayFirst(h.holiday_date)}`, status, link: organisationPath }];
/** Which holiday, when the person did not say (decision 34): the list's own rows, matched by name. */
const whichHoliday = { field: "public_holiday_id", question: "Which holiday is it?", read: "holidays.list" };

module.exports = defineManifest({
  module: "settings",
  // A create or edit form never drafted here, and why (gate 23 rule 6, praxis-ai.md decision 33).
  not_offered: {
    SecurityPolicyPatch: "secret: the security policy (passwords, sign-in and two-step rules) is set on Settings, Security by those who hold it",
    WorkingWeekSave: "via working_week.day: the week's form saves all seven days together; the card changes one day and keeps the rest (WorkingDayChange)",
    NumberingSchemeSave: "via numbering.edit: Change Numbering's form edits the scheme open on Documents and Numbering and never names it; the card does (NumberingSchemeChange)",
  },
  actions: [
    {
      key: "organisation.edit",
      label: "Save Organisation",
      description: "Change the organisation's own details: legal or trading name, registration number, tax id, phone, email or website; only what changes",
      input: c.settings.OrganisationPatch,
      permission: ["settings", "edit"],
      risk: "standard",
      // The address is picked on the map, never typed (F27): it stays on Organisation's own form.
      fields: ["legal_name", "trading_name", "registration_number", "tax_id", "phone", "email", "website"],
      run: (values, actor) => service.updateOrganisation(values, actor),
      readback: () => [{ type: "organisation", id: "organisation", label: "Organisation", status: "saved", link: organisationPath }],
      labels: { legal_name: "Legal Name", trading_name: "Trading Name", registration_number: "Registration Number", tax_id: "Tax ID", phone: "Phone", email: "Email", website: "Website" },
    },
    {
      key: "holidays.add",
      label: "Add Holiday",
      description: "Add a public holiday: its day and its name",
      input: c.settings.HolidaySave,
      permission: ["settings", "create"],
      risk: "standard",
      asks: [
        { field: "name", question: "What is the holiday called?" },
        { field: "holiday_date", question: "Which day is it?" },
      ],
      run: (values, actor) => service.addHoliday(values, actor),
      readback: holidayLine("added"),
      labels: { holiday_date: "Day", name: "Name" },
    },
    {
      key: "holidays.edit",
      label: "Save Holiday",
      description: "Change a public holiday's day or name; only what changes",
      input: c.settings.HolidayChange,
      permission: ["settings", "edit"],
      risk: "standard",
      form: "none: a holiday is changed in its own row on Organisation, which never names it; the card does",
      asks: [whichHoliday],
      records: async (values, _actor, db) => {
        const h = db && values.public_holiday_id ? await repo.findHoliday(db, values.public_holiday_id) : null;
        return h ? [{ type: "public_holiday", id: h.public_holiday_id, label: `${h.name}, ${dayFirst(h.holiday_date)}` }] : [];
      },
      // Saved whole as the row's form saves it: the day and the name, what the card leaves out kept.
      run: async (values, actor) => {
        const { public_holiday_id: id, ...changes } = values;
        const saved = await service.holiday(id);
        const body = asForm(c.settings.HolidaySave, { holiday_date: saved ? saved.holiday_date : undefined, name: saved ? saved.name : undefined, ...given(changes) });
        return service.updateHoliday(id, body, actor);
      },
      readback: holidayLine("saved"),
      labels: { public_holiday_id: "Holiday", holiday_date: "Day", name: "Name" },
    },
    {
      key: "working_week.day",
      label: "Save Working Day",
      description: "Change one day of the working week: worked or not, and its start and end; the other days stay as they are",
      input: c.settings.WorkingDayChange,
      permission: ["settings", "edit"],
      risk: "standard",
      form: "none: the working week's form saves all seven days together; the card changes the one named",
      asks: [{ field: "weekday", question: "Which day of the week?" }],
      run: async (values, actor) => {
        const weekday = c.settings.WEEKDAY_NAMES.indexOf(values.weekday) + 1;
        const { days } = await service.week();
        const changes = given({ is_working_day: values.is_working_day, starts_at: values.starts_at, ends_at: values.ends_at });
        const body = asForm(c.settings.WorkingWeekSave, { days: days.map((d) => (d.weekday === weekday ? { ...d, ...changes } : d)) });
        return service.saveWeek(body, actor);
      },
      readback: () => [{ type: "working_week", id: "week", label: "Working week", status: "saved", link: organisationPath }],
      labels: { weekday: "Day", is_working_day: "Worked", starts_at: "Starts", ends_at: "Ends" },
    },
    {
      key: "numbering.edit",
      label: "Save Numbering",
      description: "Change how a document type is numbered: its prefix, digits, separator, when it restarts and whether it carries the period; only what changes",
      input: c.settings.NumberingSchemeChange,
      permission: ["settings", "edit"],
      risk: "standard",
      form: "none: Change Numbering's form edits the scheme open on Documents and Numbering and never names it; the card does",
      // Which numbering, by its document type's name (decision 34): the list's own rows, matched by their names.
      asks: [{ field: "doc_type", question: "Which numbering is it?", read: "numbering.list" }],
      run: async (values, actor) => {
        const { doc_type: docType, ...changes } = values;
        const saved = (await service.numberingList({ page: 1 })).data.find((r) => r.doc_type === docType) || {};
        const body = asForm(c.settings.NumberingSchemeSave, { prefix: saved.prefix, padding: saved.padding, separator: saved.separator, reset: saved.reset, include_period: saved.include_period, ...given(changes) });
        return service.saveScheme(docType, body, actor);
      },
      readback: (scheme) => [{ type: "numbering_scheme", id: scheme.doc_type, label: scheme.label || scheme.doc_type, status: "saved", link: numberingPath }],
      labels: { doc_type: "Document", prefix: "Prefix", padding: "Digits", separator: "Separator", reset: "Restarts", include_period: "Carries The Period" },
    },
  ],
  reads: [
    {
      key: "holidays.list",
      description: "List the public holidays, by date, optionally for one year",
      params: c.settings.HolidayListQuery,
      permission: ["ess", "view"],
      run: (client, params) => repo.holidayPage(client, params),
      cite: (row) => ({ type: "public_holiday", id: row.public_holiday_id, label: row.name }),
    },
    {
      key: "working_week.get",
      description: "The working week: which days are worked and the hours of each",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: () => service.week(),
      cite: () => null,
    },
    {
      key: "organisation.get",
      description: "The organisation's own details: legal name, trading name, address and contacts",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: () => service.organisation(),
      cite: () => null,
    },
    {
      key: "numbering.list",
      description: "List the numbering scheme of each numbered document type, with the next number",
      params: c.settings.NumberingListQuery,
      permission: ["settings", "view"],
      run: (_client, params) => service.numberingList(params),
      cite: (row) => ({ type: "numbering_scheme", id: row.doc_type, label: row.label }),
    },
  ],
  routes: [
    { intent: "add a public holiday", screen: "settings.organisation", params: { new: "1" } },
    { intent: "change the working week", screen: "settings.organisation" },
    { intent: "change a numbering scheme", screen: "settings.documents-and-numbering" },
    { intent: "change the security rules", screen: "settings.security" },
  ],
});

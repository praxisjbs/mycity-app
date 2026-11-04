"use strict";
/**
 * What the assistant may read on Home, Reports, and where it sends a person
 * (docs/guides/home.md §9; A23: it reads, it never writes).
 *
 *   reports.mine   the reports the asker owns or receives, a page of 25 by name, with each
 *                  one's schedule and status; an empty page without `home.reports`
 *   runs.mine      the files the asker received, newest first, a page of 25: which are done,
 *                  waiting, failed or skipped; an empty page without `home.reports`
 *
 * Every login holds `home` view, which is all the assistant checks, so each read asks what
 * the Reports tab asks (reports.service.js): the capability, then the reports the asker may
 * see. Running and archiving a report are the person's own acts on the tab.
 *
 *   reports.create, reports.edit, reports.schedule   Build Report, a report's name and sharing,
 *                  and its schedule, as cards the person confirms (docs/guides/praxis-ai.md §6.11,
 *                  decision 33), held to `home.reports` as the routes are. A report's filters stay
 *                  on its own form, where each report type shows its own.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { asForm, given } = require("../../shared/ai/change");
const routeMap = require("../../shared/route-map");
const community = require("../community/community.service");
const service = require("./reports.service");

const reportsPath = routeMap.screenPath("home", "reports");
const reportLine = (status) => (r) => [{ type: "home_report", id: r.saved_report_id, label: r.name, status, link: reportsPath }];
/** Which report (praxis-ai.md decision 34): the person's own from Reports, matched by name. */
const whichReport = { field: "saved_report_id", question: "Which report is it?", read: "reports.mine" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

module.exports = defineManifest({
  module: "home",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    HomeReportUpdate: "via reports.edit: a report is changed on its own form, which never names it; the card does (HomeReportChange)",
    HomeReportScheduleSave: "via reports.schedule: a schedule is set inside the report's own form; the card names the report and takes the schedule as a person says it (HomeReportScheduleChange)",
  },
  actions: [
    {
      key: "reports.create",
      label: "Create Report",
      description: "Build a report on Home: its name, which report it is, and whether others may see it; its filters and schedule are set afterwards",
      input: c.reports.HomeReportCreate,
      permission: ["home", "view"],
      // As the route: Home view, which every login holds, and the authority to build reports.
      capability: "home.reports",
      risk: "standard",
      form: "none: Build Report shows each report type's own filters and a schedule; the card carries its name, its type and its sharing",
      fields: ["name", "report_key", "shared"],
      asks: [
        { field: "name", question: "What is the report called?" },
        { field: "report_key", question: "Which report is it?" },
      ],
      run: (values, actor) => service.create(actor, values),
      readback: reportLine("built"),
      labels: { name: "Name", report_key: "Report", shared: "Shared" },
    },
    {
      key: "reports.edit",
      label: "Save Report",
      description: "Rename a report I may change, or share it or stop sharing it; only what changes",
      input: c.reports.HomeReportChange,
      permission: ["home", "view"],
      capability: "home.reports",
      risk: "standard",
      form: "none: a report is changed on its own form, which never names it; the card does",
      asks: [whichReport],
      run: (values, actor) => {
        const { saved_report_id: id, ...changes } = values;
        return service.update(actor, id, given(changes));
      },
      readback: reportLine("saved"),
      labels: { saved_report_id: "Report", name: "Name", shared: "Shared" },
    },
    {
      key: "reports.schedule",
      label: "Schedule Report",
      description: "Schedule a report: daily, weekly (on which days, 1 Monday to 7 Sunday) or monthly (on which day), at what time, as PDF or Excel or both, and who receives it",
      input: c.reports.HomeReportScheduleChange,
      permission: ["home", "view"],
      capability: "home.reports",
      risk: "standard",
      form: "none: a schedule is set inside the report's own form; the card names the report and takes the schedule as a person says it",
      asks: [
        whichReport,
        { field: "freq", question: "How often should it run?", choices: ["Daily", "Weekly", "Monthly"] },
        { field: "run_time", question: "At what time?", choices: ["08:00", "17:00"] },
        { field: "formats", question: "PDF, Excel or both?", choices: ["PDF", "Excel", "Both"] },
        { field: "recipient_user_ids", question: "Who should receive it?", choices: ["Just Me"] },
      ],
      // Who receives it, by name or "just me" (decision 34): a colleague's login, matched in the directory.
      resolve: { recipient_user_ids: (value, actor) => (/^just me$/i.test(value) ? actor.user_id : community.loginNamed(actor.user_id, value)) },
      names: (values, _actor, db) => (db ? community.loginNames(db, values.recipient_user_ids) : []),
      // Saved as the report's own form saves its schedule: the recurrence, the first day (today when not said), the time, the formats, the people.
      run: (values, actor) => {
        const recurrence = given({ freq: values.freq, by_weekday: values.by_weekday, by_month_day: values.by_month_day, working_days_only: values.working_days_only });
        const schedule = asForm(c.reports.HomeReportScheduleSave, { recurrence, starts_on: values.starts_on || today(), run_time: values.run_time, formats: values.formats, recipient_user_ids: values.recipient_user_ids });
        return service.update(actor, values.saved_report_id, { schedule });
      },
      readback: reportLine("scheduled"),
      labels: { saved_report_id: "Report", freq: "How Often", by_weekday: "Days", by_month_day: "Day Of Month", working_days_only: "Working Days Only", starts_on: "From", run_time: "At", formats: "Formats", recipient_user_ids: "Recipients" },
    },
  ],
  reads: [
    {
      key: "reports.mine",
      description: "List the reports I own or receive, with each one's schedule, formats and recipients",
      params: c.reports.HomeReportQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => service.forAssistant(client, actor, params),
      cite: (row) => ({ type: "home_report", id: row.saved_report_id, label: row.name }),
    },
    {
      key: "runs.mine",
      description: "List the report files I received, newest first, and whether each is done, waiting, failed or skipped",
      params: c.reports.HomeReportRunQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => service.runsForAssistant(client, actor, params),
      cite: (row) => ({ type: "home_report_run", id: row.home_report_run_id, label: row.number }),
    },
  ],
  routes: [
    { intent: "open a report", screen: "home.reports" },
    { intent: "build, schedule or run a report", screen: "home.reports" },
    { intent: "see the report files sent to me", screen: "home.reports" },
  ],
});

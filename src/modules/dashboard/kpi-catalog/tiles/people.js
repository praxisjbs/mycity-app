"use strict";
/**
 * People cards: the organisation's staff and their day, a person's own attendance and
 * leave, and the four cards of the Team tab.
 *
 * Each figure is read through the module that owns it, so a card and that module's own
 * screen give the same number:
 *
 *   headcount, attrition, confirmations   organisation.service counts(), People · Employees' definition
 *   who is in today, a person's month     the shared attendance roster (attendance.roster.js)
 *   leave                                 the leave module's reads (leave.repo.js)
 *   documents requested                   the documents module's open request (documents.repo.js)
 *   open vacancies, reviews due           their source adapters (src/modules/dashboard/sources)
 *
 * The roster cards count and list the same rows: a card's figure is the roster's summary
 * and its records are the roster's page, in the reader's scope on the card's module (`people`
 * for Clocked In Today; `home` for the Team cards, so they cover the Team tab's people).
 */
const organisation = require("../../../organisation/organisation.service");
const roster = require("../../../attendance/attendance.roster");
const leave = require("../../../leave/leave.repo");
const { REQUEST_STILL_OPEN } = require("../../../documents/documents.repo");
const vacancies = require("../../sources/vacancies.source");
const reviews = require("../../sources/reviews.source");
const { pageQuery, orderBy, pageOf, envelope, TOTAL_COL } = require("../../../../shared/http/paged");
const { scopeClause } = require("../../../../shared/rbac/scope");
const lagos = require("../../../../shared/time/lagos");
const routeMap = require("../../../../shared/route-map");
const { PERSON, cell, linkTo, record, records } = require("../shared");

/** The person whose own cards these are; a login always has one (no login without an employee). */
function me(ctx) {
  if (!ctx.user || !ctx.user.employee_id) throw new Error("a personal card needs the reader's employee");
  return ctx.user.employee_id;
}

const display = (first, last) => `${first} ${last}`.trim();

/* ------------------------------------------------------------------ *
 * The roster: Clocked In Today and the Team cards
 * ------------------------------------------------------------------ */

/** A roster status as a pill. */
const STATUS_PILL = Object.freeze({
  on_site: ["ok", "On Site"],
  remote: ["info", "Remote"],
  late: ["warn", "Late"],
  absent: ["err", "Absent"],
  not_in: ["neutral", "Not In"],
  on_leave: ["neutral", "On Leave"],
});

/**
 * The roster's statuses as chips, then its one flag. Absent is not a chip: the cards read
 * today, and a day is absent only once the day-close has closed it.
 */
const ROSTER_GROUPS = Object.freeze([
  { value: "on_site", label: "On Site" },
  { value: "remote", label: "Remote" },
  { value: "late", label: "Late" },
  { value: "not_in", label: "Not In" },
  { value: "on_leave", label: "On Leave" },
  { value: "no_clock_out_yesterday", label: "No Clock-Out Yesterday" },
]);

const ROSTER_COLUMNS = Object.freeze([
  { key: "employee", label: "Employee" },
  { key: "status", label: "Status", phone: true },
  { key: "clock_in", label: "Clock-In", phone: true },
  { key: "clock_out", label: "Clock-Out" },
  { key: "worksite", label: "Worksite" },
]);

/** A roster summary as a figure: present out of expected, with every count the chips show. */
const rosterFigure = (s) => ({
  value: s.present,
  denominator: s.expected,
  on_site: s.on_site,
  remote: s.remote,
  late: s.late,
  on_leave: s.on_leave,
  no_clock_out_yesterday: s.no_clock_out_yesterday,
  groups: {
    on_site: s.on_site,
    remote: s.remote,
    late: s.late,
    not_in: s.not_in,
    on_leave: s.on_leave,
    no_clock_out_yesterday: s.no_clock_out_yesterday,
  },
});

/**
 * Each reader's roster summaries, by module, kept for as long as their context lives: the
 * four Team cards count from one summary, so a row of them reads it once, not four times.
 * A context is made for one read of one person's cards (index.context), so nothing here
 * outlives the request or crosses to another reader.
 */
const SUMMARIES = new WeakMap();

/** Today's roster summary in the reader's scope on `module`, read once per context. */
const summaryIn = (module) => (client, ctx) => {
  let byModule = SUMMARIES.get(ctx);
  if (!byModule) {
    byModule = new Map();
    SUMMARIES.set(ctx, byModule);
  }
  if (!byModule.has(module)) byModule.set(module, roster.summary(client, { date: ctx.today }, ctx.scope(module)));
  return byModule.get(module);
};

function rosterRecord(r) {
  const pill = STATUS_PILL[r.status];
  return record(
    r.employee_id,
    {
      employee: cell.person({
        employee_id: r.employee_id,
        display_name: display(r.first_name, r.last_name),
        job_title: r.job_title,
        department: r.department,
        photo_url: r.photo_url ?? null,
      }),
      status: pill ? cell.pill(pill[0], pill[1]) : null,
      clock_in: cell.time(r.clock_in_at),
      clock_out: cell.time(r.clock_out_at),
      worksite: cell.text(r.worksite),
    },
    linkTo("employee", r.employee_id),
  );
}

/**
 * Today's roster, one page, in the reader's scope on `module`. A chip is a status or the
 * flag. `fixed` keeps a card to one status whatever the chip; `flagged` keeps it to the
 * people flagged today (late, or no clock-out yesterday), each once, and a chip narrows
 * within them.
 */
function rosterList(module, { fixed = null, flagged = false } = {}) {
  return async (client, query, ctx) => {
    const group = fixed || query.group;
    const filters = { date: ctx.today, q: query.q };
    if (group === "no_clock_out_yesterday") filters.no_clock_out_yesterday = true;
    else if (group) filters.status = group;
    if (flagged) filters.flagged = true;
    return records(await roster.page(client, filters, ctx.scope(module), query), rosterRecord);
  };
}

/* ------------------------------------------------------------------ *
 * The staff register: headcount, leavers, confirmations
 * ------------------------------------------------------------------ */

/** The register's counts (organisation.service counts), in the reader's `people` scope. */
const registerCounts = (client, ctx) => organisation.counts(client, ctx.scope("people"), { today: ctx.today });

const EMPLOYEE_COLUMNS = Object.freeze([
  { key: "employee", label: "Employee" },
  { key: "department", label: "Department", phone: true },
]);

/**
 * One page of the register's people that `condition` keeps ($1 is today), with the date
 * column `dated` beside them, in the reader's `people` scope. The conditions are the
 * register's own, as organisation.repo.js counts() writes them, so the list behind a card
 * holds exactly the people its figure counted.
 */
function registerPage(condition, dated, order) {
  return async (client, query, ctx) => {
    const params = [ctx.today, query.q || null];
    const s = scopeClause(ctx.scope("people"), { column: "e.employee_id" }, params);
    const page = await pageQuery(
      client,
      `SELECT e.employee_id, ${PERSON("e", "d")} AS employee, d.name AS department, e.${dated} AS dated, ${TOTAL_COL}
         FROM employee e
         LEFT JOIN department d ON d.department_id = e.department_id
        WHERE ${condition}
          AND ($2::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($2) || '%')
          ${s.and}
        ORDER BY ${orderBy(query, { [dated]: order }, "e.employee_id")}`,
      params,
      query,
    );
    return records(page, (r) =>
      record(
        r.employee_id,
        { employee: cell.person(r.employee), department: cell.text(r.department), [dated]: cell.date(r.dated) },
        linkTo("employee", r.employee_id),
      ),
    );
  };
}

/** Left in the last 90 days (counts() `attrition`). */
const LEFT_RECENTLY = "e.left_on IS NOT NULL AND e.left_on >= $1::date - 90";

/** Active, not yet confirmed, confirmation due within 30 days (counts() `probation_due`). */
const CONFIRMATION_DUE = `e.status = 'active' AND e.confirmed_on IS NULL AND e.confirmation_due_on IS NOT NULL
  AND e.confirmation_due_on <= $1::date + 30`;

/* ------------------------------------------------------------------ *
 * Documents requested
 * ------------------------------------------------------------------ */


async function requestedCount(client, ctx) {
  const params = [];
  const s = scopeClause(ctx.scope("people"), { column: "r.employee_id" }, params);
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM document_request r WHERE ${REQUEST_STILL_OPEN} ${s.and}`,
    params,
  );
  return rows[0].n;
}

async function requestedPage(client, query, ctx) {
  const params = [query.q || null];
  const s = scopeClause(ctx.scope("people"), { column: "r.employee_id" }, params);
  const page = await pageQuery(
    client,
    `SELECT r.document_request_id, r.title, r.requested_at, ${PERSON("e", "d")} AS employee, ${TOTAL_COL}
       FROM document_request r
       JOIN employee e ON e.employee_id = r.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ${REQUEST_STILL_OPEN}
        AND ($1::text IS NULL OR search_fold(r.title || ' ' || e.first_name || ' ' || e.last_name)
                                 LIKE '%' || search_fold($1) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { requested_at: "r.requested_at" }, "r.document_request_id")}`,
    params,
    query,
  );
  return records(page, (r) =>
    record(
      r.document_request_id,
      { employee: cell.person(r.employee), document: cell.text(r.title), requested: cell.time(r.requested_at) },
      linkTo("document_request", r.document_request_id),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * A person's own: attendance over 30 days, leave left
 * ------------------------------------------------------------------ */

/** Days My Attendance covers, today included. */
const ATTENDANCE_DAYS = 30;

const OUTCOME_PILL = Object.freeze({
  on_time: ["ok", "On Time"],
  late: ["warn", "Late"],
  absent: ["err", "Absent"],
  on_leave: ["neutral", "On Leave"],
});

/**
 * What a day of the roster's personal read counted as, the way its totals and My Attendance
 * count it (attendance.roster.js outcomeOf over the attendance module's own record of the
 * day): a day with no record yet, or after today, counts as nothing.
 */
function outcomeOf(day, today) {
  if (day.date > today) return null;
  return roster.outcomeOf(day.day_status);
}

/** The reader's own last 30 days, from the shared roster. */
const myDays = (client, ctx) =>
  roster.personal(client, {
    employee_id: me(ctx),
    from: lagos.addDays(ctx.today, 1 - ATTENDANCE_DAYS),
    to: ctx.today,
    today: ctx.today,
  });

/** The reader's counted days, newest first, one chip's when one is chosen, one page of them. */
async function myDaysPage(client, query, ctx) {
  const { days } = await myDays(client, ctx);
  const counted = days
    .map((d) => ({ ...d, outcome: outcomeOf(d, ctx.today) }))
    .filter((d) => d.outcome && (!query.group || d.outcome === query.group))
    .reverse();
  const { number, size, offset } = pageOf(query);
  const link = routeMap.screenPath("ess", "my-attendance");
  const data = counted.slice(offset, offset + size).map((d) => {
    const pill = OUTCOME_PILL[d.outcome];
    return record(
      d.date,
      {
        date: cell.date(d.date),
        status: cell.pill(pill[0], pill[1]),
        clock_in: cell.time(d.clock_in_at),
        clock_out: cell.time(d.clock_out_at),
      },
      link,
    );
  });
  return envelope(data, number, counted.length);
}

/**
 * The leave type My Leave leads with: Annual, else the first type with an allowance (the
 * same choice app/src/features/ess/Leave.tsx makes), or null when no type has one.
 */
function leadBalance(balances) {
  return balances.find((b) => b.code === "annual") || balances.find((b) => b.entitled !== null) || null;
}

/** The reader's year of leave, every type (the leave module's own read). */
const myYear = (client, ctx) => leave.balances(client, me(ctx), Number(ctx.today.slice(0, 4)), ctx.today);

async function myYearPage(client, query, ctx) {
  const year = await myYear(client, ctx);
  const { number, size, offset } = pageOf(query);
  const link = routeMap.screenPath("ess", "my-leave");
  const data = year.slice(offset, offset + size).map((b) =>
    record(
      b.leave_type_id,
      {
        leave_type: cell.text(b.name),
        allowance: cell.number(b.entitled),
        taken: cell.number(b.taken),
        booked: cell.number(b.booked),
        waiting: cell.number(b.pending),
        left: cell.number(b.remaining),
      },
      link,
    ),
  );
  return envelope(data, number, year.length);
}

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

const REVIEW_TYPE = Object.freeze({ self: "Self", manager: "Manager", designated: "Designated" });

/**
 * A review behind a card, its link the reader's own view when the review is of them. My
 * Reviews Due leaves out who reviews: it is the reader.
 */
const reviewRecord = (ctx, { reviewer = true } = {}) => (r) =>
  record(
    r.performance_review_id,
    {
      employee: cell.person(r.employee),
      ...(reviewer ? { reviewer: cell.text(r.reviewer) } : {}),
      type: cell.text(REVIEW_TYPE[r.review_type] || r.review_type),
      cycle: cell.text(r.cycle),
      closes: cell.date(r.closes_at ? lagos.dateOf(r.closes_at) : null),
    },
    linkTo("review", r.performance_review_id, { self: r.employee.employee_id === ctx.user.employee_id }),
  );

const ENTRIES = [
  {
    id: "headcount",
    domain: "people",
    label: "Headcount",
    unit: "count",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "organisation",
    value: (client, g, ctx) => g.count(async () => (await registerCounts(client, ctx)).headcount),
    detail: {
      title: "Headcount",
      columns: [...EMPLOYEE_COLUMNS, { key: "start_date", label: "Start Date" }],
      groups: [],
      list: async (client, query, ctx) =>
        records(
          await organisation.list(client, { page: query.page, q: query.q, status: "active" }, ctx.scope("people")),
          (r) =>
            record(
              r.employee_id,
              {
                employee: cell.person({
                  employee_id: r.employee_id,
                  display_name: r.display_name,
                  job_title: r.job_title,
                  department: r.department,
                  photo_url: r.photo_url ?? null,
                }),
                department: cell.text(r.department),
                start_date: cell.date(r.start_date),
              },
              linkTo("employee", r.employee_id),
            ),
        ),
    },
  },
  {
    id: "attendance_today",
    domain: "people",
    label: "Clocked In Today",
    unit: "pair",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "attendance",
    value: (client, g, ctx) => g.ratio(async () => rosterFigure(await summaryIn("people")(client, ctx))),
    caption: (f) => (f.late > 0 ? `${f.late} late` : null),
    detail: {
      title: "Clocked In Today",
      summary: (f) => `${f.value} of ${f.denominator} clocked in`,
      columns: ROSTER_COLUMNS,
      groups: ROSTER_GROUPS,
      list: rosterList("people"),
    },
  },
  {
    id: "leave_pending",
    domain: "people",
    label: "Leave Awaiting Approval",
    unit: "count",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "leave",
    value: (client, g, ctx) =>
      g.count(async () => (await leave.summary(client, ctx.today, ctx.scope("people"))).pending),
    detail: {
      title: "Leave Awaiting Approval",
      columns: [
        { key: "employee", label: "Employee" },
        { key: "leave_type", label: "Leave Type", phone: true },
        { key: "starts_on", label: "From", phone: true },
        { key: "ends_on", label: "To" },
        { key: "days", label: "Days", numeric: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(
          await leave.list(client, { status: "submitted", q: query.q, page: query.page }, ctx.scope("people")),
          (r) =>
            record(
              r.leave_request_id,
              {
                employee: cell.person(r.employee),
                leave_type: cell.text(r.leave_type_name),
                starts_on: cell.date(r.starts_on),
                ends_on: cell.date(r.ends_on),
                days: cell.number(r.days),
              },
              linkTo("leave_request", r.leave_request_id),
            ),
        ),
    },
  },
  {
    id: "vacancies_open",
    domain: "people",
    label: "Open Vacancies",
    unit: "count",
    module: "recruitment",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "vacancies",
    value: (client, g, ctx) => g.count(() => vacancies.openCount(client, ctx.scope("recruitment"))),
    detail: {
      title: "Open Vacancies",
      columns: [
        { key: "vacancy", label: "Vacancy" },
        { key: "department", label: "Department", phone: true },
        { key: "hiring_manager", label: "Hiring Manager" },
        { key: "positions", label: "Positions", numeric: true },
        { key: "closes", label: "Closes", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await vacancies.openPage(client, ctx.scope("recruitment"), query), (r) =>
          record(
            r.vacancy_id,
            {
              vacancy: cell.text(r.title),
              department: cell.text(r.department),
              hiring_manager: cell.person(r.hiring_manager),
              positions: cell.number(r.positions),
              closes: cell.date(r.closes_at ? lagos.dateOf(r.closes_at) : null),
            },
            linkTo("vacancy", r.vacancy_id),
          ),
        ),
    },
  },
  {
    id: "attrition_90d",
    domain: "people",
    label: "Attrition, 90 Days",
    unit: "count",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "organisation",
    value: (client, g, ctx) => g.count(async () => (await registerCounts(client, ctx)).attrition_90d),
    detail: {
      title: "Left in 90 Days",
      columns: [...EMPLOYEE_COLUMNS, { key: "left_on", label: "Left On", phone: true }],
      groups: [],
      list: registerPage(LEFT_RECENTLY, "left_on", "e.left_on DESC"),
    },
  },
  {
    id: "confirmations_due",
    domain: "people",
    label: "Confirmations Due",
    unit: "count",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "organisation",
    value: (client, g, ctx) => g.count(async () => (await registerCounts(client, ctx)).confirmations_due),
    detail: {
      title: "Confirmations Due",
      columns: [...EMPLOYEE_COLUMNS, { key: "confirmation_due_on", label: "Due On", phone: true }],
      groups: [],
      list: registerPage(CONFIRMATION_DUE, "confirmation_due_on", "e.confirmation_due_on"),
    },
  },
  {
    id: "documentation_pending",
    domain: "people",
    label: "Documents Requested",
    unit: "count",
    module: "people",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "documents",
    value: (client, g, ctx) => g.count(() => requestedCount(client, ctx)),
    detail: {
      title: "Documents Requested",
      columns: [
        { key: "employee", label: "Employee" },
        { key: "document", label: "Document", phone: true },
        { key: "requested", label: "Requested", phone: true },
      ],
      groups: [],
      list: requestedPage,
    },
  },
  {
    id: "reviews_due",
    domain: "people",
    label: "Reviews Due",
    unit: "count",
    module: "performance",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "reviews",
    value: (client, g, ctx) => g.count(() => reviews.dueCount(client, { today: ctx.today }, ctx.scope("performance"))),
    detail: {
      title: "Reviews Due",
      columns: [
        { key: "employee", label: "Employee" },
        { key: "reviewer", label: "Reviewer", phone: true },
        { key: "type", label: "Type" },
        { key: "cycle", label: "Cycle" },
        { key: "closes", label: "Closes", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(
          await reviews.duePage(client, { today: ctx.today }, ctx.scope("performance"), query),
          reviewRecord(ctx),
        ),
    },
  },
  {
    id: "my_attendance_30d",
    domain: "people",
    label: "My Attendance",
    unit: "pair",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "attendance",
    value: (client, g, ctx) =>
      g.ratio(async () => {
        const { totals: t } = await myDays(client, ctx);
        return {
          value: t.on_time,
          denominator: t.expected,
          late: t.late,
          groups: { on_time: t.on_time, late: t.late, absent: t.absent, on_leave: t.on_leave },
        };
      }),
    caption: (f) => (f.late > 0 ? `${f.late} late` : null),
    detail: {
      title: "My Attendance",
      summary: (f) => `${f.value} of ${f.denominator} days on time`,
      columns: [
        { key: "date", label: "Date" },
        { key: "status", label: "Status", phone: true },
        { key: "clock_in", label: "Clock-In", phone: true },
        { key: "clock_out", label: "Clock-Out" },
      ],
      groups: [
        { value: "on_time", label: "On Time" },
        { value: "late", label: "Late" },
        { value: "absent", label: "Absent" },
        { value: "on_leave", label: "On Leave" },
      ],
      list: myDaysPage,
    },
  },
  {
    id: "my_reviews_due",
    domain: "people",
    label: "My Reviews Due",
    unit: "count",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "reviews",
    value: (client, g, ctx) =>
      g.count(() => reviews.reviewerDueCount(client, { today: ctx.today, employee_id: me(ctx) })),
    detail: {
      title: "My Reviews Due",
      columns: [
        { key: "employee", label: "Review Of" },
        { key: "type", label: "Type", phone: true },
        { key: "cycle", label: "Cycle" },
        { key: "closes", label: "Closes", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(
          await reviews.reviewerDuePage(client, { today: ctx.today, employee_id: me(ctx) }, query),
          reviewRecord(ctx, { reviewer: false }),
        ),
    },
  },
  {
    id: "my_leave_left",
    domain: "people",
    label: "My Leave Left",
    unit: "days",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "leave",
    // No leave type with an allowance: nothing to count down, so the card is left out.
    value: (client, g, ctx) =>
      g.figure(async () => {
        const lead = leadBalance(await myYear(client, ctx));
        return lead && lead.remaining !== null ? { value: lead.remaining, leave_type: lead.name } : null;
      }),
    caption: (f) => `${f.leave_type}, this year`,
    detail: {
      title: "My Leave Left",
      summary: (f) => `${f.value} days of ${f.leave_type} left this year`,
      columns: [
        { key: "leave_type", label: "Leave Type" },
        { key: "allowance", label: "Allowance", numeric: true },
        { key: "taken", label: "Taken", numeric: true },
        { key: "booked", label: "Booked", numeric: true },
        { key: "waiting", label: "Waiting", numeric: true },
        { key: "left", label: "Left", numeric: true, phone: true },
      ],
      groups: [],
      list: myYearPage,
    },
  },
  {
    id: "team_present",
    domain: "people",
    label: "Present Today",
    unit: "pair",
    module: "home",
    capability: "home.team",
    sensitive_field: null,
    status: "live",
    pickable: false,
    tone: null,
    source: "attendance",
    value: (client, g, ctx) => g.ratio(async () => rosterFigure(await summaryIn("home")(client, ctx))),
    caption: (f) => (f.on_leave > 0 ? `${f.on_leave} on leave` : null),
    detail: {
      title: "Present Today",
      summary: (f) => `${f.value} of ${f.denominator} in today`,
      columns: ROSTER_COLUMNS,
      groups: ROSTER_GROUPS,
      list: rosterList("home"),
    },
  },
  {
    id: "team_on_site",
    domain: "people",
    label: "On Site",
    unit: "count",
    module: "home",
    capability: "home.team",
    sensitive_field: null,
    status: "live",
    pickable: false,
    tone: null,
    source: "attendance",
    value: (client, g, ctx) => g.count(async () => (await summaryIn("home")(client, ctx)).on_site),
    detail: {
      title: "On Site Today",
      columns: ROSTER_COLUMNS,
      groups: [],
      list: rosterList("home", { fixed: "on_site" }),
    },
  },
  {
    id: "team_remote",
    domain: "people",
    label: "Remote",
    unit: "count",
    module: "home",
    capability: "home.team",
    sensitive_field: null,
    status: "live",
    pickable: false,
    tone: null,
    source: "attendance",
    value: (client, g, ctx) => g.count(async () => (await summaryIn("home")(client, ctx)).remote),
    detail: {
      title: "Remote Today",
      columns: ROSTER_COLUMNS,
      groups: [],
      list: rosterList("home", { fixed: "remote" }),
    },
  },
  {
    id: "team_flags",
    domain: "people",
    label: "Flags",
    unit: "count",
    module: "home",
    capability: "home.team",
    sensitive_field: null,
    status: "live",
    pickable: false,
    tone: "warn",
    source: "attendance",
    // The people late today or with no clock-out on the last working day, each once, so the
    // figure is the number of records behind it. Someone who carries both is in both chips.
    value: (client, g, ctx) =>
      g.figure(async () => {
        const s = await summaryIn("home")(client, ctx);
        return {
          value: s.flagged,
          late: s.late,
          no_clock_out_yesterday: s.no_clock_out_yesterday,
          groups: { late: s.late, no_clock_out_yesterday: s.no_clock_out_yesterday },
        };
      }),
    caption: (f) => (f.value > 0 ? `${f.late} late, ${f.no_clock_out_yesterday} no clock-out` : null),
    detail: {
      title: "Flags Today",
      columns: ROSTER_COLUMNS,
      groups: [
        { value: "late", label: "Late" },
        { value: "no_clock_out_yesterday", label: "No Clock-Out Yesterday" },
      ],
      list: rosterList("home", { flagged: true }),
    },
  },
];

module.exports = { ENTRIES, leadBalance, outcomeOf };

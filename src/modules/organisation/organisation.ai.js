"use strict";
/**
 * What the assistant may read about the organisation, and the changes it drafts as cards the
 * person confirms (docs/guides/praxis-ai.md §6.11, decision 33; organisation.cards.js): Add
 * Employee and Save Record with the work record alone (personal details, bank and pay are never on
 * a card: JBS Praxis, 03/11/2026), Save Line, Add Department and Save Department, Add Role and Save
 * Role, each through the function the screen's own button reaches, under its route's rules.
 *
 * It answers "who reports to whom", "who reports to X", "how many people are in
 * <department>", "who heads <department>" and "which roles are vacant" from the same rows the screens read, in
 * the caller's own scope, 25 at a time (docs/guides/organogram.md §9); employees.summary counts the
 * register by department, status, arrangement, type, manager or confirmation due (figures, never rows,
 * docs/guides/praxis-ai.md §6.13).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const worksites = require("../worksites/worksites.service");
const cards = require("./organisation.cards");
const repo = require("./organisation.repo");
const service = require("./organisation.service");

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): the register must list someone in the
 * asker's reach (a report of theirs, else themselves) and never an outsider, whose record a team or
 * own scope does not reach.
 */
const probe = {
  inside: (ctx) => ({ type: "employee", id: ctx.report ? ctx.report.employee_id : ctx.actor.employee_id }),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};

/**
 * The matrix's probes for the record cards (praxis-ai.md §6.17): a report of the asker's is in their
 * `people` scope and the outsider never is; a card naming the outsider is refused by its own check.
 */
const recordProbe = (values) => {
  const forWho = (ctx, who) => ({ type: "employee", id: who.employee_id, values: { employee_id: who.employee_id, ...values(ctx, who) } });
  return {
    inside: (ctx) => (ctx.report ? forWho(ctx, ctx.report) : null),
    outside: (ctx) => forWho(ctx, ctx.outsider),
  };
};

const link = (type, id) => (routeMap.linkFor(type, id) || {}).path || null;
const personLine = (status) => (e) => [{ type: "employee", id: e.employee_id, label: [e.first_name, e.last_name].filter(Boolean).join(" "), status, link: link("employee", e.employee_id) }];
const departmentLine = (status) => (d) => [{ type: "department", id: d.department_id, label: d.name, status, link: link("department", d.department_id) }];
const seatLine = (status) => (s) => [{ type: "org_seat", id: s.org_seat_id, label: s.title, status, link: link("org_seat", s.org_seat_id) }];

/** A department or a worksite written by name is matched among those in use (decision 32). */
const RESOLVE_PLACES = {
  department_id: (value, _actor, db) => cards.departmentIdOf(db, value),
  worksite_id: (value, _actor, db) => worksites.idOf(db, value),
};
/** The department, worksite and people a card's fields hold, by name. */
const recordNames = async (values, db, people = []) => [
  ...(await cards.cardDepartment(db, values.department_id)),
  ...(await worksites.cardWorksite(db, values.worksite_id)),
  ...(await cards.peopleNamed(db, people.filter(Boolean))),
];

/** Whose record a card changes, when the person did not say (praxis-ai.md decision 34): People's register in their scope. */
const whose = (question) => ({ field: "employee_id", question, read: "employees.list", params: { status: "active" } });

const WORK_LABELS = {
  first_name: "First Name",
  middle_name: "Middle Name",
  last_name: "Last Name",
  preferred_name: "Known As",
  work_email: "Work Email",
  phone: "Phone",
  job_title: "Job Title",
  department_id: "Department",
  worksite_id: "Worksite",
  employment_type: "Engagement",
  work_pattern: "Work Pattern",
  start_date: "Start Date",
  contract_ends_on: "Contract Ends",
  confirmation_due_on: "Confirmation Due",
  confirmed_on: "Confirmed On",
};

module.exports = defineManifest({
  module: "people",
  actions: [
    {
      key: "employees.add",
      label: "Add Employee",
      description: "Add an employee's work record: names, work email and phone, job, department, line manager, worksite (On Site or Hybrid), start date, engagement and work pattern; never pay, bank or personal details",
      input: c.organisation.EmployeeAdd,
      permission: ["people", "create"],
      risk: "standard",
      form: "none: Add Employee's form also takes personal details, bank and pay, which a card never carries; the card is its work record",
      // The work record alone (JBS Praxis, 03/11/2026): personal details, bank and pay stay on the record's own screen.
      fields: ["first_name", "middle_name", "last_name", "preferred_name", "work_email", "phone", "job_title", "department_id", "line_manager_id", "worksite_id", "start_date", "employment_type", "work_pattern", "contract_ends_on", "confirmation_due_on"],
      picks: { department_id: "department", line_manager_id: "employee", worksite_id: "worksite" },
      resolve: RESOLVE_PLACES,
      names: (values, _actor, db) => recordNames(values, db, [values.line_manager_id]),
      // Every field the record needs is asked before the card is drawn (JBS Praxis, 03/11/2026).
      asks: [
        { field: "first_name", question: "What is their first name?" },
        { field: "last_name", question: "What is their last name?" },
        { field: "job_title", question: "What is their job title?" },
        { field: "department_id", question: "Which department are they in?" },
        { field: "work_email", question: "What is their work email?" },
        { field: "phone", question: "What is their phone number?" },
        { field: "start_date", question: "When do they start?" },
        { field: "employment_type", question: "How are they engaged?", choices: ["Full Time", "Part Time", "Contractor", "Consultant", "Intern"] },
        { field: "work_pattern", question: "Where do they work?", choices: ["On Site", "Hybrid", "Remote"] },
      ],
      check: (_client, values, actor) => cards.assertMayAdd(actor, values),
      // The same function Add Employee calls: the staff number is allocated, the line recorded, as on the screen.
      run: (values, actor) => cards.addEmployee(actor, values),
      readback: personLine("added"),
      labels: { ...WORK_LABELS, line_manager_id: "Line Manager" },
    },
    {
      key: "employees.edit",
      label: "Save Record",
      matrix: recordProbe((_ctx) => ({ job_title: "Matrix Officer" })),
      description: "Correct someone's work record: names, work email, phone, job, department, worksite, engagement, pattern and its dates; only what changes; never personal details, bank or pay",
      input: c.organisation.EmployeeChange,
      permission: ["people", "edit"],
      risk: "standard",
      form: "none: Edit Record changes the record open on People, Employees and never names it; the card does, with the work record alone",
      fields: ["employee_id", ...c.organisation.WORK_RECORD],
      picks: { department_id: "department", worksite_id: "worksite" },
      asks: [whose("Whose record is it?")],
      resolve: RESOLVE_PLACES,
      names: (values, _actor, db) => recordNames(values, db),
      records: (values, actor, db) => cards.cardEmployee(db, values.employee_id, actor.scope),
      check: (client, values, actor) => cards.assertCardEmployee(client, values.employee_id, actor.scope),
      // Edit Record's own function: a new department moves the person, their line following its head.
      run: (values, actor) => {
        const { employee_id: id, ...changes } = values;
        return cards.editEmployee(actor, id, changes);
      },
      readback: personLine("saved"),
      labels: { employee_id: "Person", ...WORK_LABELS },
    },
    {
      key: "employees.reporting",
      label: "Save Line",
      matrix: recordProbe((ctx) => ({ dotted_manager_id: ctx.actor.employee_id, reason: "Set by the matrix" })),
      description: "Set who someone reports to: their line manager and their dotted line manager, each a person (null clears one), with the reason kept on their history",
      input: c.organisation.EmployeeReportingChange,
      permission: ["people", "edit"],
      risk: "standard",
      form: "none: Reporting Line changes the record open on People and never names it; the card does, a person on each line (a vacant seat is picked on the Organogram)",
      fields: ["employee_id", "line_manager_id", "dotted_manager_id", "reason"],
      picks: { line_manager_id: "employee", dotted_manager_id: "employee" },
      asks: [whose("Whose line is it?")],
      names: (values, _actor, db) => cards.peopleNamed(db, [values.line_manager_id, values.dotted_manager_id].filter(Boolean)),
      records: (values, actor, db) => cards.cardEmployee(db, values.employee_id, actor.scope),
      check: (client, values, actor) => cards.assertCardEmployee(client, values.employee_id, actor.scope),
      // The same function Save Line calls: never themselves, never a loop.
      run: (values, actor) => {
        const { employee_id: id, ...body } = values;
        return cards.editReporting(actor, id, body);
      },
      readback: personLine("saved"),
      labels: { employee_id: "Person", line_manager_id: "Line Manager", dotted_manager_id: "Dotted Line", reason: "Reason" },
    },
    {
      key: "departments.create",
      label: "Add Department",
      description: "Add a department: its name, its code of 2 to 10 letters (made from the name when left out), what it does, and its head (a person)",
      input: c.organisation.DepartmentCreate,
      permission: ["people", "create"],
      risk: "standard",
      form: "none: Add Department's form validates field by field and takes a vacant seat as its head too; the card takes a person",
      fields: ["name", "code", "description", "head_employee_id"],
      picks: { head_employee_id: "employee" },
      names: (values, _actor, db) => cards.peopleNamed(db, [values.head_employee_id].filter(Boolean)),
      asks: [{ field: "name", question: "What is the department called?" }],
      // Departments are the company's: the grant over everyone, as the route asks.
      check: (_client, _values, actor) => cards.assertAllPeople(actor.scope),
      run: (values, actor) => cards.addDepartment(actor, values),
      readback: departmentLine("added"),
      labels: { name: "Name", code: "Code", description: "Description", head_employee_id: "Head" },
    },
    {
      key: "departments.edit",
      label: "Save Department",
      description: "Change a department: its name, code or description, its head (a person, null for none), or retire it (active false, once empty) or restore it (true); only what changes",
      input: c.organisation.DepartmentChange,
      permission: ["people", "edit"],
      risk: "standard",
      form: "none: Edit Department, Set Head, Retire and Restore change the department open on People, Departments and never name it; the card does",
      fields: ["department_id", "name", "code", "description", "head_employee_id", "active"],
      picks: { head_employee_id: "employee" },
      asks: [{ field: "department_id", question: "Which department?", read: "departments.list", params: { active: "true" } }],
      resolve: { department_id: RESOLVE_PLACES.department_id },
      names: (values, _actor, db) => cards.peopleNamed(db, [values.head_employee_id].filter(Boolean)),
      records: (values, _actor, db) => cards.cardDepartment(db, values.department_id),
      check: (client, values, actor) => cards.assertCardDepartment(client, values.department_id, actor.scope),
      run: (values, actor) => {
        const { department_id: id, ...changes } = values;
        return cards.editDepartment(actor, id, changes);
      },
      readback: departmentLine("saved"),
      labels: { department_id: "Department", name: "Name", code: "Code", description: "Description", head_employee_id: "Head", active: "In Use" },
    },
    {
      key: "seats.create",
      label: "Add Role",
      description: "Add an open role nobody holds yet: its title, its department and the person it reports to",
      input: c.organisation.OrgSeatCreate,
      permission: ["people", "create"],
      risk: "standard",
      form: "none: Add Open Role's form sits on the Organogram and validates field by field; the card is its request, reporting to a person",
      fields: ["title", "department_id", "line_manager_id"],
      picks: { department_id: "department", line_manager_id: "employee" },
      resolve: { department_id: RESOLVE_PLACES.department_id },
      names: (values, _actor, db) => recordNames(values, db, [values.line_manager_id]),
      asks: [
        { field: "title", question: "What is the role called?" },
        { field: "department_id", question: "Which department is it in?" },
      ],
      run: (values, actor) => cards.addSeat(actor, values),
      readback: seatLine("added"),
      labels: { title: "Role Title", department_id: "Department", line_manager_id: "Reports To" },
    },
    {
      key: "seats.edit",
      label: "Save Role",
      description: "Change an open role: its title, department or the person it reports to (null for none), or close it (status closed); only what changes",
      input: c.organisation.OrgSeatChange,
      permission: ["people", "edit"],
      risk: "standard",
      form: "none: Edit Open Role changes the role open on the Organogram and never names it; the card does",
      fields: ["org_seat_id", "title", "department_id", "line_manager_id", "status"],
      picks: { department_id: "department", line_manager_id: "employee" },
      asks: [{ field: "org_seat_id", question: "Which open role?", read: "seats.list", params: { status: "vacant" } }],
      resolve: { org_seat_id: (value, _actor, db) => cards.seatIdOf(db, value), department_id: RESOLVE_PLACES.department_id },
      names: (values, _actor, db) => recordNames(values, db, [values.line_manager_id]),
      records: (values, _actor, db) => cards.cardSeat(db, values.org_seat_id),
      check: (client, values) => cards.assertCardSeat(client, values.org_seat_id),
      run: (values, actor) => {
        const { org_seat_id: id, ...changes } = values;
        return cards.editSeat(actor, id, changes);
      },
      readback: seatLine("saved"),
      labels: { org_seat_id: "Role", title: "Role Title", department_id: "Department", line_manager_id: "Reports To", status: "Status" },
    },
  ],
  // The forms' own requests, reached through the cards that name their record (gate 23, praxis-ai.md decision 33).
  not_offered: {
    EmployeeCreate: "via employees.add: the new employee's base request (create-admin, the importer); Add Employee's is EmployeeAdd, a card with the work record alone",
    EmployeeUpdate: "via employees.edit: Edit Record's own request, which never names its record; the card is EmployeeChange, the work record alone",
    EmployeeReportingUpdate: "via employees.reporting: Reporting Line's own request, which never names its record; the card is EmployeeReportingChange",
    DepartmentUpdate: "via departments.edit: Edit Department's own request, which never names its department; the card is DepartmentChange",
    OrgSeatUpdate: "via seats.edit: Edit Open Role's own request, which never names its role; the card is OrgSeatChange",
  },
  summaries: [
    {
      key: "employees.summary",
      description: "Headcount figures: people by department, status, work arrangement, employment type or line manager, on probation and due for confirmation, contracts ending",
      params: c.organisation.EmployeeSummaryQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  reads: [
    {
      key: "employees.list",
      description:
        "List staff, by department, status, work arrangement, employment type or line manager",
      params: c.organisation.EmployeeListQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => repo.list(client, params, actor.scope),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
      matrix: probe,
    },
    {
      key: "departments.list",
      description: "List departments with their codes, heads (or who acts for an open head role), how many people and open roles each has, and whether it is in use",
      params: c.organisation.DepartmentListQuery,
      permission: ["people", "view"],
      run: (client, params) => service.departments(client, params),
      cite: (row) => ({ type: "department", id: row.department_id, label: row.name }),
    },
    {
      key: "seats.list",
      description: "List the seats in the structure, including the roles nobody holds yet",
      params: c.organisation.OrgSeatListQuery,
      permission: ["people", "view"],
      run: (client, params) => repo.seats(client, params),
      cite: (row) => ({ type: "employee", id: row.org_seat_id, label: row.title }),
    },
  ],
  routes: [
    { intent: "add an employee", screen: "people.employees", params: { new: "1" }, prefill: c.organisation.EmployeePrefill },
    { intent: "import a staff sheet", screen: "people.employees", params: { import: "1" } },
    { intent: "show the org chart", screen: "ess.org-chart" },
    { intent: "change who someone reports to", screen: "people.organogram" },
    { intent: "add a department", screen: "people.departments", params: { new: "1" } },
    { intent: "change a department's head, or move people between departments", screen: "people.departments" },
  ],
});

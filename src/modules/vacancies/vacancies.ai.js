"use strict";
/**
 * What the assistant may read and do about vacancies (docs/guides/recruitment.md §9): the vacancies
 * the asker may see, by the same scope the screen keeps (the hiring manager, guide §8), one page of 25
 * at a time, and one vacancy with its questions and scorecard; and, as cards the person confirms
 * (docs/guides/praxis-ai.md §6.11, decision 33; TB, 04/11/2026), New Vacancy and Save Vacancy, each
 * through the function the screen's own button calls. Summary: the vacancies in figures, by status and
 * by department or hiring manager as stacked bars (praxis-ai.md §6.13, Recruitment and onboarding). The vacancy's location is picked as every
 * place is (F27, decision 37): the model writes it in words, our search signs the one area it finds,
 * and anything else is left for the person to pick on Edit.
 *
 * The questions, the scorecard and Careers Settings are each a whole structure designed on its own
 * screen (decision 35): the assistant opens the screen, and never saves them.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const maps = require("../maps/maps.service");
const cards = require("../organisation/organisation.cards");
const service = require("./vacancies.service");
const { probeFor } = require("./vacancies.matrix");

const cite = (row) => ({ type: "vacancy", id: row.vacancy_id, label: `${row.number}, ${row.title}` });
const link = (id) => (routeMap.linkFor("vacancy", id) || {}).path || null;
const vacancyLine = (status) => (v) => [{ type: "vacancy", id: v.vacancy_id, label: `${v.number}, ${v.title}`, status, link: link(v.vacancy_id) }];

/** The department, hiring manager and place a card holds, by name. */
const names = async (values, db) => [
  ...(await cards.cardDepartment(db, values.department_id)),
  ...(await cards.peopleNamed(db, [values.hiring_manager_id].filter(Boolean))),
  ...maps.cardPlace(values.location),
];

/** The place as the form sends it: { token }. */
const placed = (token) => (token ? { location: { token } } : {});

const LABELS = {
  title: "Role",
  department_id: "Department",
  hiring_manager_id: "Hiring Manager",
  positions: "Openings",
  employment_type: "Employment Type",
  work_pattern: "Arrangement",
  work_pattern_note: "Arrangement Note",
  location: "Location",
  working_days: "Working Days",
  min_experience_years: "Minimum Experience",
  description: "About the Role",
  requirements: "Required Experience",
  nice_to_have: "What We Look For",
  closes_on: "Closes On",
  publish: "Publish Now",
};

const RESOLVE = {
  department_id: (value, _actor, db) => cards.departmentIdOf(db, value),
  location: (value) => maps.onePlace(value, { level: "area" }),
};

module.exports = defineManifest({
  module: "recruitment",
  actions: [
    {
      key: "vacancies.create",
      label: "New Vacancy",
      description: "Write a vacancy: the role, department, hiring manager, engagement, arrangement and area, about the role, required experience and its last day; publish now or keep a draft",
      input: c.vacancies.VacancyAdd,
      permission: ["recruitment", "create"],
      risk: "standard",
      form: "none: New Vacancy's form sends the area it picks on its map as { token }; the card picks it the same way (VacancyAdd)",
      fields: Object.keys(LABELS),
      picks: { department_id: "department", hiring_manager_id: "hiring_manager", location: "place" },
      resolve: RESOLVE,
      names: (values, _actor, db) => names(values, db),
      asks: [
        { field: "title", question: "What is the role called?" },
        { field: "department_id", question: "Which department is it in?", read: "departments.list", params: { active: "true" } },
        { field: "hiring_manager_id", question: "Who is the hiring manager?", read: "vacancies.hiring_managers" },
        { field: "employment_type", question: "How is it engaged?", choices: ["Full Time", "Part Time", "Contract", "Internship"] },
        { field: "work_pattern", question: "Where is the work done?", choices: ["On Site", "Hybrid", "Remote"] },
        { field: "location", question: "Which city or area is it in?", when: { field: "work_pattern", not: ["remote"] } },
        { field: "description", question: "What does the role do?" },
        { field: "requirements", question: "What experience does it need?" },
        { field: "closes_on", question: "What is its last day for applications?", choices: ["In Two Weeks", "In a Month"] },
      ],
      run: (values, actor) => {
        const { location, ...rest } = values;
        return service.create(actor, actor.scope, parseBody(c.vacancies.VacancyCreate, { ...rest, ...placed(location) }));
      },
      readback: vacancyLine("written"),
      labels: LABELS,
    },
    {
      key: "vacancies.edit",
      label: "Save Vacancy",
      description: "Change a vacancy: any of New Vacancy's fields; only what changes. Never its questions, scorecard or status",
      input: c.vacancies.VacancyChange,
      permission: ["recruitment", "edit"],
      risk: "standard",
      form: "none: Edit Vacancy changes the vacancy open on Recruitment, Vacancies and never names it; the card does",
      fields: ["vacancy_id", ...Object.keys(LABELS).filter((k) => k !== "publish")],
      picks: { department_id: "department", hiring_manager_id: "hiring_manager", location: "place" },
      asks: [{ field: "vacancy_id", question: "Which vacancy?", read: "vacancies.list" }],
      resolve: { ...RESOLVE, vacancy_id: (value, actor, db) => service.idOf(db, value, actor.scope) },
      names: (values, _actor, db) => names(values, db),
      records: (values, actor, db) => service.cardVacancy(db, values.vacancy_id, actor.scope),
      run: (values, actor) => {
        const { vacancy_id: id, location, ...rest } = values;
        return service.update(actor, actor.scope, id, parseBody(c.vacancies.VacancyEdit, { ...rest, ...placed(location) }));
      },
      readback: vacancyLine("saved"),
      labels: { vacancy_id: "Vacancy", ...Object.fromEntries(Object.entries(LABELS).filter(([k]) => k !== "publish")) },
    },
  ],
  // Every create and edit form of this module's contract, and how the chat reaches it (gate 23, decision 33).
  not_offered: {
    VacancyCreate: "via vacancies.create: New Vacancy's own request, its area picked on the map; the card is VacancyAdd",
    VacancyEdit: "via vacancies.edit: Edit Vacancy's own request, which never names its vacancy; the card is VacancyChange",
    VacancyQuestionsSave:
      "design: a vacancy's Apply questions and interview traits are one form designed whole with all of it in view (decision 35); the assistant opens Questions",
    ScorecardSave: "design: the five parts and their weights are designed whole and must add up to 100 (decision 35); the assistant opens Scorecard",
    CareersSettingsSave:
      "design: About MyCityApp and the Default Traits shape every vacancy and interview card, designed whole on Careers Settings (decision 35)",
  },
  reads: [
    {
      // Who the hiring manager may be, by the save's own rule: New Vacancy's question offers and matches only them.
      key: "vacancies.hiring_managers",
      summary: "none: a picker's list",
      description: "List the people who may be a vacancy's hiring manager: active, holding Recruitment, in the asker's reach",
      params: c.vacancies.HiringManagerListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.hiringManagers(params, actor.scope),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
    },
    {
      key: "vacancies.list",
      summary: "vacancies.summary",
      description: "List vacancies: the role, its department and hiring manager, status (draft, open, paused, closed), applicants, days open and the closing date",
      params: c.vacancies.VacancyListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
      // A vacancy the asker manages is listed; one the matrix's outsider manages never is.
      matrix: probeFor(async (v) => ({ type: "vacancy", id: v.vacancy_id })),
    },
    {
      key: "vacancies.get",
      summary: "none: one record",
      description: "One vacancy: its description, requirements, questions and traits, scorecard parts and how many candidates are at each stage",
      params: c.common.IdParams,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.get(params.id, actor, actor.scope),
      cite,
    },
  ],
  summaries: [
    {
      key: "vacancies.summary",
      description: "Vacancies in figures: open, paused, closed, applicants, days open; by status, by department or hiring manager as stacked bars, applicants per vacancy, opened by month",
      params: c.vacancies.VacancySummaryQuery,
      permission: ["recruitment", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
      // A vacancy the asker manages is counted; one the matrix's outsider manages never is (praxis-ai.md §6.17).
      matrix: probeFor(async (v) => ({ type: "vacancy", id: v.vacancy_id })),
    },
  ],
  routes: [
    { intent: "write a new vacancy", screen: "recruitment.vacancies", params: { new: "1" }, prefill: c.vacancies.VacancyCreate },
    { intent: "change a vacancy's questions, interview traits or scorecard", screen: "recruitment.vacancies" },
    { intent: "change Careers Settings: About MyCityApp or the default interview traits", screen: "recruitment.vacancies", params: { panel: "settings" } },
  ],
});

"use strict";
/**
 * What the assistant may read and do about projects: the list, one page of 25 at a time, with the
 * open and done tasks in each the asker can see, and the same in figures (projects.summary,
 * docs/guides/praxis-ai.md §6.13); and, as cards the person confirms
 * (docs/guides/praxis-ai.md §6.11, decision 33), New Project and Edit Project, Complete Project and
 * Reopen Project among them, each through the service function the page's own button calls.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./projects.service");

const projectLink = (id) => (routeMap.linkFor("project", id) || {}).path || null;
/** The project a card made or changed, read back as a line that opens it. */
const projectLine = (status) => (p) => [{ type: "project", id: p.project_id, label: `${p.number} ${p.name}`, status, link: projectLink(p.project_id) }];

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): every project is on everyone's list,
 * but only its owner, or a grant that reaches everyone, changes it; a card changing the outsider's
 * project is refused by the page's own rule.
 */
const probe = {
  inside: async (ctx) => {
    const p = await service.create(ctx.actor, ctx.actor.scope, { name: `Matrix project for ${ctx.role}` });
    return { type: "project", id: p.project_id, values: { project_id: p.project_id, description: "Changed by the matrix" } };
  },
  outside: async (ctx) => {
    const p = await service.create(ctx.outsider.user, ctx.outsider.scope, { name: `Outsider's project, seen by ${ctx.role}` });
    return { type: "project", id: p.project_id, values: { project_id: p.project_id, description: "Changed by the matrix" } };
  },
};

// Connect to Partner on the card (M7, workspace.md §9): Partnerships names and finds the partner, lead and deal.
const partnerCard = require("../partners/partners.work").card;

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "projects.create",
      description: "Start a project of mine: its name, notes and due day, and the partner and deal it is for",
      input: c.projects.ProjectCreate,
      permission: ["workspace", "create"],
      risk: "standard",
      asks: [{ field: "name", question: "What is the project called?" }],
      picks: partnerCard.picks,
      resolve: partnerCard.resolve,
      names: partnerCard.names,
      // The same function Create Project calls: the person owns it.
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: projectLine("started"),
      labels: { name: "Name", description: "Notes", due_on: "Due Day", ...partnerCard.labels },
    },
    {
      key: "projects.edit",
      label: "Save Project",
      matrix: probe,
      description: "Change a project I own: its name, notes, due day or the partner and deal it is for, or complete it (status completed) or reopen it (active); only what changes",
      input: c.projects.ProjectChange,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: Edit Project's form changes the project open on its page and never names it, and Complete Project and Reopen Project are buttons; the card names the project",
      // Which project, when the person did not say (praxis-ai.md decision 34): the projects list's own rows to tap.
      asks: [{ field: "project_id", question: "Which project is it?", read: "projects.list" }],
      picks: partnerCard.picks,
      resolve: partnerCard.resolve,
      names: partnerCard.names,
      records: (values, actor, db) => (db ? service.cardRecords(db, values.project_id, actor.scope) : values.project_id ? [{ type: "project", id: values.project_id }] : []),
      check: (client, values, actor) => service.assertCardProject(client, values.project_id, actor.scope),
      run: (values, actor) => {
        const { project_id: id, ...changes } = values;
        return service.edit(actor, actor.scope, id, changes);
      },
      readback: projectLine("saved"),
      labels: { project_id: "Project", name: "Name", description: "Notes", due_on: "Due Day", status: "Status", ...partnerCard.labels },
    },
  ],
  // Edit Project's own form, reached through the card that names its project (gate 23, praxis-ai.md decision 33).
  not_offered: {
    ProjectEdit: "via projects.edit: Edit Project's own form, which never names its project; the card is ProjectChange",
  },
  summaries: [
    {
      key: "projects.summary",
      description: "Projects in figures: active, completed, past their due day; their tasks I can see, done, open and overdue; by project or status",
      params: c.projects.ProjectSummaryQuery,
      permission: ["workspace", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  reads: [
    {
      key: "projects.list",
      summary: "projects.summary",
      description: "The projects, active or completed, with how many of their tasks are open and done",
      params: c.projects.ProjectListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "project", id: row.project_id, label: row.name }),
    },
  ],
  routes: [{ intent: "start a project", screen: "workspace.projects", params: { new: "1" }, prefill: c.projects.ProjectPrefill }],
});

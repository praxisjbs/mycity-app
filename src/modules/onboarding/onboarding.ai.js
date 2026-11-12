"use strict";
/**
 * What the assistant may read and do about onboarding (docs/guides/offers.md §9): the cases by status,
 * with how many required items each still owes, in the scope the screen keeps (the vacancy's hiring
 * manager). Never a document, a guarantor's details or the BVN: they are the hire's own and sit
 * behind the record.
 *
 * Nothing here acts. Verifying a document, recording a reference check, marking a step done,
 * completing onboarding (which invites a login) and withdrawing a case are a person's judgement on the
 * screen. The hire's upload, guarantors and BVN (UploadItem, GuarantorInput, BvnEnter) are
 * theirs alone, on their own link, and never reach the chat (handoff decisions 4 and 9); they are
 * not create or edit forms of the staff app, so gate 23 asks no reason of them. M5 registers no AI
 * job (handoff decision 7).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./onboarding.service");

const cite = (row) => ({ type: "onboarding", id: row.onboarding_case_id, label: `${row.hire_name}, ${row.job_title}` });

module.exports = defineManifest({
  module: "recruitment",
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    DocumentRequirementCreate:
      "design: the New Joiner list is set out once on the Onboarding tab's Checklist settings, beside the items it orders",
    DocumentRequirementEdit:
      "design: a requirement is changed on the Checklist settings, where its place in the list and the cases it reaches show",
    OnboardingPlanSave:
      "design: a department's plan is written whole on the Plans settings, its steps, owners, days and SOPs side by side",
  },
  actions: [],
  reads: [
    {
      key: "onboarding.list",
      description: "List onboarding cases: the hire, role, department, status, start date and how many required documents are still outstanding",
      params: c.onboarding.OnboardingListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
  ],
  routes: [
    { intent: "see who still owes onboarding documents", screen: "recruitment.onboarding", params: { status: "documentation" } },
    { intent: "verify a new hire's documents", screen: "recruitment.onboarding" },
    { intent: "see which new hires are in their first weeks of onboarding", screen: "recruitment.onboarding", params: { status: "onboarding" } },
    { intent: "change the onboarding document checklist", screen: "recruitment.onboarding", params: { panel: "settings" } },
  ],
});

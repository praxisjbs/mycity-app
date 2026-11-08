"use strict";
/**
 * An agreement's approval (docs/guides/partnerships.md §6.9): `partnership.agreement` on the one
 * approval engine, editable on Settings · Approvals like any flow. Two stages as shipped: the Head of
 * Department of the deal owner's department, then the CEO, 72 hours each; a stage that would ask the
 * same person twice is skipped, and a department with no head falls to the CEO (the engine's rules).
 *
 *   context   value, commission_pct, commission_deviates, kind, partner_category_id,
 *             owner_department_id, department_head_employee_id (what Applies When may test)
 *   view      the stage waiting and who it waits on, or approved once every stage has
 */
const money = require("../../shared/money/money");
const workflow = require("../../shared/workflow/engine");
const definitions = require("../../shared/workflow/definitions");
const cond = require("../../shared/workflow/conditions");
const organisation = require("../organisation/organisation.service");
const { FLOW, ENTITY } = require("./agreements.events");

/** What the flow's conditions read, from the agreement and its deal. */
async function contextOf(client, a) {
  const { rows } = await client.query(
    "SELECT commission_pct::text AS commission_pct, commission_deviates FROM partnership_opportunity WHERE partnership_opportunity_id = $1",
    [a.deal_id],
  );
  const deal = rows[0] || {};
  const head = a.owner_department_id ? await organisation.headOf(client, a.owner_department_id) : null;
  return {
    value: a.value === null || a.value === undefined ? "0.00" : money.toWire(a.value),
    commission_pct: deal.commission_pct === null || deal.commission_pct === undefined ? null : Number(deal.commission_pct),
    commission_deviates: deal.commission_deviates === true,
    kind: a.kind || null,
    partner_category_id: a.partner_category_id || null,
    owner_department_id: a.owner_department_id || null,
    department_head_employee_id: head || null,
  };
}

/** Open the approval, in the caller's transaction. The agreement's owner is the one it is about. */
async function openIn(client, actor, a) {
  return workflow.openInstance(client, {
    definition_key: FLOW,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    subject_employee_id: a.owner_id || actor.employee_id || null,
    context: await contextOf(client, a),
    actor,
  });
}

/** The names a stage's snapshot stands for: people by name, roles by name, the CEO. */
async function namesOf(db, snapshot) {
  const out = [];
  const employees = snapshot.filter((s) => s.type === "employee").map((s) => s.value);
  const users = snapshot.filter((s) => s.type === "user").map((s) => s.value);
  const roles = snapshot.filter((s) => s.type === "role").map((s) => s.value);
  if (employees.length) {
    const { rows } = await db.query(
      "SELECT btrim(first_name || ' ' || last_name) AS name FROM employee WHERE employee_id = ANY($1::uuid[]) ORDER BY first_name, last_name",
      [employees],
    );
    out.push(...rows.map((r) => r.name));
  }
  if (users.length) {
    const { rows } = await db.query(
      `SELECT btrim(e.first_name || ' ' || e.last_name) AS name FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
        WHERE u.user_id = ANY($1::uuid[]) ORDER BY e.first_name, e.last_name`,
      [users],
    );
    out.push(...rows.map((r) => r.name));
  }
  if (roles.length) {
    const { rows } = await db.query("SELECT name FROM role WHERE code = ANY($1::text[]) ORDER BY name", [roles]);
    out.push(...rows.map((r) => r.name));
  }
  if (snapshot.some((s) => s.type === "ceo")) out.push("The CEO");
  return out;
}

/**
 * AgreementDetail.approval: the stage waiting and who, while its approval is pending; approved once it
 * was, until it is sent; null before Submit and after Send.
 */
async function viewOf(db, a) {
  if (!a.workflow_instance_id || !["review", "approval"].includes(a.status)) return null;
  const instance = await workflow.getInstance(db, a.workflow_instance_id);
  if (!instance) return null;
  if (instance.state === "approved" || instance.state === "timeout_approved") return { state: "approved", stage: null, waiting_on: null };
  if (instance.state !== "pending") return null;
  const def = (await definitions.findActive(db, instance.definition_key)) || definitions.getDefault(instance.definition_key);
  const stage = def ? cond.stageByKey(def, instance.current_stage) : null;
  const names = await namesOf(db, instance.stage_approvers || []);
  return { state: "waiting", stage: stage ? stage.name : instance.current_stage, waiting_on: names.length ? names.join(", ") : null };
}

/** Whether its approval has finished approved: the one state Send for Signature accepts. */
async function isApproved(db, a) {
  if (!a.workflow_instance_id) return false;
  const instance = await workflow.getInstance(db, a.workflow_instance_id);
  return Boolean(instance) && (instance.state === "approved" || instance.state === "timeout_approved");
}

module.exports = { contextOf, openIn, viewOf, isApproved };

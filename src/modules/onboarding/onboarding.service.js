"use strict";
/**
 * Onboarding (docs/guides/offers.md §3 steps 5 to 8): the hire's case, from the offer's acceptance
 * to their first day.
 *
 *   openCaseIn()        the acceptance transaction opens the case at documentation, its checklist one
 *                       item for each active document requirement (guide §3 step 5); the outbox then
 *                       mails the Upload Documents link (onboarding.events.js)
 *   requiredCount()     how many required items the checklist has: Send Offer is refused while there
 *                       are none, so no offer is accepted into an empty checklist (guide §11)
 *   caseForOffer()      the offer's case, once there is one
 *   list(), get()       Recruitment · Onboarding, within the reader's `recruitment` scope
 *   verifyItem(), rejectItem()    Operations & People check what the hire sent
 *   checkGuarantor()    a guarantor's reference check, Passed or Failed
 *   remind()            Send Reminder: a fresh Upload Documents link, every earlier one stopped
 *   checkGateIn()       the documentation gate (guide §3 step 7): every required item verified, both
 *                       guarantors passed, the BVN entered and the contract signed move the case to
 *                       pre_onboarding and the application with it. Asked after each of those changes,
 *                       the contract's signature included (contractSignedIn)
 *   dispatch()          onboarding-dispatch, daily (guide §3 step 8): a case at pre_onboarding whose
 *                       start date has come moves to onboarding, the application with it, and its
 *                       plan's steps are copied on with each owner named (startIn); then the owner of
 *                       every step past its due day is reminded, once a step (remindOverdue). Safe to
 *                       run twice
 *   markStepDone()      Mark Step Done
 *   complete()          Complete Onboarding, one transaction: every step done, the company email made
 *                       the hire's work email, their login invited on it (Staff), candidates.hireIn
 *                       (the seat filled, the vacancy closed when its openings are), the case completed
 *   withdraw()          Withdraw: the hire did not join. The case cancelled, an unsigned contract
 *                       cancelled, the links stopped, the employee archived, the application withdrawn
 *
 * The public upload page is onboarding.upload.js; the Checklist settings onboarding.checklist.js; the
 * Plans settings onboarding.plans.js.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { logger } = require("../../config/logger");
const lagos = require("../../shared/time/lagos");
const publicToken = require("../../shared/tokens/public-token");
const organisation = require("../organisation/organisation.service");
const repo = require("./onboarding.repo");
const checklist = require("./onboarding.checklist");
const sop = require("./onboarding.sop");
const { EVENTS, ENTITY, SCOPE, SUBJECT } = require("./onboarding.events");

const contracts = () => require("../employment_contracts/employment_contracts.service");
const candidates = () => require("../candidates/candidates.service");
const users = () => require("../users/users.service");

/** Who moves a case on its start date: the system, as for every scheduled sweep. */
const SYSTEM = Object.freeze({ user_id: null });
/** The statuses a case may be withdrawn from: anything before it completed or was withdrawn. */
const OPEN = Object.freeze(["documentation", "pre_onboarding", "onboarding"]);
/** The role a hire's login is invited with (Settings · Users and Roles' Staff). */
const HIRE_ROLE = "employee";

const notFound = () => new AppError("NOT_FOUND", "That onboarding case does not exist", 404);
const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const iso = (v) => (v ? new Date(v).toISOString() : null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A case is its owner's (the vacancy's hiring manager), as an offer and a contract are. */
const holds = (scope, row) =>
  Boolean(scope && (scope.scope === "all" || (row.owner_id && (scope.scope_ids || []).includes(row.owner_id))));

async function visible(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row || !holds(scope, row)) throw notFound();
  return row;
}

/** What every event of a case carries: who it is for, and who to tell. */
const payload = (row, extra = {}) => ({
  onboarding_case_id: row.onboarding_case_id,
  application_id: row.application_id,
  employee_id: row.employee_id,
  employee_name: row.employee_name,
  owner_user_id: row.owner_user_id || null,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Opened at acceptance
 * ------------------------------------------------------------------ */

/**
 * Open the hire's case, in the acceptance transaction (offers.acceptedIn). Opened once an offer:
 * a hook that runs twice finds the case and leaves it alone.
 *
 * @param {object} client  the acceptance transaction
 * @param {{user_id: string|null}|null} actor
 * @param {{offer: object, employee: object}} input
 * @returns {Promise<object>} the case row
 */
async function openCaseIn(client, actor, { offer, employee }) {
  const existing = await repo.byOffer(client, offer.offer_id);
  if (existing) return existing;
  const caseId = await repo.insertCase(client, {
    application_id: offer.application_id,
    offer_id: offer.offer_id,
    employee_id: employee.employee_id,
    owner_id: offer.hiring_manager_id || null,
    starts_on: offer.start_date || null,
  });
  await repo.insertItems(client, caseId, await repo.activeRequirements(client));
  const row = await repo.get(client, caseId);
  await emit(client, {
    key: EVENTS.ONBOARDING_OPENED,
    entity: { type: ENTITY, id: caseId },
    actor,
    payload: { ...payload(row), offer_id: offer.offer_id },
  });
  return row;
}

/** How many required checklist items the Checklist settings hold. */
async function requiredCount(db = pool) {
  return repo.requiredCount(db);
}

async function caseForOffer(db, offerId) {
  return repo.byOffer(db, offerId);
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A stored file as the contract's DocumentRef. */
const docRef = (id, d) =>
  id
    ? { document_id: id, file_name: (d && d.original_name) || "document", size_bytes: Number((d && d.bytes) || 0), mime_type: (d && d.mime) || "application/octet-stream" }
    : null;

/** OnboardingItem. */
const itemOf = (i) => ({
  onboarding_checklist_item_id: i.onboarding_checklist_item_id,
  document_requirement_id: i.document_requirement_id || null,
  title: i.title,
  kind: i.kind,
  required: i.required,
  status: i.status,
  document: docRef(i.document_id, i),
  entered_value: i.entered_value || null,
  uploaded_at: iso(i.uploaded_at),
  verified_at: iso(i.verified_at),
  rejected_reason: i.rejected_reason || null,
  display_order: Number(i.display_order || 0),
});

/** Guarantor. */
const guarantorOf = (g) => ({
  onboarding_guarantor_id: g.onboarding_guarantor_id,
  position: Number(g.position),
  kind: g.kind,
  full_name: g.full_name,
  relationship: g.relationship,
  organisation: g.organisation || null,
  job_title: g.job_title || null,
  phone: g.phone,
  email: g.email || null,
  years_known: g.years_known === null || g.years_known === undefined ? null : Number(g.years_known),
  form: docRef(g.form_document_id, g),
  check_status: g.check_status,
  check_note: g.check_note || null,
  checked_at: iso(g.checked_at),
});

/** OnboardingRow. */
const rowOf = (r) => ({
  onboarding_case_id: r.onboarding_case_id,
  hire_name: r.hire_name || r.employee_name || "",
  job_title: r.job_title,
  department: r.department || null,
  status: r.status,
  starts_on: r.starts_on || null,
  items_outstanding: Number(r.items_outstanding || 0),
  created_at: iso(r.created_at),
});

/** OnboardingStep: due days compared with today in Lagos. */
const stepOf = (st, sops, today) => ({
  onboarding_case_step_id: st.onboarding_case_step_id,
  position: Number(st.position),
  title: st.title,
  description: st.description || null,
  owner_role: st.owner_role,
  owner_id: st.owner_id || null,
  owner_name: st.owner_name || null,
  due_on: st.due_on || null,
  overdue: st.status === "pending" && Boolean(st.due_on) && st.due_on < today,
  sop: (st.sop_id && sops.get(st.sop_id)) || null,
  status: st.status,
  done_at: iso(st.done_at),
});

/** Everything the gate reads, on the caller's connection. */
async function stateOf(db, row, user = null) {
  // One after another: inside a transaction they share one client.
  const items = await repo.items(db, row.onboarding_case_id);
  const guarantors = await repo.guarantors(db, row.onboarding_case_id);
  const bvnEntered = row.employee_id ? await organisation.hasBvn(db, row.employee_id) : false;
  const contract = await contracts().forCase(db, row.onboarding_case_id, user);
  const waiting = checklist.waitingOn({
    items,
    guarantors,
    bvn_entered: bvnEntered,
    contract_status: contract ? contract.status : null,
  });
  return { items, guarantors, bvnEntered, contract, waiting };
}

/** OnboardingDetail. */
async function detailOf(db, row, user) {
  const s = await stateOf(db, row, user);
  const steps = await repo.caseSteps(db, row.onboarding_case_id);
  const sops = await sop.sopsById(db, steps.map((st) => st.sop_id));
  const today = lagos.today();
  return {
    ...rowOf(row),
    application_id: row.application_id,
    offer_id: row.offer_id,
    employee_id: row.employee_id || null,
    owner_id: row.owner_id || null,
    privacy_acknowledged_at: iso(row.privacy_acknowledged_at),
    documentation_completed_at: iso(row.documentation_completed_at),
    completed_at: iso(row.completed_at),
    cancelled_at: iso(row.cancelled_at),
    end_reason: row.end_reason || null,
    items: s.items.map(itemOf),
    guarantors: s.guarantors.map(guarantorOf),
    bvn_entered: s.bvnEntered,
    contract: s.contract,
    waiting_on: s.waiting,
    steps: steps.map((st) => stepOf(st, sops, today)),
    can_complete: row.status === "onboarding" && steps.every((st) => st.status === "done"),
    can_withdraw: OPEN.includes(row.status),
  };
}

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(rowOf) };
}

/** The figures above the Onboarding list, within the reader's scope. */
async function summary(scope) {
  return repo.summary(pool, scope, lagos.today());
}

async function get(id, user, scope) {
  return detailOf(pool, await visible(pool, id, scope), user);
}

/* ------------------------------------------------------------------ *
 * The documentation gate
 * ------------------------------------------------------------------ */

/**
 * Move the case to pre-onboarding when documentation is complete, in the caller's transaction. The
 * application follows to Pre-Onboarding (candidates.advanceIn); the case is what the gate answers to,
 * so an application already moved on its own does not hold it back. True when the case moved.
 */
async function checkGateIn(client, actor, caseId) {
  const row = await repo.get(client, caseId, { lock: true });
  if (!row || row.status !== "documentation") return false;
  const { waiting } = await stateOf(client, row);
  if (waiting.length > 0) return false;
  if (!(await repo.setStatus(client, caseId, ["documentation"], "pre_onboarding", { documentationCompleted: true }))) return false;
  await candidates().advanceIn(client, actor || { user_id: null }, row.application_id, "pre_onboarding");
  await emit(client, {
    key: EVENTS.ONBOARDING_DOCUMENTATION_COMPLETED,
    entity: { type: ENTITY, id: caseId },
    actor,
    payload: payload(row),
  });
  return true;
}

/** The hire signed their contract (employment_contracts' signedIn, in the signing transaction). */
async function contractSignedIn(client, actor, caseId) {
  return checkGateIn(client, actor, caseId);
}

/* ------------------------------------------------------------------ *
 * Operations & People check what the hire sent
 * ------------------------------------------------------------------ */

/** Only a case still at documentation takes checks; after that its documents are settled. */
function assertDocumentation(row) {
  if (row.status !== "documentation") throw refused("NOT_IN_DOCUMENTATION", "This case is past documentation");
}

async function verifyItem(actor, scope, id, itemId) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const it = await repo.item(client, id, itemId, { lock: true });
    if (!it) throw refused("NOT_FOUND", "That item is not on this checklist", 404);
    if (it.status !== "uploaded") throw refused("NOT_UPLOADED", "Nothing waits to be verified here");
    if (it.document_id && it.scan_status === "pending") throw refused("SCAN_PENDING", "Wait for the virus scan to finish");
    if (it.document_id && it.scan_status === "infected") throw refused("FILE_INFECTED", "This file failed the virus scan; reject it");
    await repo.itemVerified(client, itemId, actor.user_id);
    await emit(client, {
      key: EVENTS.ONBOARDING_ITEM_VERIFIED,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { onboarding_checklist_item_id: itemId, title: it.title }),
    });
    await checkGateIn(client, actor, id);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Back to the hire with the reason, which their upload page shows beside the item. */
async function rejectItem(actor, scope, id, itemId, { reason }) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const it = await repo.item(client, id, itemId, { lock: true });
    if (!it) throw refused("NOT_FOUND", "That item is not on this checklist", 404);
    if (!(await repo.itemRejected(client, itemId, reason))) throw refused("NOT_UPLOADED", "Nothing was sent for this item");
    await emit(client, {
      key: EVENTS.ONBOARDING_ITEM_REJECTED,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { onboarding_checklist_item_id: itemId, title: it.title }),
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** A guarantor's reference check, recorded Passed or Failed with a note. */
async function checkGuarantor(actor, scope, id, guarantorId, body) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const g = await repo.guarantor(client, id, guarantorId, { lock: true });
    if (!g) throw refused("NOT_FOUND", "That guarantor is not on this case", 404);
    await repo.recordCheck(client, guarantorId, body, actor.user_id);
    await emit(client, {
      key: EVENTS.ONBOARDING_GUARANTOR_CHECKED,
      entity: { type: ENTITY, id },
      actor,
      before: { check_status: g.check_status },
      after: { check_status: body.check_status },
      payload: payload(row, { onboarding_guarantor_id: guarantorId, check_status: body.check_status }),
    });
    await checkGateIn(client, actor, id);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Send Reminder: a fresh Upload Documents link to the hire, made after this check commits. */
async function remind(actor, scope, id) {
  await tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
  });
  await require("./onboarding.upload").sendLink(id, actor.user_id || null, { reminder: true });
  return detailOf(pool, await repo.get(pool, id), actor);
}

/* ------------------------------------------------------------------ *
 * Onboarding: the start date and the plan's steps (onboarding-dispatch)
 * ------------------------------------------------------------------ */

/**
 * Start one case on its start date, in the caller's transaction: its plan's steps copied on (the
 * department's active plan, else the company's default), each owner the person who holds the step's
 * role now (the line manager read from the vacancy's Organogram seat while the hire's record names
 * none; the case's owner when nobody holds the role: decided with AJ, 11/11/2026), each due day the start
 * date plus the step's offset, its SOP kept; the case to onboarding and the application to Onboarding.
 * A case not at pre_onboarding, or not yet at its start date, is left alone. True when it moved.
 */
async function startIn(client, caseId, today) {
  const row = await repo.get(client, caseId, { lock: true });
  if (!row || row.status !== "pre_onboarding" || !row.starts_on || row.starts_on > today) return false;
  // An application ended under it (Not Progressing) is never started; endForApplication closes the case.
  if (!(await repo.applicationActive(client, row.application_id))) return false;
  const plan = await repo.planFor(client, row.department_id);
  const planSteps = plan ? await repo.steps(client, plan.onboarding_plan_id) : [];
  const held = await repo.roleHolders(client, {
    employeeId: row.employee_id,
    departmentId: row.department_id,
    applicationId: row.application_id,
  });
  const holderOf = {
    case_owner: row.owner_id,
    line_manager: held.line_manager,
    head_of_department: held.head_of_department,
    hire: row.employee_id,
  };
  await repo.insertCaseSteps(
    client,
    caseId,
    planSteps.map((st) => ({
      ...st,
      position: Number(st.position),
      owner_id: holderOf[st.owner_role] || row.owner_id || null,
      due_on: lagos.addDays(row.starts_on, Number(st.due_offset_days)),
    })),
  );
  if (!(await repo.setStatus(client, caseId, ["pre_onboarding"], "onboarding"))) return false;
  await candidates().advanceIn(client, SYSTEM, row.application_id, "onboarding");
  const owners = [...new Set((await repo.caseSteps(client, caseId)).map((st) => st.owner_id).filter(Boolean))];
  const logins = [];
  for (const id of owners) {
    const login = await repo.loginOf(client, id);
    if (login) logins.push(login);
  }
  await emit(client, {
    key: EVENTS.ONBOARDING_STARTED,
    entity: { type: ENTITY, id: caseId },
    actor: null,
    payload: payload(row, { onboarding_plan_id: plan ? plan.onboarding_plan_id : null, step_count: planSteps.length, step_owner_user_ids: logins }),
  });
  return true;
}

/**
 * Remind the owner of every step past its due day, once a step: their login, else the case's owner's.
 * A step marked done before the run is not reminded; one reminded stays reminded.
 */
async function remindOverdue(today) {
  let reminded = 0;
  for (const due of await repo.overdueSteps(pool, today)) {
    reminded += await tx(async (client) => {
      const row = await repo.get(client, due.onboarding_case_id, { lock: true });
      if (!row || row.status !== "onboarding") return 0;
      const st = await repo.caseStep(client, due.onboarding_case_id, due.onboarding_case_step_id, { lock: true });
      if (!st || !(await repo.markReminded(client, st.onboarding_case_step_id))) return 0;
      const to = (await repo.loginOf(client, st.owner_id)) || row.owner_user_id || null;
      await emit(client, {
        key: EVENTS.ONBOARDING_STEP_OVERDUE,
        entity: { type: ENTITY, id: row.onboarding_case_id },
        actor: null,
        payload: payload(row, { onboarding_case_step_id: st.onboarding_case_step_id, title: st.title, due_on: st.due_on, remind_user_id: to }),
      });
      return 1;
    });
  }
  return reminded;
}

/**
 * onboarding-dispatch (jobs/schedulers/onboarding-dispatch.js): start every case whose start date has
 * come, then remind the owners of overdue steps. Each case is its own transaction, so one refusal
 * leaves the rest to start; it is logged and tried again on the next run.
 * @param {{today?: string}} [opts]  the Lagos day to run as (tests); today by default
 */
async function dispatch({ today = lagos.today() } = {}) {
  let started = 0;
  let failed = 0;
  for (const id of await repo.dueToStart(pool, today)) {
    try {
      if (await tx((client) => startIn(client, id, today))) started += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err, onboarding_case_id: id }, "onboarding-dispatch: a case did not start");
    }
  }
  const reminded = await remindOverdue(today);
  return { started, failed, reminded };
}

/** Mark Step Done: a pending step of a case at onboarding. */
async function markStepDone(actor, scope, id, stepId) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    if (row.status !== "onboarding") throw refused("NOT_IN_ONBOARDING", "Onboarding has not started for this hire");
    const st = await repo.caseStep(client, id, stepId, { lock: true });
    if (!st) throw refused("NOT_FOUND", "That step is not on this case", 404);
    if (!(await repo.stepDone(client, stepId, actor.user_id))) throw refused("STEP_DONE", "This step is already done");
    await emit(client, {
      key: EVENTS.ONBOARDING_STEP_DONE,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { onboarding_case_step_id: stepId, title: st.title }),
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/* ------------------------------------------------------------------ *
 * Complete Onboarding and Withdraw
 * ------------------------------------------------------------------ */

/**
 * Complete Onboarding, all or nothing: the company email becomes the hire's work email (it was their
 * candidate address since acceptance; organisation refuses one another person or login holds), their
 * login is invited on it with the Staff role, the application is hired (candidates.hireIn: the
 * Organogram seat filled, the vacancy closed as filled when its openings are), and the case completed.
 */
async function complete(actor, scope, id, { work_email: workEmail }) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    if (row.status !== "onboarding") throw refused("NOT_IN_ONBOARDING", "Onboarding has not started for this hire");
    if (!row.employee_id) throw refused("NO_EMPLOYEE", "This case has no employee record");
    if ((await repo.openSteps(client, id)) > 0) throw refused("STEPS_OPEN", "Mark every step done first");
    await organisation.updateEmployee(client, row.employee_id, { work_email: workEmail }, actor);
    const userId = await users().inviteIn(client, { employee_id: row.employee_id, role_codes: [HIRE_ROLE] }, actor);
    const hired = await candidates().hireIn(client, actor, row.application_id, { employee_id: row.employee_id });
    if (!(await repo.setCompleted(client, id))) throw refused("NOT_IN_ONBOARDING", "Onboarding has not started for this hire");
    await emit(client, {
      key: EVENTS.ONBOARDING_COMPLETED,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { user_id: userId, seat_filled: hired.seat_filled, vacancy_closed: hired.vacancy_closed }),
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/**
 * Withdraw: the hire is not joining (guide §11), at any point before completion. In one transaction
 * the contract is cancelled while still unsigned (a signed one stays the record of what was signed),
 * the Upload Documents links stop, the employee made at acceptance is archived, the application is
 * withdrawn (no mail to the hire) and the case cancelled with the reason.
 */
async function withdraw(actor, scope, id, { reason }) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    if (!OPEN.includes(row.status)) throw refused("CASE_ENDED", "This case has already ended");
    await candidates().withdrawnIn(client, actor, row.application_id, reason);
    if (!(await endIn(client, actor, row, reason, "Did not join: onboarding withdrawn"))) throw refused("CASE_ENDED", "This case has already ended");
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/**
 * End an open case in the caller's transaction, as Withdraw and Not Progressing both do: an unsigned
 * contract cancelled, the Upload Documents links stopped, the employee made at acceptance archived,
 * the case cancelled with the reason, `onboarding.cancelled`. The application is the caller's.
 */
async function endIn(client, actor, row, reason, archiveReason) {
  const id = row.onboarding_case_id;
  await contracts().cancelIn(client, actor, id, reason);
  await publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: id, scope: SCOPE });
  if (row.employee_id) {
    const employee = await organisation.findEmployeeById(client, row.employee_id);
    if (employee && employee.status !== "archived") await organisation.archiveEmployee(client, row.employee_id, archiveReason, actor);
  }
  if (!(await repo.setCancelled(client, id, reason))) return false;
  await emit(client, {
    key: EVENTS.ONBOARDING_CANCELLED,
    entity: { type: ENTITY, id },
    actor,
    payload: payload(row, { from_status: row.status }),
  });
  return true;
}

/**
 * Not Progressing (M4) on an application at Documentation or after, from the outbox: its case ends as
 * Withdraw ends it, the reason the application's, so no hire is left half onboarded (no live contract,
 * no active employee, no case the start date would move). A case already ended only has its links
 * stopped again. Safe to run twice.
 */
async function endForApplication(applicationId, actorUserId = null) {
  const found = await repo.byApplication(pool, applicationId);
  if (!found) return false;
  return tx(async (client) => {
    const row = await repo.get(client, found.onboarding_case_id, { lock: true });
    if (!row || !OPEN.includes(row.status)) {
      await publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: found.onboarding_case_id, scope: SCOPE });
      return false;
    }
    const reason = (await repo.applicationEndReason(client, applicationId)) || "Not progressed in Recruitment";
    const actor = actorUserId ? { user_id: actorUserId } : null;
    return endIn(client, actor, row, reason, "Did not join: not progressed in Recruitment");
  });
}

module.exports = {
  openCaseIn,
  requiredCount,
  caseForOffer,
  list,
  summary,
  get,
  detailOf,
  itemOf,
  guarantorOf,
  stateOf,
  checkGateIn,
  contractSignedIn,
  verifyItem,
  rejectItem,
  checkGuarantor,
  remind,
  startIn,
  dispatch,
  markStepDone,
  complete,
  withdraw,
  endForApplication,
};

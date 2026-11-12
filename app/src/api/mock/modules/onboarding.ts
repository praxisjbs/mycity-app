import contractSchemas from "@mycity/contract/schemas/employment_contracts.js";
import onboardingSchemas from "@mycity/contract/schemas/onboarding.js";
import signatureSchemas from "@mycity/contract/schemas/signatures.js";
import type {
  ContractTemplate,
  DocumentRequirement,
  EmploymentContractView,
  GateCondition,
  Guarantor,
  OnboardingDetail,
  OnboardingItem,
  OnboardingPlan,
  OnboardingPlanRow,
  OnboardingRow,
  OnboardingStatus,
  OnboardingStep,
  OnboardingSummary,
  SignerView,
} from "@mycity/contract/contract.gen.ts";
import type { RawResponse } from "../../client";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { byKey, grantsFor } from "../data/people";

/**
 * Recruitment · Onboarding on the in-browser mock (laptops and CI only, F12), in the contract's shapes
 * (docs/guides/offers.md §5): the cases and their figures, each case's checklist, guarantors, contract
 * and plan steps; Verify and Reject, Record Check, Send Reminder, Mark Step Done, Complete Onboarding
 * and Withdraw; the contract's Sign for Company and Resend; and the Checklist, Plans and Contract
 * settings. Bodies are checked by the contract's own schemas. The cases are fixtures: an offer
 * accepted on the mock's Offers does not open one here (the server's acceptance does).
 */

type Act = "view" | "create" | "edit";
const can = (req: Req, act: Act) => Boolean(req.user && (grantsFor(req.user).recruitment ?? []).includes(act));
function R(key: string, act: Act, handler: (req: Req) => RawResponse) {
  route(key, (req) => (can(req, act) ? handler(req) : fail(403, "PERMISSION_DENIED", "You do not have access to this")));
}

interface Issue {
  path: PropertyKey[];
  message: string;
}
interface Checker<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}
function parse<T>(schema: unknown, body: unknown, then: (data: T) => RawResponse): RawResponse {
  const r = (schema as Checker<T>).safeParse(body);
  if (r.success) return then(r.data);
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) fields[i.path.map(String).join(".") || "body"] ??= [i.message];
  return invalid(fields);
}

const nowIso = () => new Date().toISOString();
const today = () => isoDaysAhead(0);
/** Who signs for the company on the mock (the Offers settings' Offer Signatory). */
const SIGNATORY = "cynthia";

/* ------------------------------------------------------------------ *
 * The Checklist and Plans settings
 * ------------------------------------------------------------------ */

const REQUIREMENTS: DocumentRequirement[] = [
  ["proof_of_address", "Proof of Residential Address", "file"],
  ["valid_id", "Valid ID", "file"],
  ["certificates", "Educational and Professional Certificates", "file"],
  ["separation", "Evidence of Separation", "file"],
  ["birth_certificate", "Birth Certificate", "file"],
  ["employee_data_form", "Employee Data Form", "file"],
  ["mylagosapp_wallet", "MyLagosApp Wallet ID", "number"],
  ["passport_photo", "Passport Photograph", "file"],
  ["account_opening", "Account Opening Form", "file"],
].map(([code, name, kind], i) => ({
  document_requirement_id: sid(`req:${code}`),
  code: code!,
  name: name!,
  description: null,
  kind: kind as DocumentRequirement["kind"],
  required: code !== "separation",
  expires: code === "valid_id",
  active: true,
  display_order: i + 1,
}));

const SOP = { sop_id: sid("sop:induction"), number: "SOP-0003", title: "New Joiner Induction" };
const PLANS: OnboardingPlan[] = [
  {
    onboarding_plan_id: sid("plan:default"),
    department_id: null,
    department: null,
    name: "Your First 30 Days",
    active: true,
    updated_at: at(20, "10:00"),
    steps: [
      ["Week 1: welcome and induction", "case_owner", 0, SOP],
      ["Weeks 2 to 3: shadow the team", "line_manager", 7, null],
      ["Week 4: first goals agreed", "line_manager", 21, null],
      ["First month review", "head_of_department", 30, null],
    ].map(([title, owner_role, due, sop], i) => ({
      onboarding_plan_step_id: sid(`plan:default:${i}`),
      position: i + 1,
      title: title as string,
      description: null,
      owner_role: owner_role as OnboardingPlan["steps"][number]["owner_role"],
      due_offset_days: due as number,
      sop: sop as OnboardingPlan["steps"][number]["sop"],
    })),
  },
];
const planRow = (p: OnboardingPlan): OnboardingPlanRow => ({
  onboarding_plan_id: p.onboarding_plan_id,
  department_id: p.department_id,
  department: p.department,
  name: p.name,
  active: p.active,
  step_count: p.steps.length,
  updated_at: p.updated_at,
});

/* ------------------------------------------------------------------ *
 * The cases
 * ------------------------------------------------------------------ */

interface MockCase {
  id: string;
  hire: string;
  job_title: string;
  department: string | null;
  status: OnboardingStatus;
  starts_on: string;
  created_at: string;
  privacy_at: string | null;
  docs_done_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  end_reason: string | null;
  items: OnboardingItem[];
  guarantors: Guarantor[];
  bvn: boolean;
  contract: { status: EmploymentContractView["status"]; company_at: string | null; hire_at: string | null };
  steps: OnboardingStep[];
}

const file = (key: string, name: string): OnboardingItem["document"] => ({ document_id: sid(`doc:${key}`), file_name: name, size_bytes: 412_000, mime_type: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" });

/** The checklist as a case holds it: every item in `state`, unless `except` names another. */
function itemsFor(key: string, state: OnboardingItem["status"], except: Record<string, Partial<OnboardingItem>> = {}): OnboardingItem[] {
  return REQUIREMENTS.map((r) => {
    const sent = state !== "pending";
    const base: OnboardingItem = {
      onboarding_checklist_item_id: sid(`item:${key}:${r.code}`),
      document_requirement_id: r.document_requirement_id,
      title: r.name,
      kind: r.kind,
      required: r.required,
      status: state,
      document: sent && r.kind !== "number" ? file(`${key}:${r.code}`, `${r.code}.pdf`) : null,
      entered_value: sent && r.kind !== "file" ? "MLA-4471-2208" : null,
      uploaded_at: sent ? at(6, "19:40") : null,
      verified_at: state === "verified" ? at(4, "11:00") : null,
      rejected_reason: null,
      display_order: r.display_order,
    };
    const more = except[r.code];
    if (!more) return base;
    const s = more.status ?? state;
    return {
      ...base,
      ...(s === "pending" ? { document: null, entered_value: null, uploaded_at: null } : {}),
      ...(s !== "pending" && !base.uploaded_at ? { document: r.kind !== "number" ? file(`${key}:${r.code}`, `${r.code}.jpg`) : null, entered_value: r.kind !== "file" ? "MLA-4471-2208" : null, uploaded_at: at(2, "21:05") } : {}),
      ...(s === "verified" ? { verified_at: at(1, "10:00") } : { verified_at: null }),
      ...more,
    };
  });
}

function guarantor(key: string, position: 1 | 2, name: string, check: Guarantor["check_status"]): Guarantor {
  return {
    onboarding_guarantor_id: sid(`guar:${key}:${position}`),
    position,
    kind: position === 1 ? "previous_employer" : "personal",
    full_name: name,
    relationship: position === 1 ? "Former line manager" : "Family friend",
    organisation: position === 1 ? "Lagos Media Group" : null,
    job_title: position === 1 ? "Head of Content" : null,
    phone: position === 1 ? "+2348031234567" : "+2348039876543",
    email: position === 1 ? "references@lagosmedia.test" : null,
    years_known: position === 1 ? 3 : 9,
    form: file(`${key}:g${position}`, `guarantor-${position}.pdf`),
    check_status: check,
    check_note: check === "failed" ? "Number did not answer on three tries" : check === "passed" ? "Confirmed by phone" : null,
    checked_at: check === "pending" ? null : at(3, "14:00"),
  };
}

function stepsFor(key: string, startsOn: string, done: number): OnboardingStep[] {
  const owners: Record<string, string> = { case_owner: "Cynthia Okafor", line_manager: "Tunde Bakare", head_of_department: "Ifeoma Nwosu" };
  const plan = PLANS[0]!;
  return plan.steps.map((s, i) => {
    const due = new Date(`${startsOn}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + s.due_offset_days);
    const dueOn = due.toISOString().slice(0, 10);
    const isDone = i < done;
    return {
      onboarding_case_step_id: sid(`step:${key}:${i}`),
      position: s.position,
      title: s.title,
      description: s.description,
      owner_role: s.owner_role,
      owner_id: sid(`emp:${s.owner_role}`),
      owner_name: owners[s.owner_role] ?? null,
      due_on: dueOn,
      overdue: !isDone && dueOn < today(),
      sop: s.sop,
      status: isDone ? "done" : "pending",
      done_at: isDone ? at(Math.max(0, 8 - i * 3), "16:00") : null,
    };
  });
}

const CASES: MockCase[] = [
  {
    // Accepted on the mock's Offers (OFF-0017): sending her documents, two waiting for a check.
    id: sid("case:chiamaka"),
    hire: "Chiamaka Eze",
    job_title: "Content Producer",
    department: "Content",
    status: "documentation",
    starts_on: isoDaysAhead(12),
    created_at: at(15, "20:12"),
    privacy_at: at(14, "08:30"),
    docs_done_at: null,
    completed_at: null,
    cancelled_at: null,
    end_reason: null,
    items: itemsFor("chiamaka", "pending", {
      valid_id: { status: "verified" },
      passport_photo: { status: "uploaded" },
      employee_data_form: { status: "uploaded" },
      mylagosapp_wallet: { status: "uploaded" },
      proof_of_address: { status: "rejected", rejected_reason: "The bill is older than three months" },
    }),
    guarantors: [guarantor("chiamaka", 1, "Olumide Bankole", "passed"), guarantor("chiamaka", 2, "Ngozi Eze", "pending")],
    bvn: true,
    contract: { status: "sent", company_at: at(14, "10:00"), hire_at: null },
    steps: [],
  },
  {
    // Just accepted: nothing sent yet, and the contract waits for the company's signature.
    id: sid("case:kunle"),
    hire: "Kunle Afolabi",
    job_title: "Head, Sales & Revenue",
    department: "Marketing & Sales",
    status: "documentation",
    starts_on: isoDaysAhead(24),
    created_at: at(1, "18:40"),
    privacy_at: null,
    docs_done_at: null,
    completed_at: null,
    cancelled_at: null,
    end_reason: null,
    items: itemsFor("kunle", "pending"),
    guarantors: [],
    bvn: false,
    contract: { status: "draft", company_at: null, hire_at: null },
    steps: [],
  },
  {
    id: sid("case:bola"),
    hire: "Bola Adewale",
    job_title: "Support Officer",
    department: "Support",
    status: "pre_onboarding",
    starts_on: isoDaysAhead(5),
    created_at: at(25, "12:00"),
    privacy_at: at(24, "09:00"),
    docs_done_at: at(6, "15:20"),
    completed_at: null,
    cancelled_at: null,
    end_reason: null,
    items: itemsFor("bola", "verified", { separation: { status: "pending" } }),
    guarantors: [guarantor("bola", 1, "Kehinde Ojo", "passed"), guarantor("bola", 2, "Funke Adewale", "passed")],
    bvn: true,
    contract: { status: "signed", company_at: at(24, "10:00"), hire_at: at(22, "19:15") },
    steps: [],
  },
  {
    id: sid("case:samuel"),
    hire: "Samuel Akpan",
    job_title: "Field Sales Executive",
    department: "Marketing & Sales",
    status: "onboarding",
    starts_on: isoDaysAgo(10),
    created_at: at(40, "12:00"),
    privacy_at: at(39, "09:00"),
    docs_done_at: at(18, "15:20"),
    completed_at: null,
    cancelled_at: null,
    end_reason: null,
    items: itemsFor("samuel", "verified"),
    guarantors: [guarantor("samuel", 1, "Uche Obi", "passed"), guarantor("samuel", 2, "Ada Akpan", "passed")],
    bvn: true,
    contract: { status: "signed", company_at: at(39, "10:00"), hire_at: at(37, "19:15") },
    steps: stepsFor("samuel", isoDaysAgo(10), 1),
  },
  {
    id: sid("case:ngozi"),
    hire: "Ngozi Umeh",
    job_title: "Finance Officer",
    department: "Finance",
    status: "completed",
    starts_on: isoDaysAgo(34),
    created_at: at(60, "12:00"),
    privacy_at: at(59, "09:00"),
    docs_done_at: at(40, "15:20"),
    completed_at: at(3, "11:30"),
    cancelled_at: null,
    end_reason: null,
    items: itemsFor("ngozi", "verified"),
    guarantors: [guarantor("ngozi", 1, "Emeka Obi", "passed"), guarantor("ngozi", 2, "Joy Umeh", "passed")],
    bvn: true,
    contract: { status: "signed", company_at: at(59, "10:00"), hire_at: at(57, "19:15") },
    steps: stepsFor("ngozi", isoDaysAgo(34), 4),
  },
  {
    id: sid("case:femi"),
    hire: "Femi Lawal",
    job_title: "Studio Assistant",
    department: "Studio",
    status: "cancelled",
    starts_on: isoDaysAgo(2),
    created_at: at(30, "12:00"),
    privacy_at: at(29, "09:00"),
    docs_done_at: null,
    completed_at: null,
    cancelled_at: at(8, "10:00"),
    end_reason: "Accepted a counter-offer from their employer",
    items: itemsFor("femi", "pending", { valid_id: { status: "uploaded" } }),
    guarantors: [],
    bvn: false,
    contract: { status: "cancelled", company_at: at(28, "10:00"), hire_at: null },
    steps: [],
  },
];

const OPEN: OnboardingStatus[] = ["documentation", "pre_onboarding", "onboarding"];
const find = (id: string | undefined) => CASES.find((c) => c.id === id);
const outstanding = (c: MockCase) => c.items.filter((i) => i.required && i.status !== "verified").length;

function waitingOn(c: MockCase): GateCondition[] {
  if (c.status !== "documentation") return [];
  const out: GateCondition[] = [];
  if (outstanding(c) > 0) out.push("documents");
  if (c.guarantors.length < 2 || c.guarantors.some((g) => g.check_status !== "passed")) out.push("guarantors");
  if (!c.bvn) out.push("bvn");
  if (c.contract.status !== "signed") out.push("contract");
  return out;
}

function rowOf(c: MockCase): OnboardingRow {
  return {
    onboarding_case_id: c.id,
    hire_name: c.hire,
    job_title: c.job_title,
    department: c.department,
    status: c.status,
    starts_on: c.starts_on,
    items_outstanding: outstanding(c),
    created_at: c.created_at,
  };
}

function signersOf(c: MockCase): SignerView[] {
  const s = byKey(SIGNATORY);
  const ended = c.contract.status === "cancelled";
  return [
    { name: s?.display_name ?? "Offer Signatory", title: s?.job_title ?? null, role: "mycity", status: c.contract.company_at ? "signed" : ended ? "expired" : "pending", signed_at: c.contract.company_at, method: c.contract.company_at ? "type" : null },
    { name: c.hire, title: null, role: "candidate", status: c.contract.hire_at ? "signed" : ended ? "expired" : "pending", signed_at: c.contract.hire_at, method: c.contract.hire_at ? "draw" : null },
  ];
}

function contractOf(c: MockCase, req: Req): EmploymentContractView {
  const n = CASES.indexOf(c) + 1;
  return {
    employment_contract_id: sid(`contract:${c.id}`),
    number: `CON-${String(n).padStart(4, "0")}`,
    status: c.contract.status,
    starts_on: c.starts_on,
    ends_on: null,
    document: { document_id: sid(`doc:contract:${c.id}`), file_name: `CON-${String(n).padStart(4, "0")}.pdf`, size_bytes: 180_000, mime_type: "application/pdf" },
    signers: signersOf(c),
    created_at: c.created_at,
    can_sign: c.contract.status === "draft" && req.user === SIGNATORY,
    can_resend: c.contract.status === "sent" && can(req, "edit"),
  };
}

function detailOf(c: MockCase, req: Req): OnboardingDetail {
  return {
    ...rowOf(c),
    application_id: sid(`app:case:${c.id}`),
    offer_id: sid(`offer:case:${c.id}`),
    employee_id: sid(`emp:case:${c.id}`),
    owner_id: byKey(SIGNATORY)?.employee_id ?? null,
    privacy_acknowledged_at: c.privacy_at,
    documentation_completed_at: c.docs_done_at,
    completed_at: c.completed_at,
    cancelled_at: c.cancelled_at,
    end_reason: c.end_reason,
    items: c.items,
    guarantors: c.guarantors,
    bvn_entered: c.bvn,
    contract: contractOf(c, req),
    waiting_on: waitingOn(c),
    steps: c.steps,
    can_complete: c.status === "onboarding" && c.steps.every((s) => s.status === "done"),
    can_withdraw: OPEN.includes(c.status),
  };
}

/** The gate, as the server asks it after each of its conditions. */
function gate(c: MockCase) {
  if (c.status === "documentation" && waitingOn(c).length === 0) {
    c.status = "pre_onboarding";
    c.docs_done_at = nowIso();
  }
}

const caseNotFound = () => fail(404, "NOT_FOUND", "That case does not exist");
const notAtDocs = () => fail(409, "NOT_IN_DOCUMENTATION", "This case is past documentation");

R("GET /api/v1/recruitment/onboarding/summary", "view", () => {
  const month = today().slice(0, 7);
  const body: OnboardingSummary = {
    documentation: CASES.filter((c) => c.status === "documentation").length,
    to_verify: CASES.filter((c) => c.status === "documentation").reduce((n, c) => n + c.items.filter((i) => i.status === "uploaded").length, 0),
    pre_onboarding: CASES.filter((c) => c.status === "pre_onboarding").length,
    onboarding: CASES.filter((c) => c.status === "onboarding").length,
    overdue_steps: CASES.filter((c) => c.status === "onboarding").reduce((n, c) => n + c.steps.filter((s) => s.overdue).length, 0),
    completed_this_month: CASES.filter((c) => c.status === "completed" && c.completed_at?.slice(0, 7) === month).length,
  };
  return ok(body);
});

R("GET /api/v1/recruitment/onboarding/requirements", "edit", (req) =>
  paged(REQUIREMENTS, req, {
    sort: { display_order: (a, b) => a.display_order - b.display_order, name: (a, b) => a.name.localeCompare(b.name) },
  }),
);
R("POST /api/v1/recruitment/onboarding/requirements", "edit", (req) =>
  parse<{ code: string; name: string; description: string | null; kind: DocumentRequirement["kind"]; required: boolean; expires: boolean }>(onboardingSchemas.DocumentRequirementCreate, req.body, (b) => {
    if (REQUIREMENTS.some((r) => r.code === b.code)) return fail(409, "CODE_TAKEN", "That code is in use", { code: ["That code is in use"] });
    const r: DocumentRequirement = { document_requirement_id: sid(`req:${b.code}`), ...b, description: b.description ?? null, active: true, display_order: REQUIREMENTS.length + 1 };
    REQUIREMENTS.push(r);
    return created(r);
  }),
);
R("PATCH /api/v1/recruitment/onboarding/requirements/:id", "edit", (req) => {
  const r = REQUIREMENTS.find((x) => x.document_requirement_id === req.params.id);
  if (!r) return notFound();
  return parse<Partial<DocumentRequirement>>(onboardingSchemas.DocumentRequirementEdit, req.body, (b) => {
    Object.assign(r, b, b.description === undefined ? {} : { description: b.description ?? null });
    return ok(r);
  });
});

R("GET /api/v1/recruitment/onboarding/plans", "edit", (req) => paged(PLANS.map(planRow), req, { sort: { name: (a, b) => a.name.localeCompare(b.name), updated_at: (a, b) => b.updated_at.localeCompare(a.updated_at) } }));
R("GET /api/v1/recruitment/onboarding/plans/:id", "edit", (req) => {
  const p = PLANS.find((x) => x.onboarding_plan_id === req.params.id);
  return p ? ok(p) : notFound();
});
type PlanBody = { department_id: string | null; name: string; active: boolean; steps: Array<{ title: string; description: string | null; owner_role: OnboardingStep["owner_role"]; due_offset_days: number; sop_id: string | null }> };
function savePlan(p: OnboardingPlan, b: PlanBody) {
  p.name = b.name;
  p.active = b.active;
  p.updated_at = nowIso();
  p.steps = b.steps.map((s, i) => ({
    onboarding_plan_step_id: sid(`${p.onboarding_plan_id}:${i}:${s.title}`),
    position: i + 1,
    title: s.title,
    description: s.description ?? null,
    owner_role: s.owner_role,
    due_offset_days: s.due_offset_days,
    sop: s.sop_id ? (s.sop_id === SOP.sop_id ? SOP : { sop_id: s.sop_id, number: "SOP", title: "Linked SOP" }) : null,
  }));
  return p;
}
R("POST /api/v1/recruitment/onboarding/plans", "edit", (req) =>
  parse<PlanBody>(onboardingSchemas.OnboardingPlanSave, req.body, (b) => {
    if (PLANS.some((p) => p.department_id === b.department_id)) return fail(409, "PLAN_EXISTS", "That department has a plan", { department_id: ["That department has a plan"] });
    const p: OnboardingPlan = { onboarding_plan_id: sid(`plan:${b.department_id ?? "x"}:${PLANS.length}`), department_id: b.department_id, department: b.department_id ? "Department" : null, name: b.name, active: b.active, updated_at: nowIso(), steps: [] };
    PLANS.push(savePlan(p, b));
    return created(p);
  }),
);
R("PUT /api/v1/recruitment/onboarding/plans/:id", "edit", (req) => {
  const p = PLANS.find((x) => x.onboarding_plan_id === req.params.id);
  if (!p) return notFound();
  return parse<PlanBody>(onboardingSchemas.OnboardingPlanSave, req.body, (b) => ok(savePlan(p, b)));
});

R("GET /api/v1/recruitment/onboarding", "view", (req) =>
  paged(CASES.map(rowOf), req, {
    search: (r) => [r.hire_name, r.job_title],
    filters: { status: (r, v) => r.status === v, department_id: () => true },
    // By start date unless asked, as the server lists them (its first sort).
    sort: { starts_on: (a, b) => (a.starts_on ?? "").localeCompare(b.starts_on ?? ""), created_at: (a, b) => b.created_at.localeCompare(a.created_at) },
  }),
);
R("GET /api/v1/recruitment/onboarding/:id", "view", (req) => {
  const c = find(req.params.id);
  return c ? ok(detailOf(c, req)) : caseNotFound();
});

R("POST /api/v1/recruitment/onboarding/:id/items/:item_id/verify", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  if (c.status !== "documentation") return notAtDocs();
  const it = c.items.find((i) => i.onboarding_checklist_item_id === req.params.item_id);
  if (!it) return notFound();
  if (it.status !== "uploaded") return fail(409, "NOT_UPLOADED", "Nothing waits to be verified here");
  it.status = "verified";
  it.verified_at = nowIso();
  gate(c);
  return ok(detailOf(c, req));
});
R("POST /api/v1/recruitment/onboarding/:id/items/:item_id/reject", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  if (c.status !== "documentation") return notAtDocs();
  const it = c.items.find((i) => i.onboarding_checklist_item_id === req.params.item_id);
  if (!it) return notFound();
  return parse<{ reason: string }>(onboardingSchemas.ChecklistItemReject, req.body, (b) => {
    if (it.status === "pending") return fail(409, "NOT_UPLOADED", "Nothing was sent for this item");
    it.status = "rejected";
    it.verified_at = null;
    it.rejected_reason = b.reason;
    return ok(detailOf(c, req));
  });
});
R("POST /api/v1/recruitment/onboarding/:id/guarantors/:guarantor_id/check", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  if (c.status !== "documentation") return notAtDocs();
  const g = c.guarantors.find((x) => x.onboarding_guarantor_id === req.params.guarantor_id);
  if (!g) return notFound();
  return parse<{ check_status: "passed" | "failed"; check_note: string | null }>(onboardingSchemas.ReferenceCheckRecord, req.body, (b) => {
    g.check_status = b.check_status;
    g.check_note = b.check_note ?? null;
    g.checked_at = nowIso();
    gate(c);
    return ok(detailOf(c, req));
  });
});
R("POST /api/v1/recruitment/onboarding/:id/remind", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  return c.status === "documentation" ? ok(detailOf(c, req)) : notAtDocs();
});
R("POST /api/v1/recruitment/onboarding/:id/steps/:step_id/done", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  if (c.status !== "onboarding") return fail(409, "NOT_IN_ONBOARDING", "This case is not at onboarding");
  const s = c.steps.find((x) => x.onboarding_case_step_id === req.params.step_id);
  if (!s) return notFound();
  if (s.status === "done") return fail(409, "STEP_DONE", "That step is already done");
  s.status = "done";
  s.done_at = nowIso();
  s.overdue = false;
  return ok(detailOf(c, req));
});
R("POST /api/v1/recruitment/onboarding/:id/complete", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  return parse<{ work_email: string }>(onboardingSchemas.OnboardingComplete, req.body, (b) => {
    if (c.status !== "onboarding") return fail(409, "NOT_IN_ONBOARDING", "This case is not at onboarding");
    if (c.steps.some((s) => s.status !== "done")) return fail(409, "STEPS_OPEN", "Mark every step done first");
    if (b.work_email.endsWith("@mycityapp.io") && b.work_email.startsWith("cynthia")) return fail(409, "EMPLOYEE_EXISTS", "Another person has that email", { work_email: ["Another person's email"] });
    c.status = "completed";
    c.completed_at = nowIso();
    return ok(detailOf(c, req));
  });
});
R("POST /api/v1/recruitment/onboarding/:id/withdraw", "edit", (req) => {
  const c = find(req.params.id);
  if (!c) return caseNotFound();
  return parse<{ reason: string }>(onboardingSchemas.OnboardingCancel, req.body, (b) => {
    if (!OPEN.includes(c.status)) return fail(409, "CASE_ENDED", "This case has ended");
    c.status = "cancelled";
    c.cancelled_at = nowIso();
    c.end_reason = b.reason;
    if (c.contract.status !== "signed") c.contract.status = "cancelled";
    return ok(detailOf(c, req));
  });
});

/* ------------------------------------------------------------------ *
 * The contract on the case, and its wording
 * ------------------------------------------------------------------ */

const byContract = (id: string | undefined) => CASES.find((c) => sid(`contract:${c.id}`) === id);

R("POST /api/v1/recruitment/contracts/:id/sign", "view", (req) => {
  const c = byContract(req.params.id);
  if (!c) return notFound();
  if (req.user !== SIGNATORY || c.contract.status !== "draft") return fail(409, "NOT_YOUR_TURN", "This contract does not wait for you");
  return parse(signatureSchemas.SignSubmit, req.body, () => {
    c.contract.status = "sent";
    c.contract.company_at = nowIso();
    return ok(contractOf(c, req));
  });
});
R("POST /api/v1/recruitment/contracts/:id/resend", "edit", (req) => {
  const c = byContract(req.params.id);
  if (!c) return notFound();
  return c.contract.status === "sent" ? ok(contractOf(c, req)) : fail(409, "NOT_SENT", "The company has not signed yet");
});
R("GET /api/v1/recruitment/contracts/:id", "view", (req) => {
  const c = byContract(req.params.id);
  return c ? ok(contractOf(c, req)) : notFound();
});

const STANDARD = [
  "**CONTRACT OF EMPLOYMENT**",
  "",
  "This contract is made between {{ company }} and {{ employee.full_name }} ({{ employee.staff_number }}).",
  "",
  "## 1. Position",
  "",
  "You are employed as {{ job_title }} from {{ longdate start_date }}, reporting to {{ reports_to }}.",
].join("\n");
const VARIABLES = Object.keys((contractSchemas.EmploymentContractVars as unknown as { shape: Record<string, unknown> }).shape).filter((k) => k !== "sealing");
const WORDING = { body: STANDARD, version: 0, updated_at: null as string | null };
const wordingOut = (): ContractTemplate => ({ body: WORDING.body, version: WORDING.version, is_default: WORDING.version === 0, variables: VARIABLES, updated_at: WORDING.updated_at });

R("GET /api/v1/recruitment/contracts/settings/template", "edit", () => ok(wordingOut()));
R("PUT /api/v1/recruitment/contracts/settings/template", "edit", (req) =>
  parse<{ body: string }>(contractSchemas.ContractTemplateSave, req.body, (b) => {
    WORDING.body = b.body;
    WORDING.version += 1;
    WORDING.updated_at = nowIso();
    return ok(wordingOut());
  }),
);
R("POST /api/v1/recruitment/contracts/settings/template/restore", "edit", () => {
  WORDING.body = STANDARD;
  WORDING.version += 1;
  WORDING.updated_at = nowIso();
  return ok({ ...wordingOut(), is_default: true });
});

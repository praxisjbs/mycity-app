"use strict";
/**
 * Policies: every company policy in one place, Knowledge Hub · Policies, read and acknowledged on
 * ESS · Policy Updates (docs/guides/policies.md). A policy is a written document or a rules policy
 * of a type the code knows (Attendance, whose rules are the attendance contract's
 * AttendanceRules); each has a draft, an optional submission for approval, and numbered versions
 * from a first day.
 *
 * Text never crosses the wire as HTML a screen injects: a document's text is Markdown, and what a
 * person reads is `body` (RichTextBlock[]), built by the one Markdown renderer
 * (shared/documents/markdown.js). The editor sends HTML (`body_html`), which the server turns into
 * Markdown keeping only headings, paragraphs, lists, bold, italic and links, and gives back as
 * `body_html` for the editor to load.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef, WorkPattern } = require("./organisation");
const { AttendanceRules, AttendanceRulesDraft } = require("./attendance");

const minLength = (n) => (v) => v.length >= n;
const reasonText = text(500).refine(minLength(10), "At least 10 characters");

/** What a policy is: a written document, or a rules policy of a type the code knows. */
const PolicyKind = z.enum(["document", "attendance"]);
/**
 * A policy's state on the day, in Lagos: `draft` (nothing published yet), `awaiting_approval` (a
 * submission waits), `waiting` (published, its first version still to start), `in_force`, or
 * `archived` (a document that stopped applying).
 */
const PolicyState = z.enum(["draft", "awaiting_approval", "waiting", "in_force", "archived"]);
/**
 * A version's state: `waiting` (its first day after today), `in_force` (the one applying today),
 * `past` (replaced), `withdrawn` (withdrawn before its first day), or `awaiting_approval` (submitted,
 * not yet a version).
 */
const VersionState = z.enum(["waiting", "in_force", "past", "withdrawn", "awaiting_approval"]);

/** Who a version applies to: everyone, or any mix of departments, work patterns and named people. */
const AppliesTo = z
  .object({
    everyone: z.boolean(),
    department_ids: z.array(uuid).max(50),
    work_patterns: z.array(WorkPattern).max(3),
    employee_ids: z.array(uuid).max(200),
  })
  .strict()
  .refine((a) => a.everyone || a.department_ids.length + a.work_patterns.length + a.employee_ids.length > 0, {
    message: "Pick who it applies to",
    path: ["everyone"],
  });

/** A run of text with its marks, as the reader shows it. */
const RichTextSpan = z
  .object({
    text: z.string(),
    bold: z.boolean(),
    italic: z.boolean(),
    href: z.string().nullable(),
  })
  .strict();

/** One block of text: a heading, a paragraph, or a list's items. */
const RichTextBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), level: z.number().int().min(2).max(4), spans: z.array(RichTextSpan) }).strict(),
  z.object({ kind: z.literal("paragraph"), spans: z.array(RichTextSpan) }).strict(),
  z.object({ kind: z.literal("bullets"), items: z.array(z.array(RichTextSpan)) }).strict(),
  z.object({ kind: z.literal("numbered"), items: z.array(z.array(RichTextSpan)) }).strict(),
]);

/** A rules policy as staff read it: a section's sentences, each tagged when the version changed it. */
const PolicySection = z
  .object({
    key: z.string(),
    title: z.string(),
    sentences: z.array(z.object({ key: z.string(), text: z.string(), changed: z.boolean() }).strict()),
  })
  .strict();

/** Who signed a version, and as what. */
const PolicySignature = z
  .object({
    role: z.enum(["publisher", "approver"]),
    stage_name: z.string().nullable(),
    signer_name: z.string(),
    signer_title: z.string().nullable(),
    signed_at: isoDateTime,
  })
  .strict();

/** A drawn signature as the pad gives it: a PNG data URL. */
const SignaturePng = z
  .string()
  .max(300_000, "Signature too large")
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Sign in the box");

/** What a version says, for whoever reads it: text or sections, and what it changed. */
const contentFields = {
  title: z.string(),
  applies_to: AppliesTo,
  applies_to_text: z.string(),
  needs_acknowledgement: z.boolean(),
  acknowledge_within_days: z.number().int().min(1).max(30),
  body: z.array(RichTextBlock).nullable(),
  rules: AttendanceRules.nullable(),
  sections: z.array(PolicySection).nullable(),
  /** What changed against the version before it: rule keys, `text`, `title` or `applies_to`. */
  changed: z.array(z.string()),
  /** The same as lines a person reads ("Grace minutes: 5 to 10"), at most five. */
  change_lines: z.array(z.string()),
};

/** A version as People read it on Knowledge Hub · Policies. */
const PolicyVersion = z
  .object({
    policy_version_id: uuid,
    policy_id: uuid,
    number: z.string(),
    kind: PolicyKind,
    version: z.number().int().min(1).nullable(),
    state: VersionState,
    effective_from: isoDate,
    note: z.string(),
    ...contentFields,
    published_at: isoDateTime.nullable(),
    published_by_name: z.string().nullable(),
    withdrawn_at: isoDateTime.nullable(),
    withdraw_reason: z.string().nullable(),
    signatures: z.array(PolicySignature),
    content_hash: z.string(),
    asked: z.number().int().min(0),
    acknowledged: z.number().int().min(0),
    overdue: z.number().int().min(0),
  })
  .strict();
const PolicyVersionPage = Paged(PolicyVersion);

/** The draft as the editor loads it, and what it changes against the version it would replace. */
const PolicyDraft = z
  .object({
    policy_version_id: uuid,
    title: z.string(),
    applies_to: AppliesTo,
    /** The people Applies To names, as the picker shows them. */
    applies_to_people: z.array(PersonRef),
    needs_acknowledgement: z.boolean(),
    acknowledge_within_days: z.number().int().min(1).max(30),
    needs_approval: z.boolean(),
    body_html: z.string().nullable(),
    rules: AttendanceRules.nullable(),
    changed: z.array(z.string()),
    change_lines: z.array(z.string()),
    updated_at: isoDateTime,
    updated_by_name: z.string().nullable(),
  })
  .strict();

/** A submission waiting for approval: its stage and who submitted it. */
const PolicySubmission = z
  .object({
    policy_version_id: uuid,
    effective_from: isoDate,
    note: z.string(),
    submitted_at: isoDateTime,
    submitted_by_name: z.string().nullable(),
    stage_name: z.string().nullable(),
    workflow_instance_id: uuid.nullable(),
  })
  .strict();

/**
 * One policy for People: its version in force, a version waiting to start, the draft and a
 * submission. The Attendance policy always exists (migration 1405); before its first version, its
 * rules in force are the type's defaults.
 */
const Policy = z
  .object({
    policy_id: uuid,
    number: z.string(),
    kind: PolicyKind,
    title: z.string(),
    state: PolicyState,
    today: isoDate,
    /** A rules policy's rules applying today (the version in force, else the type's defaults). */
    current_rules: AttendanceRules.nullable(),
    /** A rules policy's suggested values, which a first draft starts from (the type's, never seeded). */
    suggested_rules: AttendanceRules.nullable(),
    in_force: PolicyVersion.nullable(),
    waiting: PolicyVersion.nullable(),
    draft: PolicyDraft.nullable(),
    submission: PolicySubmission.nullable(),
    can_edit: z.boolean(),
    can_archive: z.boolean(),
  })
  .strict();

/** A row of Knowledge Hub · Policies. */
const PolicyRow = z
  .object({
    policy_id: uuid,
    number: z.string(),
    kind: PolicyKind,
    title: z.string(),
    state: PolicyState,
    applies_to_text: z.string(),
    version_in_force: z.number().int().min(1).nullable(),
    asked: z.number().int().min(0),
    acknowledged: z.number().int().min(0),
    updated_at: isoDateTime.nullable(),
  })
  .strict();
const PolicyPage = Paged(PolicyRow);

const PolicyListQuery = listQuery(
  {
    kind: PolicyKind.optional(),
    state: PolicyState.optional(),
  },
  ["title", "number", "updated_at"],
);

/** The settings every draft carries; the body or the rules travel beside them. */
const draftSettings = {
  title: text(150).refine(minLength(3), "At least 3 characters"),
  applies_to: AppliesTo,
  needs_acknowledgement: z.boolean(),
  acknowledge_within_days: z.number().int().min(1, "At least 1").max(30, "At most 30"),
  needs_approval: z.boolean(),
};

/** POST /policies: a written policy, with an empty draft. */
const PolicyCreate = z.object(draftSettings).strict();

/** PUT /policies/:id/draft. A document sends `body_html`; a rules policy sends `rules`. */
const PolicyDraftSave = z
  .object({
    ...draftSettings,
    body_html: z.string().max(200_000, "Too long").nullable().optional(),
    rules: AttendanceRulesDraft.nullable().optional(),
  })
  .strict();

/** POST /policies/tidy: a suggestion only; nothing is saved. */
const PolicyTidy = z.object({ body_html: z.string().min(1).max(200_000, "Too long") }).strict();
const PolicyTidyResult = z.object({ body_html: z.string() }).strict();

/** POST /policies/:id/publish and /submit. The first day's checks are the service's (§6.3). */
const PolicyPublish = z.object({ effective_from: isoDate, note: reasonText, signature: SignaturePng }).strict();

/** A reason People or an approver give: withdraw, recall, archive, reject. */
const PolicyReason = z.object({ reason: reasonText }).strict();

/** POST /policies/me/versions/:id/approve */
const PolicyApprove = z.object({ signature: SignaturePng }).strict();

const PolicyVersionListQuery = listQuery({ state: VersionState.optional() });

/** One person asked about a version, and where they stand. */
const PolicyAck = z
  .object({
    employee: PersonRef,
    status: z.enum(["acknowledged", "pending", "overdue"]),
    due_on: isoDate,
    acknowledged_at: isoDateTime.nullable(),
    reminded_at: isoDateTime.nullable(),
  })
  .strict();
const PolicyAckPage = Paged(PolicyAck);
const PolicyAckListQuery = listQuery(
  {
    status: z.enum(["acknowledged", "pending", "overdue"]).optional(),
  },
  ["display_name", "acknowledged_at"],
);

/** A row of ESS · Policy Updates: a policy that applies to the reader, or one waiting on them. */
const MyPolicyRow = z
  .object({
    policy_version_id: uuid,
    policy_id: uuid,
    number: z.string(),
    kind: PolicyKind,
    title: z.string(),
    version: z.number().int().min(1).nullable(),
    state: VersionState,
    effective_from: isoDate,
    needs_acknowledgement: z.boolean(),
    due_on: isoDate.nullable(),
    acknowledged_at: isoDateTime.nullable(),
    to_acknowledge: z.boolean(),
    overdue: z.boolean(),
    waiting_on_me: z.boolean(),
  })
  .strict();
const MyPolicyPage = Paged(MyPolicyRow);
const MyPolicyListQuery = listQuery({
  state: z.enum(["to_acknowledge", "all", "waiting_on_me"]).optional(),
});

/** A version as an employee (or its approver) reads it. */
const MyPolicyVersion = z
  .object({
    policy_version_id: uuid,
    policy_id: uuid,
    number: z.string(),
    kind: PolicyKind,
    version: z.number().int().min(1).nullable(),
    state: VersionState,
    effective_from: isoDate,
    note: z.string(),
    ...contentFields,
    published_at: isoDateTime.nullable(),
    signatures: z.array(PolicySignature),
    due_on: isoDate.nullable(),
    acknowledged_at: isoDateTime.nullable(),
    can_acknowledge: z.boolean(),
    can_later: z.boolean(),
    /** For an approver: the stage waiting on them. */
    approval: z.object({ stage_name: z.string(), waiting_on_me: z.boolean() }).strict().nullable(),
    earlier: z.array(
      z
        .object({
          policy_version_id: uuid,
          version: z.number().int().min(1),
          effective_from: isoDate,
          state: VersionState,
        })
        .strict(),
    ),
  })
  .strict();

/** What the acknowledge sheet shows now: the versions owed, the oldest due first. */
const MyPolicyDue = z
  .object({
    items: z.array(
      z
        .object({
          policy_version_id: uuid,
          title: z.string(),
          version: z.number().int().min(1),
          first: z.boolean(),
          change_lines: z.array(z.string()),
          due_on: isoDate,
          overdue: z.boolean(),
          can_later: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

/** The variables of templates/documents/policy.html: a version on the letterhead with its signatures. */
const PolicyDocumentVars = z
  .object({
    policy_number: z.string(),
    title: z.string(),
    version: z.number().int().min(1),
    effective_from: isoDate,
    applies_to_text: z.string(),
    note: z.string(),
    body_markdown: z.string().nullable(),
    sections: z.array(z.object({ title: z.string(), sentences: z.array(z.string()) }).strict()),
    signatures: z.array(
      z
        .object({
          role: z.string(),
          signer_name: z.string(),
          signer_title: z.string().nullable(),
          signed_at: isoDateTime,
          image: z.string().nullable(),
        })
        .strict(),
    ),
    content_hash: z.string(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  AppliesTo: {
    table: null,
    reason: "who a version applies to: policy_version.applies_to_everyone and its policy_audience rows",
  },
  RichTextSpan: { table: null, reason: "a run of a document's text, built from policy_version.body_markdown" },
  PolicySection: { table: null, reason: "a rules policy's sentences, written from policy_version.rules" },
  PolicySignature: { table: "policy_signature" },
  PolicyVersion: {
    table: "policy_version",
    virtual: {
      number: "the policy's",
      kind: "the policy's",
      state: "worked out against today in Lagos",
      applies_to: "applies_to_everyone and the version's policy_audience rows",
      applies_to_text: "Applies To in words",
      body: "body_markdown, as the reader shows it",
      sections: "the rules as sentences",
      changed: "worked out against the version before it",
      change_lines: "changed, as a person reads it",
      published_by_name: "the publisher's name",
      signatures: "its policy_signature rows",
      asked: "everyone it applies to, counted now",
      acknowledged: "counted from policy_acknowledgement",
      overdue: "counted from policy_acknowledgement and the due dates",
    },
  },
  PolicyVersionPage: { table: null, reason: "a page of a policy's versions" },
  PolicyDraft: {
    table: "policy_version",
    virtual: {
      applies_to: "applies_to_everyone and the draft's policy_audience rows",
      applies_to_people: "the employees of its policy_audience rows",
      body_html: "body_markdown, as the editor loads it",
      changed: "worked out against the version it would replace",
      change_lines: "changed, as a person reads it",
      updated_by_name: "who saved it last",
    },
  },
  PolicySubmission: {
    table: "policy_version",
    virtual: { submitted_by_name: "the submitter's name", stage_name: "the approval's stage" },
  },
  Policy: {
    table: "policy",
    virtual: {
      state: "worked out from its versions and today",
      today: "today in Lagos",
      current_rules: "the rules a rules policy applies today",
      suggested_rules: "the type's suggestions for a first draft",
      in_force: "the version in force",
      waiting: "the version waiting to start",
      draft: "its draft",
      submission: "its submission",
      can_edit: "whether the reader may change it",
      can_archive: "whether the reader may archive it",
    },
  },
  PolicyRow: {
    table: "policy",
    virtual: {
      state: "worked out from its versions and today",
      applies_to_text: "Applies To of its newest version, in words",
      version_in_force: "the number of the version in force",
      asked: "everyone its newest version applies to",
      acknowledged: "counted from policy_acknowledgement",
    },
  },
  PolicyPage: { table: null, reason: "a page of policies" },
  PolicyListQuery: { table: null, reason: "list controls for policies" },
  PolicyCreate: {
    table: "policy_version",
    virtual: { applies_to: "applies_to_everyone and policy_audience rows" },
  },
  PolicyDraftSave: {
    table: "policy_version",
    virtual: {
      applies_to: "applies_to_everyone and policy_audience rows",
      body_html: "turned into body_markdown",
    },
  },
  PolicyTidy: { table: null, reason: "text sent for a tidied suggestion; nothing is saved" },
  PolicyTidyResult: { table: null, reason: "the tidied suggestion; nothing is saved" },
  PolicyPublish: {
    table: "policy_version",
    virtual: { signature: "stored in the vault, named by policy_signature.signature_document_id" },
  },
  PolicyReason: { table: null, reason: "why: kept as withdraw_reason, archive_reason or the approval's decision" },
  PolicyApprove: { table: null, reason: "the approver's signature, stored in the vault and named by policy_signature" },
  PolicyVersionListQuery: { table: null, reason: "list controls for a policy's versions" },
  PolicyAck: {
    table: "policy_acknowledgement",
    virtual: { employee: "the person asked", status: "worked out from acknowledged_at and due_on", due_on: "the version's due date for them" },
  },
  PolicyAckPage: { table: null, reason: "a page of the people asked about a version" },
  PolicyAckListQuery: { table: null, reason: "list controls for a version's acknowledgements" },
  MyPolicyRow: {
    table: "policy_version",
    virtual: {
      number: "the policy's",
      kind: "the policy's",
      state: "worked out against today in Lagos",
      due_on: "the reader's due date",
      acknowledged_at: "the reader's acknowledgement",
      to_acknowledge: "whether the reader still owes it",
      overdue: "past its due date and not acknowledged",
      waiting_on_me: "an approval stage waiting on the reader",
    },
  },
  MyPolicyPage: { table: null, reason: "a page of the policies that apply to the reader" },
  MyPolicyListQuery: { table: null, reason: "list controls for the reader's policies" },
  MyPolicyVersion: {
    table: "policy_version",
    virtual: {
      number: "the policy's",
      kind: "the policy's",
      state: "worked out against today in Lagos",
      applies_to: "applies_to_everyone and policy_audience rows",
      applies_to_text: "Applies To in words",
      body: "body_markdown, as the reader shows it",
      sections: "the rules as sentences",
      changed: "worked out against the version before it",
      change_lines: "changed, as a person reads it",
      signatures: "its policy_signature rows",
      due_on: "the reader's due date",
      acknowledged_at: "the reader's acknowledgement",
      can_acknowledge: "whether the reader may acknowledge it",
      can_later: "whether Later is still offered",
      approval: "the approval stage, for its approver",
      earlier: "the policy's earlier versions",
    },
  },
  MyPolicyDue: { table: null, reason: "what the acknowledge sheet shows the reader now" },
  PolicyDocumentVars: { table: null, reason: "the variables of templates/documents/policy.html" },
};

module.exports = {
  TABLES,
  PolicyKind,
  PolicyState,
  VersionState,
  AppliesTo,
  RichTextSpan,
  RichTextBlock,
  PolicySection,
  PolicySignature,
  SignaturePng,
  PolicyVersion,
  PolicyVersionPage,
  PolicyDraft,
  PolicySubmission,
  Policy,
  PolicyRow,
  PolicyPage,
  PolicyListQuery,
  PolicyCreate,
  PolicyDraftSave,
  PolicyTidy,
  PolicyTidyResult,
  PolicyPublish,
  PolicyReason,
  PolicyApprove,
  PolicyVersionListQuery,
  PolicyAck,
  PolicyAckPage,
  PolicyAckListQuery,
  MyPolicyRow,
  MyPolicyPage,
  MyPolicyListQuery,
  MyPolicyVersion,
  MyPolicyDue,
  PolicyDocumentVars,
};

import policies from "@mycity/contract/schemas/policies.js";
import type { AttendanceRules, Policy, PolicyDraftSave, PolicyMode, WorkPattern } from "@mycity/contract/contract.gen.ts";
import type { PersonRef } from "@/api/types/common";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { EmployeePicker } from "@/features/shared/pickers";
import { Button, Card, CardHeader, CheckboxField, ChoiceField, Chips, Field, Form, FormFooter, Grid, NumberField, Pill, RichTextField, TextField, toast, useConfirm, useContractForm, useModal, type ContractSchema } from "@mycity/ui";
import { MODE_LABEL, MODES_FOR, PATTERN_LABEL, RULE_HELP, RULE_LABEL, WORKSHEET, type ModeRule, type NumberRule, type VisibleRule } from "./labels";

/**
 * A policy's draft on Knowledge Hub · Policies (docs/guides/policies.md §6.2, §6.6): Policy Settings
 * (title, Applies To, acknowledgement, approval), then the editor with Tidy With AI for a document,
 * or the Attendance worksheet (attendance.md §6.15). Save Draft keeps every field; nobody is told.
 * The Attendance policy applies to everyone, so its title and Applies To are fixed.
 */

type Values = {
  title: string;
  audience: "everyone" | "some";
  department_ids: string[];
  work_patterns: WorkPattern[];
  people: PersonRef[];
  needs_acknowledgement: boolean;
  acknowledge_within_days: string;
  needs_approval: boolean;
  body_html: string;
  rules: AttendanceRules | null;
} & Record<NumberRule, string> &
  Record<ModeRule, PolicyMode>;

const NUMBER_RULES: readonly NumberRule[] = ["grace_minutes", "home_radius_m", "max_accuracy_m"];
const isNumberRule = (r: VisibleRule): r is NumberRule => (NUMBER_RULES as readonly string[]).includes(r);
const asNumber = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

/** The rules a draft starts from: its own, else the newest version's, else the type's suggestions. */
const baseRules = (p: Policy): AttendanceRules | null => p.draft?.rules ?? p.waiting?.rules ?? p.in_force?.rules ?? p.suggested_rules ?? p.current_rules;

function valuesOf(p: Policy): Values {
  const d = p.draft;
  const newest = p.waiting ?? p.in_force;
  const rules = baseRules(p);
  const a = d?.applies_to ?? newest?.applies_to ?? { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] };
  return {
    title: d?.title ?? newest?.title ?? p.title,
    audience: a.everyone ? "everyone" : "some",
    department_ids: a.department_ids,
    work_patterns: a.work_patterns,
    people: d?.applies_to_people ?? [],
    needs_acknowledgement: d?.needs_acknowledgement ?? newest?.needs_acknowledgement ?? true,
    acknowledge_within_days: String(d?.acknowledge_within_days ?? newest?.acknowledge_within_days ?? 7),
    needs_approval: d?.needs_approval ?? false,
    body_html: d?.body_html ?? "",
    rules,
    grace_minutes: String(rules?.grace_minutes ?? 0),
    home_radius_m: String(rules?.home_radius_m ?? 150),
    max_accuracy_m: String(rules?.max_accuracy_m ?? 100),
    office_geofence_mode: rules?.office_geofence_mode ?? "warn",
    home_geofence_mode: rules?.home_geofence_mode ?? "warn",
    site_geofence_mode: rules?.site_geofence_mode ?? "warn",
    device_mode: rules?.device_mode ?? "off",
  };
}

/** The body PUT /policies/:id/draft takes. Blank numbers stay blank for the contract to refuse. */
function bodyOf(p: Policy, v: Values): PolicyDraftSave {
  const settings = {
    title: p.kind === "attendance" ? p.title : v.title.trim(),
    applies_to:
      p.kind === "attendance" || v.audience === "everyone"
        ? { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] }
        : { everyone: false, department_ids: v.department_ids, work_patterns: v.work_patterns, employee_ids: v.people.map((x) => x.employee_id) },
    needs_acknowledgement: v.needs_acknowledgement,
    acknowledge_within_days: asNumber(v.acknowledge_within_days),
    needs_approval: v.needs_approval,
  };
  if (p.kind !== "attendance") return { ...settings, body_html: v.body_html };
  return {
    ...settings,
    rules: {
      ...(v.rules as AttendanceRules),
      grace_minutes: asNumber(v.grace_minutes),
      home_radius_m: asNumber(v.home_radius_m),
      max_accuracy_m: asNumber(v.max_accuracy_m),
      office_geofence_mode: v.office_geofence_mode,
      home_geofence_mode: v.home_geofence_mode,
      site_geofence_mode: v.site_geofence_mode,
      device_mode: v.device_mode,
    },
  };
}

/** The contract's draft schema over the form: its marks land on the field that holds each value. */
function draftSchema(p: Policy): ContractSchema {
  return {
    safeParse: (value: unknown) => {
      const r = policies.PolicyDraftSave.safeParse(bodyOf(p, value as Values));
      if (r.success) return r;
      const issues = (r.error?.issues ?? []).map((i) => {
        const [head, sub] = i.path;
        if (head === "applies_to") return { ...i, path: ["audience"] };
        if (head === "rules") return { ...i, path: [String(sub ?? "rules")] };
        return i;
      });
      return { success: false, error: { issues } };
    },
  };
}

function useDepartments(): Array<[string, string]> {
  const d = useApi("GET /api/v1/departments", { query: {} });
  return (d.data?.data ?? []).map((x) => [x.department_id, x.name]);
}

export function DraftEditor({ p }: { p: Policy }) {
  const confirm = useConfirm();
  const modal = useModal();
  const save = useMutation("PUT /api/v1/policies/:id/draft");
  const discard = useMutation("POST /api/v1/policies/:id/draft/discard");
  const tidy = useMutation("POST /api/v1/policies/tidy");
  const departments = useDepartments();
  const f = useContractForm<Values>(valuesOf(p), draftSchema(p));
  const v = f.values;
  const attendance = p.kind === "attendance";
  const editable = p.can_edit && !p.submission;
  const newest = (p.waiting ?? p.in_force)?.rules ?? null;

  const submit = async () => {
    try {
      await save.run({ params: { id: p.policy_id }, body: bodyOf(p, v) });
      invalidate("/api/v1/policies");
      toast("Draft saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Draft not saved");
    }
  };
  const drop = async () => {
    if (!(await confirm({ title: "Discard Changes", body: "The draft's changes are lost.", confirmLabel: "Discard Changes", destructive: true }))) return;
    try {
      await discard.run({ params: { id: p.policy_id }, body: {} });
      invalidate("/api/v1/policies");
      toast("Draft discarded");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Draft not discarded");
    }
  };
  const tidyText = async () => {
    try {
      const out = await tidy.run({ body: { body_html: v.body_html } });
      modal.open({
        title: "Tidied Text",
        wide: true,
        full: true,
        body: (close) => <TidyCompare before={v.body_html} after={out.body_html} keep={close} use={() => {
              f.set("body_html", out.body_html);
              close();
            }} />,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Tidy With AI is unavailable");
    }
  };

  /** A rule's label, tagged when the draft changes it against the newest version. */
  const label = (rule: VisibleRule) => {
    const now = isNumberRule(rule) ? asNumber(v[rule]) : v[rule];
    const changed = newest ? String(newest[rule]) !== String(now) : false;
    return (
      <>
        {RULE_LABEL[rule]}
        {changed && <Pill tone="warn" className="ml-1.5">Changed</Pill>}
      </>
    );
  };
  const ruleField = (rule: VisibleRule) =>
    isNumberRule(rule) ? (
      <Field key={rule} label={label(rule)} help={RULE_HELP[rule]} {...f.status(rule)}>
        <NumberField {...f.field(rule)} disabled={!editable} className="w-28" />
      </Field>
    ) : (
      <Field key={rule} label={label(rule)} help={RULE_HELP[rule]} {...f.status(rule)}>
        <ChoiceField
          label={RULE_LABEL[rule]}
          value={v[rule]}
          onChange={(m) => f.set(rule, m)}
          options={MODES_FOR[rule].map((m) => [m, MODE_LABEL[m]] as [PolicyMode, string])}
          disabled={editable ? [] : MODES_FOR[rule]}
        />
      </Field>
    );

  return (
    <Form onSubmit={f.submit(submit)}>
      <Card className="mb-3">
        <CardHeader title="Policy Settings" help="Needs Approval sends each version through the Policy Approval route on Settings, Approvals; every approver signs before it can start." />
        {!attendance && (
          <Field label="Title" {...f.status("title")}>
            <TextField {...f.field("title")} disabled={!editable} />
          </Field>
        )}
        {!attendance && (
          <Field label="Applies To" help="Only these people are asked to acknowledge it, and only they see it on Policy Updates." {...f.status("audience")}>
            <ChoiceField
              label="Applies To"
              value={v.audience}
              onChange={(a) => f.set("audience", a)}
              options={[["everyone", "Everyone"], ["some", "Some People"]]}
              disabled={editable ? [] : ["everyone", "some"]}
            />
          </Field>
        )}
        {!attendance && v.audience === "some" && (
          <>
            <Field label="Departments" optional>
              <Chips label="Departments" options={departments} selected={v.department_ids} onSelectedChange={(ids) => f.set("department_ids", ids)} />
            </Field>
            <Field label="Work Patterns" optional>
              <Chips
                label="Work Patterns"
                options={(Object.keys(PATTERN_LABEL) as WorkPattern[]).map((w) => [w, PATTERN_LABEL[w]] as [WorkPattern, string])}
                selected={v.work_patterns}
                onSelectedChange={(w) => f.set("work_patterns", w)}
              />
            </Field>
            <Field label="People" optional>
              <EmployeePicker multiple value={v.people} onChange={(people) => f.set("people", people)} placeholder="Add people" />
            </Field>
          </>
        )}
        <CheckboxField label="Needs Acknowledgement" value={v.needs_acknowledgement} onChange={(x) => f.set("needs_acknowledgement", x)} disabled={!editable} />
        {v.needs_acknowledgement && (
          <Field label="Acknowledge Within" help="Days after it is published. Until then staff may choose Later." {...f.status("acknowledge_within_days")}>
            <NumberField {...f.field("acknowledge_within_days")} disabled={!editable} className="w-28" />
          </Field>
        )}
        <CheckboxField label="Needs Approval" value={v.needs_approval} onChange={(x) => f.set("needs_approval", x)} disabled={!editable} />
      </Card>

      {attendance ? (
        <Grid cols={2}>
          {WORKSHEET.map((card) => (
            <Card key={card.title}>
              <CardHeader title={card.title} />
              {card.rules.map(ruleField)}
            </Card>
          ))}
        </Grid>
      ) : (
        <Card>
          <CardHeader
            title="Policy Text"
            help="Paste or type it as it is. Tidy With AI suggests headings and lists without changing a word."
            right={
              editable && (
                <Button size="sm" icon="spark" onClick={tidyText}>
                  Tidy With AI
                </Button>
              )
            }
          />
          <Field label="Policy Text" {...f.status("body_html")}>
            <RichTextField label="Policy Text" {...f.field("body_html")} readOnly={!editable} />
          </Field>
        </Card>
      )}

      {editable && (
        <FormFooter>
          {p.draft && <Button onClick={drop}>Discard Changes</Button>}
          <Button variant="primary" type="submit">
            Save Draft
          </Button>
        </FormFooter>
      )}
    </Form>
  );
}

/** The text as it is beside the tidied suggestion: Use Tidied Text replaces it, Keep Mine leaves it. */
function TidyCompare({ before, after, keep, use }: { before: string; after: string; keep: () => void; use: () => void }) {
  return (
    <>
      <Grid cols={2}>
        <Field label="Yours">
          <RichTextField label="Yours" value={before} onChange={() => undefined} readOnly />
        </Field>
        <Field label="Tidied">
          <RichTextField label="Tidied" value={after} onChange={() => undefined} readOnly />
        </Field>
      </Grid>
      <FormFooter>
        <Button onClick={keep}>Keep Mine</Button>
        <Button variant="primary" onClick={use}>
          Use Tidied Text
        </Button>
      </FormFooter>
    </>
  );
}

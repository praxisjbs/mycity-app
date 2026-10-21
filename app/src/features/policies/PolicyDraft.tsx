import policies from "@mycity/contract/schemas/policies.js";
import type { AttendanceRules, Policy, PolicyDraftSave, PolicyMode, WorkPattern } from "@mycity/contract/contract.gen.ts";
import type { PersonRef } from "@/api/types/common";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { EmployeePicker } from "@/features/shared/pickers";
import {
  Button,
  Card,
  CardHeader,
  CheckboxField,
  ChoiceField,
  Chips,
  EmptyValue,
  Field,
  Form,
  FormFooter,
  FormRow,
  Grid,
  Money,
  MoneyField,
  NumberField,
  Pill,
  RichTextField,
  TextField,
  TimeField,
  toMoneyString,
  toast,
  useConfirm,
  useContractForm,
  useModal,
  type ContractSchema,
  type FieldBinding,
} from "@mycity/ui";
import {
  APPROVAL_LABEL,
  COUNT_RULES,
  DEDUCTION_RULES,
  HOURS_RULES,
  METHOD_LABEL,
  MODE_LABEL,
  MODES_FOR,
  NUMBER_RULES,
  OVERTIME_METHOD_LABEL,
  PATTERN_LABEL,
  PERIOD_LABEL,
  RULE_HELP,
  RULE_LABEL,
  WEEKDAY_LABEL,
  WORKSHEET,
  type CountRule,
  type DeductionRule,
  type ModeRule,
  type NumberRule,
  type VisibleRule,
} from "./labels";
import { fieldOfRulePath, ruleChanged, worksheetRules, worksheetValues } from "./worksheet";

/**
 * A policy's draft on Knowledge Hub · Policies (docs/guides/policies.md §6.2, §6.6): Policy Settings
 * (title, Applies To, acknowledgement, approval), then the editor with Tidy With AI for a document,
 * or the Attendance worksheet (attendance.md §6.15): a card per section, a row per rule, a switch
 * that is on opening its figures beneath it. Save Draft keeps every field; nobody is told. The
 * Attendance policy applies to everyone, so its title and Applies To are fixed.
 */

type Settings = {
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
};
/** The settings, and the worksheet's own values (worksheet.ts), one per control. */
type Values = Settings & { [key: string]: unknown };

const isNumberRule = (r: VisibleRule): r is NumberRule => (NUMBER_RULES as readonly string[]).includes(r);
const isCountRule = (r: VisibleRule): r is CountRule => (COUNT_RULES as readonly string[]).includes(r);
const isDeductionRule = (r: VisibleRule): r is DeductionRule => (DEDUCTION_RULES as readonly string[]).includes(r);
const isModeRule = (r: VisibleRule): r is ModeRule => r.endsWith("_mode");
const asNumber = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
const PERIODS = Object.entries(PERIOD_LABEL) as Array<[keyof typeof PERIOD_LABEL, string]>;

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
    ...(rules ? worksheetValues(rules) : {}),
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
  return { ...settings, rules: worksheetRules(v.rules as AttendanceRules, v as Record<string, string | boolean>) };
}

/** The contract's draft schema over the form: its marks land on the field that holds each value. */
function draftSchema(p: Policy): ContractSchema {
  return {
    safeParse: (value: unknown) => {
      const r = policies.PolicyDraftSave.safeParse(bodyOf(p, value as Values));
      if (r.success) return r;
      const issues = (r.error?.issues ?? []).map((i) => {
        const [head, ...rest] = i.path;
        if (head === "applies_to") return { ...i, path: ["audience"] };
        if (head === "rules") return { ...i, path: [rest.length ? fieldOfRulePath(rest) : "rules"] };
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

  const now = attendance && v.rules ? worksheetRules(v.rules, v as Record<string, string | boolean>) : null;
  /** A rule's label, tagged when the draft changes it against the newest version. */
  const label = (rule: VisibleRule) => (
    <>
      {RULE_LABEL[rule]}
      {now && ruleChanged(rule, newest, now) && <Pill tone="warn" className="ml-1.5">Changed</Pill>}
    </>
  );
  /** A worksheet value's binding: the form keeps one flat value per control (worksheet.ts). */
  const text = (key: string) => f.field(key) as FieldBinding<string> & { name: string };
  const flag = (key: string) => v[key] === true;
  const tick = (key: string, words: string) => (
    <CheckboxField key={key} label={words} value={flag(key)} onChange={(x) => f.set(key, x)} disabled={!editable} />
  );
  const number = (key: string, words: string, { decimal = false, optional = false } = {}) => (
    <Field key={key} label={words} optional={optional} {...f.status(key)}>
      <NumberField {...text(key)} decimal={decimal} disabled={!editable} className="w-28" />
    </Field>
  );
  const choice = <O extends string>(key: string, words: string, options: Array<[O, string]>) => (
    <Field key={key} label={words} {...f.status(key)}>
      <ChoiceField
        label={words}
        value={String(v[key]) as O}
        onChange={(x) => f.set(key, x)}
        options={options}
        disabled={editable ? [] : options.map(([o]) => o)}
      />
    </Field>
  );
  const money = (key: string, words: string) => (
    <Field key={key} label={words} {...f.status(key)}>
      {editable ? <MoneyField {...text(key)} /> : <Money value={String(v[key] ?? "") ? toMoneyString(String(v[key])) : null} />}
    </Field>
  );
  const time = (key: string, words: string) => (
    <Field key={key} label={words} {...f.status(key)}>
      {editable ? <TimeField {...text(key)} /> : String(v[key] ?? "") ? <span className="tabular-nums">{String(v[key])}</span> : <EmptyValue />}
    </Field>
  );

  /** One rule's row: its label and help, its control, and a switch's figures when it is on. */
  const ruleField = (rule: VisibleRule) => {
    if (isNumberRule(rule))
      return (
        <Field key={rule} label={label(rule)} help={RULE_HELP[rule]} {...f.status(rule)}>
          <NumberField {...text(rule)} disabled={!editable} className="w-28" />
        </Field>
      );
    if (isModeRule(rule))
      return (
        <Field key={rule} label={label(rule)} help={RULE_HELP[rule]} {...f.status(rule)}>
          <ChoiceField
            label={RULE_LABEL[rule]}
            value={v[rule] as PolicyMode}
            onChange={(m) => f.set(rule, m)}
            options={MODES_FOR[rule].map((m) => [m, MODE_LABEL[m]] as [PolicyMode, string])}
            disabled={editable ? [] : MODES_FOR[rule]}
          />
        </Field>
      );
    if (rule === "hours")
      return (
        <div key={rule}>
          <Field label={label(rule)} help={RULE_HELP.hours} {...f.status("hours_on")}>
            {tick("hours_on", "Set Company Hours")}
          </Field>
          {flag("hours_on") &&
            WEEKDAY_LABEL.map((day, i) => (
              <FormRow key={day}>
                <Field label={day} {...f.status(`hours_${i}_working`)}>
                  {tick(`hours_${i}_working`, "Working")}
                </Field>
                {flag(`hours_${i}_working`) && (
                  <Grid cols={2}>
                    {time(`hours_${i}_starts_at`, "Starts")}
                    {time(`hours_${i}_ends_at`, "Ends")}
                  </Grid>
                )}
              </FormRow>
            ))}
        </div>
      );
    if (isCountRule(rule))
      return (
        <div key={rule}>
          <Field label={label(rule)} help={RULE_HELP[rule]} {...f.status(`${rule}_on`)}>
            {tick(`${rule}_on`, "On")}
          </Field>
          {flag(`${rule}_on`) && (
            <>
              <FormRow>
                {number(`${rule}_count`, "Count")}
                {(HOURS_RULES as readonly string[]).includes(rule) && number(`${rule}_hours`, "Or Hours", { decimal: true, optional: true })}
              </FormRow>
              {choice(`${rule}_period`, "Period", PERIODS)}
              {tick(`${rule}_alert`, "Alert")}
              {tick(`${rule}_query`, "Raise Query")}
            </>
          )}
        </div>
      );
    if (isDeductionRule(rule))
      return (
        <div key={rule}>
          <Field label={label(rule)} help={RULE_HELP[rule]} {...f.status(`${rule}_on`)}>
            {tick(`${rule}_on`, "On")}
          </Field>
          {flag(`${rule}_on`) && (
            <>
              {choice(`${rule}_method`, "Method", Object.entries(METHOD_LABEL) as Array<[string, string]>)}
              {v[`${rule}_method`] !== "pro_rata" && money(`${rule}_amount`, "Amount")}
            </>
          )}
        </div>
      );
    if (rule === "absence_deduction")
      return (
        <Field key={rule} label={label(rule)} help={RULE_HELP[rule]} {...f.status("absence_deduction_on")}>
          {tick("absence_deduction_on", "On")}
        </Field>
      );
    return (
      <div key={rule}>
        <Field label={label(rule)} help={RULE_HELP.overtime} {...f.status("overtime_on")}>
          {tick("overtime_on", "On")}
        </Field>
        {flag("overtime_on") && (
          <>
            {number("overtime_after_minutes", "After Minutes")}
            {choice("overtime_approval", "Approval", Object.entries(APPROVAL_LABEL) as Array<[string, string]>)}
            {choice("overtime_method", "Paid As", Object.entries(OVERTIME_METHOD_LABEL) as Array<[string, string]>)}
            <FormRow>
              {v.overtime_method === "per_hour" ? money("overtime_amount", "Amount an Hour") : number("overtime_multiplier", "Multiple", { decimal: true })}
              {number("overtime_rest_day_multiplier", "Rest Day Multiple", { decimal: true })}
            </FormRow>
            {number("overtime_monthly_cap_hours", "Monthly Cap Hours")}
          </>
        )}
      </div>
    );
  };

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

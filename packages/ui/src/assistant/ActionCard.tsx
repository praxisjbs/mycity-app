/**
 * @component ActionCard
 * @group Assistant
 * @summary An action Praxis AI drafted for the person to confirm: every field as the action will receive it, the records it touches named and linked, problems on their fields, and the buttons (the verb with the count, Edit, Cancel); busy while it runs, the result line under it, Draw It Again once it has expired.
 * @use Inside an answer (AnswerBubble's card slot) when the answer carries a card (docs/guides/praxis-ai.md §6.11): the screen passes the card as the API drew it, the action's contract schema for Edit, and what each press does. A suggested card reads as a question with the verb and Not Now.
 * @avoid A form the person fills from empty (the screen's own form); a confirmation dialog (useConfirm); an answer's screen button (AnswerBubble's link); a list of records to browse (DataView).
 * @phone Full width inside the answer; the buttons are 44 px targets with the verb full width at the foot; Edit's fields are one column; the result's Open buttons are 44 px.
 * @a11y A group named by the card's title; the fields are a description list, and in Edit the form system's own fields with their labels and marks; the verb says aria-busy while the press runs and the buttons beside it wait (ActionGroup); the result line is a status; a refusal is an alert.
 * @status beta
 * @example <ActionCard label="Approve Leave" fields={fields} values={values} records={records} problems={{}} status="shown" confirm="fresh_sign_in" onConfirm={press} onCancel={cancel} onSave={save} schema={schemas.leave.LeaveApprove} />
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { content, slot } from "../lib/slots";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import { ActionGroup } from "../actions/ActionGroup";
import { Button } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { KeyValue } from "../display/KeyValue";
import { Pill } from "../display/Pill";
import { Field } from "../form/Field";
import { Form, FormFooter } from "../form/Form";
import { useContractForm, type ContractSchema } from "../form/useContractForm";
import { TextAreaField, TextField, NumberField } from "../form/TextField";
import { DateField, TimeField } from "../form/DateField";
import { MoneyField } from "../form/MoneyField";
import { ChoiceField, SelectField } from "../form/SelectField";
import { CheckboxField } from "../form/Switch";
import { ResultLine, type CardResult } from "./ResultLine";

/** One field of the card, as the action's schema takes it (AiCardField). */
export interface CardField {
  name: string;
  label: string;
  kind: "text" | "number" | "boolean" | "date" | "datetime" | "money" | "choice" | "list" | "id" | "other";
  required: boolean;
  options: string[] | null;
  /** A text of several lines (a message, a note, a reason). */
  long: boolean;
}

/** A record the card touches, named and linked (AiCardRecord). */
export interface CardRecord {
  type: string;
  id: string;
  label: string;
  link: string | null;
}

/** Where the card stands (AiCardStatus). */
export type CardStatus = "shown" | "confirmed" | "done" | "failed" | "cancelled" | "expired";

export interface ActionCardProps {
  /** The card's button, Verb Noun (the action's label). */
  label: string;
  /** The fields the action takes. */
  fields: CardField[];
  /** The values as the action will receive them. */
  values: Record<string, unknown>;
  /** Problems the person must fix, by field. */
  problems: Record<string, string[]>;
  /** The records the card touches. */
  records: CardRecord[];
  /** Where the card stands: open (shown), running, done, failed, cancelled or expired. */
  status: CardStatus;
  /** `fresh_sign_in`: the press asks Confirm It's You first; the verb carries a lock. */
  confirm: "press" | "fresh_sign_in";
  /** Offered unasked: the title reads as a question, and Cancel reads Not Now. */
  suggested?: boolean;
  /** What the press came back with, once it has. */
  result?: CardResult | null;
  /** The action's contract schema, for Edit's fields; without it Edit is left out. */
  schema?: ContractSchema;
  /** The press: the verb. Hand back the work and the card is busy until it settles. */
  onConfirm?: () => Promise<unknown> | void;
  /** Cancel, or Not Now on a suggested card. */
  onCancel?: () => Promise<unknown> | void;
  /** Edit's Save Changes, with the values as edited; the parent re-validates them with the API. */
  onSave?: (values: Record<string, unknown>) => Promise<unknown> | void;
  /** Draw It Again on an expired card: the question is asked again. */
  onRedraw?: () => Promise<unknown> | void;
  /** Opens a record's screen. */
  onOpen?: (path: string) => void;
  /** Why the last press was refused, in the server's words. */
  problem?: string | null;
  /** A button beside the refusal, where a screen answers it (Open Mailbox). */
  problemAction?: { label: string; onPress: () => void } | null;
  /** Layout classes only (spacing). */
  className?: string;
}

const LAGOS = "Africa/Lagos";
/** "request_changes" reads Request Changes; "in_progress" reads In Progress. */
export const wordsOf = (value: string) =>
  String(value)
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
const dayOf = (iso: unknown) => (typeof iso === "string" && iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: LAGOS }) : "");
const clockOf = (iso: unknown) => (typeof iso === "string" && iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24/, "00") : "");
/** A Lagos day and clock as the instant the action takes, with Lagos's offset. */
export const instantOf = (day: string, clock: string) => (day && clock ? `${day}T${clock}:00+01:00` : "");
const asString = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));
const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * The verb the primary button shows: the action's label, or the decision a `decision` choice holds
 * (Approve, Reject, Request Changes), with the count of records when the card touches several.
 */
export function verbOf(label: string, fields: CardField[], values: Record<string, unknown>, count: number): string {
  const decision = fields.find((f) => f.name === "decision" && f.kind === "choice");
  const base = decision && typeof values.decision === "string" && values.decision ? wordsOf(values.decision) : label;
  return count > 1 ? `${base} ×${count}` : base;
}

/** A value as the person reads it, from the field's kind; the records name an id. */
function shown(f: CardField, value: unknown, records: CardRecord[]): string | null {
  if (isBlank(value)) return null;
  const nameOf = (id: unknown) => records.find((r) => r.id === String(id))?.label ?? asString(id);
  switch (f.kind) {
    case "id":
      return nameOf(value);
    case "list":
      return Array.isArray(value) ? value.map((v) => (typeof v === "string" && records.some((r) => r.id === v) ? nameOf(v) : asString(v))).join(", ") : asString(value);
    case "date":
      return formatDate(asString(value));
    case "datetime":
      return formatDateTime(asString(value));
    case "money":
      return formatMoney(asString(value));
    case "boolean":
      return value ? "Yes" : "No";
    case "choice":
      return wordsOf(asString(value));
    default:
      return asString(value);
  }
}

/** Fields the card lists: those with a value, those with a problem, and the required ones. */
const listed = (fields: CardField[], values: Record<string, unknown>, problems: Record<string, string[]>) => fields.filter((f) => !isBlank(values[f.name]) || problems[f.name]?.length || f.required);

const idsOf = (f: CardField) => f.kind === "id" || (f.kind === "list" && /_ids?$/.test(f.name));

export function ActionCard({ label, fields, values, problems, records, status, confirm, suggested = false, result = null, schema, onConfirm, onCancel, onSave, onRedraw, onOpen, problem = null, problemAction = null, className }: ActionCardProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (status !== "shown") setEditing(false);
  }, [status]);
  const count = records.length;
  const title = suggested ? `${label}?` : label;
  const verb = verbOf(label, fields, values, count);
  const open = status === "shown";
  const problemOn = (name: string) => problems[name]?.[0];

  return (
    <div role="group" aria-label={title} className={cn("flex flex-col gap-2.5 rounded-box border border-border bg-background p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="spark" size="s" className="text-secondary" />
        <span {...slot("title")} className="text-sm font-strong">
          {title}
        </span>
        {status === "done" && <Pill tone="ok">Done</Pill>}
        {status === "failed" && <Pill tone="err">Failed</Pill>}
        {status === "cancelled" && <Pill tone="neutral">Cancelled</Pill>}
        {status === "expired" && <Pill tone="warn">Expired</Pill>}
        {status === "confirmed" && <Pill tone="info">Running</Pill>}
      </div>
      {editing && schema ? (
        <EditFields fields={fields} values={values} problems={problems} records={records} schema={schema} onSave={onSave} onDone={() => setEditing(false)} />
      ) : (
        <>
          <KeyValue
            layout="stacked"
            items={listed(fields, values, problems).map((f) => {
              const value = shown(f, values[f.name], records);
              const bad = problemOn(f.name);
              return {
                key: f.name,
                label: f.label,
                value: (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {value !== null && (
                      <span {...content} className="whitespace-pre-line wrap-any">
                        {value}
                      </span>
                    )}
                    {bad && (
                      <span className="text-xs text-destructive">
                        <Icon name="alert" size="s" className="mr-0.5 inline" />
                        {bad}
                      </span>
                    )}
                  </span>
                ),
              };
            })}
          />
          {records.length > 0 && !(result && (status === "done" || status === "failed")) && (
            <ul aria-label="Records" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {records.map((r) => (
                <li key={`${r.type}:${r.id}`} {...content}>
                  {r.link && onOpen ? (
                    <Button size="sm" variant="ghost" iconRight="right" onClick={() => onOpen(r.link!)}>
                      {r.label}
                    </Button>
                  ) : (
                    <Pill tone="neutral">{r.label}</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {problem && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <Icon name="alert" size="s" />
          <span {...content}>{problem}</span>
          {problemAction && (
            <Button size="sm" onClick={problemAction.onPress}>
              {problemAction.label}
            </Button>
          )}
        </p>
      )}
      {result && (status === "done" || status === "failed") && <ResultLine result={result} onOpen={onOpen} />}
      {status === "expired" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle-foreground">This card has expired.</span>
          {onRedraw && (
            <Button size="sm" onClick={onRedraw}>
              Draw It Again
            </Button>
          )}
        </div>
      )}
      {open && !editing && (
        <div className="flex flex-wrap items-center gap-1.5 phone:flex-col-reverse phone:items-stretch">
          <ActionGroup>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                {suggested ? "Not Now" : "Cancel"}
              </Button>
            )}
            {schema && onSave && (
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {onConfirm && (
              <Button variant="primary" icon={confirm === "fresh_sign_in" ? "lock" : undefined} className="phone:w-full" onClick={onConfirm}>
                {verb}
              </Button>
            )}
          </ActionGroup>
        </div>
      )}
    </div>
  );
}

/** Edit: the fields as the form system draws them, from the action's own schema; the records it names stay as they are. */
function EditFields({ fields, values, problems, records, schema, onSave, onDone }: { fields: CardField[]; values: Record<string, unknown>; problems: Record<string, string[]>; records: CardRecord[]; schema: ContractSchema; onSave?: (values: Record<string, unknown>) => Promise<unknown> | void; onDone: () => void }) {
  const f = useContractForm<Record<string, unknown>>({ ...values }, schema);
  const { setServerErrors } = f;
  useEffect(() => {
    if (Object.keys(problems).length) setServerErrors(problems);
    // The card's problems, once, as the fields open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async () => {
    if (!f.check()) return;
    await onSave?.(f.values);
    onDone();
  };
  return (
    <Form onSubmit={save}>
      {fields.map((field) => {
        const b = f.field(field.name);
        const status = f.status(field.name);
        if (idsOf(field)) {
          const value = shown(field, values[field.name], records);
          return value === null ? null : (
            <Field key={field.name} label={field.label} {...status}>
              <TextField {...b} value={value} disabled />
            </Field>
          );
        }
        const optional = !field.required;
        switch (field.kind) {
          case "boolean":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <CheckboxField value={Boolean(b.value)} onChange={b.onChange} onBlur={b.onBlur} label={field.label} />
              </Field>
            );
          case "date":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <DateField value={asString(b.value)} onChange={b.onChange} onBlur={b.onBlur} onProblem={b.onProblem} name={field.name} />
              </Field>
            );
          case "datetime":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <span className="flex flex-wrap gap-1.5">
                  <DateField value={dayOf(b.value)} onChange={(day) => b.onChange(instantOf(day, clockOf(b.value) || "09:00"))} onBlur={b.onBlur} name={field.name} />
                  <TimeField value={clockOf(b.value)} onChange={(clock) => b.onChange(instantOf(dayOf(b.value), clock))} onBlur={b.onBlur} />
                </span>
              </Field>
            );
          case "money":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <MoneyField value={asString(b.value)} onChange={b.onChange} onBlur={b.onBlur} onProblem={b.onProblem} name={field.name} />
              </Field>
            );
          case "number":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <NumberField {...b} value={asString(b.value)} />
              </Field>
            );
          case "choice": {
            const options = (field.options ?? []).map((o) => [o, wordsOf(o)] as const);
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                {options.length <= 5 ? <ChoiceField value={asString(b.value)} onChange={b.onChange} onBlur={b.onBlur} options={options} /> : <SelectField value={asString(b.value)} onChange={b.onChange} onBlur={b.onBlur} options={options} placeholder="Choose One" />}
              </Field>
            );
          }
          case "list":
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                <TextField
                  {...b}
                  value={Array.isArray(b.value) ? b.value.map(asString).join(", ") : asString(b.value)}
                  onChange={(text: string) =>
                    b.onChange(
                      text
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            );
          default:
            return (
              <Field key={field.name} label={field.label} optional={optional} {...status}>
                {field.long ? <TextAreaField {...b} value={asString(b.value)} rows={5} /> : <TextField {...b} value={asString(b.value)} />}
              </Field>
            );
        }
      })}
      <FormFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Changes
        </Button>
      </FormFooter>
    </Form>
  );
}

import interactions from "@mycity/contract/schemas/interactions.js";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, DateField, Field, FormFooter, SelectField, TextAreaField, TextField, TimeField, toast, todayIso, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/** When something happened, from the day and time a person picks, as the API reads it (Lagos). */
const instant = (day: string, time: string) => (day && time ? new Date(`${day}T${time}:00+01:00`).toISOString() : "");
const nowTime = () => new Date(Date.now() + 3600000).toISOString().slice(11, 16);

/**
 * Log Interaction (docs/guides/partnerships.md §6.12): a call, meeting, email, visit or note with a lead
 * or a partner, on one of its deals; never ahead of now. Checked by InteractionCreate, the same request
 * Praxis AI's card sends.
 */
export function LogInteraction({ record, dealId, close }: { record: { type: "lead" | "partner"; id: string }; dealId?: string | null; close: () => void }) {
  const day = todayIso();
  const time = nowTime();
  const f = useContractForm(
    {
      ...(record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id }),
      ...(dealId ? { deal_id: dealId } : {}),
      interaction_type: "call" as "call" | "meeting" | "email" | "visit" | "note",
      occurred_at: instant(day, time),
      subject: "",
      summary: "",
      day,
      time,
    },
    interactions.InteractionCreate,
  );
  const save = useMutation("POST /api/v1/partnerships/interactions");
  const when = (d: string, t: string) => {
    f.set("day", d);
    f.set("time", t);
    f.set("occurred_at", instant(d, t));
  };
  const submit = async () => {
    if (!f.check()) return;
    const { day: _d, time: _t, ...body } = f.values;
    try {
      await save.run({ body: { ...body, subject: body.subject.trim(), summary: body.summary.trim() } as never });
      invalidate("/api/v1/partnerships");
      close();
      toast("Interaction logged");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Kind" {...f.status("interaction_type")}>
        <SelectField
          value={f.values.interaction_type}
          onChange={(v: string) => f.set("interaction_type", v as typeof f.values.interaction_type)}
          options={[["call", "Call"], ["meeting", "Meeting"], ["email", "Email"], ["visit", "Visit"], ["note", "Note"]]}
        />
      </Field>
      <Field label="Day" {...f.status("occurred_at")}><DateField value={f.values.day} onChange={(d: string) => when(d, f.values.time)} max={day} /></Field>
      <Field label="Time" {...f.status("occurred_at")}><TimeField value={f.values.time} onChange={(t: string) => when(f.values.day, t)} /></Field>
      <Field label="Subject" {...f.status("subject")}><TextField {...f.field("subject")} placeholder="Kick-off call" /></Field>
      <Field label="Summary" {...f.status("summary")}><TextAreaField {...f.field("summary")} placeholder="Agreed the dates" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Log Interaction</Button>
      </FormFooter>
    </>
  );
}

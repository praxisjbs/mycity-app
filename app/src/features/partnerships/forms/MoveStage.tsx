import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import { Button, Field, FormFooter, SelectField, TextAreaField, toast, useContractForm } from "@mycity/ui";
import { fail, opts } from "../lib";

/** Move Stage, on the mock until M7 PR 3 brings the stage switcher. */
export function MoveStage({ id, current, close }: { id: string; current: string; close: () => void }) {
  const stages = useApi("GET /api/v1/partnerships/stages");
  const f = useContractForm(
    { stage: current, reason: "" },
    { stage: (v) => (v === current ? "Pick another stage" : null), reason: (v, all) => (all.stage === "On hold" && !v.trim() ? "Give a reason" : null) },
  );
  const { stage, reason } = f.values;
  const move = useMutation("POST /api/v1/partnerships/partners/:id/stage");
  const go = async () => {
    if (!f.check()) return;
    try {
      await move.run({ params: { id }, body: { stage, ...(reason.trim() && { reason: reason.trim() }) } });
      invalidate("/api/v1/partnerships");
      close();
      toast(`Moved to ${stage}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) toast(Object.values(e.fields)[0][0]);
      else fail(e);
    }
  };
  return (
    <>
      <Field label="Stage" {...f.field("stage")}><SelectField {...f.field("stage")} options={opts(stages.data ?? [current])} /></Field>
      <Field label={stage === "On hold" ? "Why It Is on Hold" : "Note (Optional)"} {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Duplicate entry" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={move.pending} onClick={go}>Move</Button>
      </FormFooter>
    </>
  );
}

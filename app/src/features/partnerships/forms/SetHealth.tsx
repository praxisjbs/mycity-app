import type { DealDetail } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, ChoiceField, Field, FormFooter, TextAreaField, toast, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/** Set Health (docs/guides/partnerships.md §6.5): On Track, Follow-Up Required or Stalled; Stalled needs its blockers. */
export function SetHealth({ deal, close }: { deal: Pick<DealDetail, "deal_id" | "health" | "blockers">; close: () => void }) {
  const f = useContractForm({ health: deal.health, blockers: deal.blockers ?? "" }, pipeline.HealthSet);
  const set = useMutation("POST /api/v1/partnerships/deals/:id/health");
  const save = async () => {
    if (!f.check()) return;
    try {
      await set.run({ params: { id: deal.deal_id }, body: { health: f.values.health, ...(f.values.blockers.trim() && { blockers: f.values.blockers.trim() }) } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Health set");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Health" {...f.status("health")}>
        <ChoiceField {...f.field("health")} options={[["on_track", "On Track"], ["follow_up_required", "Follow-Up Required"], ["stalled", "Stalled"]]} />
      </Field>
      {f.values.health === "stalled" && <Field label="Blockers" {...f.status("blockers")}><TextAreaField {...f.field("blockers")} placeholder="Waiting on legal" /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>Set Health</Button>
      </FormFooter>
    </>
  );
}

import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, CardPicker, ErrorState, Grow, LoadingRows, ModalFooter, toast, useModal, useUnsavedChanges } from "@mycity/ui";

/**
 * Choose Cards (docs/guides/home.md §3 step 4, §10.1, §10.2): the cards a person puts on their
 * Overview. GET /home/kpi-picker offers only the cards they may see, their own pick, and the
 * cards their roles lock; the picker (CardPicker in @mycity/ui) keeps a draft, never a write
 * per tick. Save Cards writes the draft (PUT /home/kpi-picks), and the server keeps the roles'
 * own cards restated in their order as "follow my roles". Use Role Default goes back to the
 * roles' cards (DELETE /home/kpi-picks). Either way the Overview is read again.
 *
 * A dialog on desktop and a bottom sheet on a phone, with Save Cards full width at its foot.
 */
export function useKpiPicker() {
  const modal = useModal();
  return useCallback(() => modal.open({ title: "Choose Cards", body: (close) => <KpiPickerDialog close={close} /> }), [modal]);
}

const sameCards = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

const done = () => invalidate("/api/v1/home/overview", "/api/v1/home/kpi-picker");

function KpiPickerDialog({ close }: { close: () => void }) {
  const picker = useApi("GET /api/v1/home/kpi-picker");
  const save = useMutation("PUT /api/v1/home/kpi-picks");
  const reset = useMutation("DELETE /api/v1/home/kpi-picks");
  /* The person's draft; null until they first change it, so it starts from the latest read each time the dialog opens. */
  const [draft, setDraft] = useState<string[] | null>(null);
  /*
   * It starts from the cards the Overview shows, never the stored pick: a role may have locked a
   * card since the pick was saved, and the cards showing lead with every lock, so saving them
   * unchanged is accepted. With no pick they are the roles' own, which saves as following them.
   */
  const start = picker.data ? picker.data.showing_ids : null;
  const value = draft ?? start ?? [];
  useUnsavedChanges(draft !== null && start !== null && !sameCards(draft, start));

  if (picker.error) return <ErrorState error={picker.error} onRetry={picker.reload} />;
  if (!picker.data) return <LoadingRows count={6} />;
  const p = picker.data;

  const saveCards = async () => {
    try {
      await save.run({ body: { kpi_ids: value } });
      done();
      close();
    } catch (e) {
      // A refusal ("Pick cards you can see") means the list changed under the person: show it as it is now.
      toast.error(e instanceof ApiError ? e.message : "Cards not saved. Try again.");
      if (e instanceof ApiError && e.status !== 0) {
        setDraft(null);
        void picker.reload();
      }
    }
  };
  const followRoles = async () => {
    try {
      await reset.run({});
      done();
      close();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Cards not reset. Try again.");
      if (e instanceof ApiError && e.status !== 0) void picker.reload();
    }
  };

  return (
    <>
      <CardPicker
        label="Overview Cards"
        options={p.cards.map((c) => ({ id: c.key, title: c.title, locked: p.locked_ids.includes(c.key) }))}
        value={value}
        onChange={setDraft}
        max={p.max}
      />
      <ModalFooter>
        <Button onClick={close}>Cancel</Button>
        <Grow />
        <Button busy={reset.pending} onClick={followRoles}>
          Use Role Default
        </Button>
        <Button variant="primary" busy={save.pending} onClick={saveCards}>
          Save Cards
        </Button>
      </ModalFooter>
    </>
  );
}

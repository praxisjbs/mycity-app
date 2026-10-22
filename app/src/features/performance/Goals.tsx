/**
 * Performance · Goals: the interim screen, on the in-browser mock until its pull request lands.
 * PR 2 (docs/guides/performance.md §1.2) replaces this with the OKR tree: organisational goals, the company and function objectives and key results, Report Month and Confirm Score, against the contract.
 */
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { Goal, GoalLevel } from "@/api/types/performance";
import { useAuth } from "@/auth/AuthProvider";
import { BarsCard, ExportAction, PagedTable } from "@/features/shared/sections";
import { Button, Card, Field, FormFooter, Grid, LoadingRows, PageHeader, SelectField, StatusPill, TextField, toast, useContractForm, useModal } from "@mycity/ui";

export function Goals() {
  const modal = useModal();
  const s = useApi("GET /api/v1/performance/goals/summary");
  const org = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisational" } });
  const annual = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual" } });
  return (
    <>
      <PageHeader
        title="Goals"
        sub="Organisational and annual, set by management"
        actions={
          <>
            <ExportAction source="performance.goals" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Goal", body: (close) => <GoalForm close={close} /> })}>New Goal</Button>
          </>
        }
      />
      <PagedTable<Goal>
        title="Organisational Goals 2026"
        list={org}
        rowKey={(g) => g.goal_id}
        noun="goal"
        wide
        columns={[
          { key: "code", label: "Goal ID", render: (g) => <span className="font-semibold">{g.code}</span> },
          { key: "theme", label: "Strategic Theme", render: (g) => g.theme },
          { key: "goal", label: "Goal", render: (g) => g.title },
          { key: "measure", label: "Success Measure", render: (g) => g.measure, desktop: true },
          { key: "base", label: "Baseline", render: (g) => g.baseline, desktop: true },
          { key: "owner", label: "Owner", render: (g) => g.owner },
          { key: "status", label: "Status", render: (g) => <StatusPill s={g.status} /> },
        ]}
      />
      <div className="mt-3">
        <PagedTable<Goal>
          title="Annual Goals"
          list={annual}
          rowKey={(g) => g.goal_id}
          noun="goal"
          columns={[
            { key: "goal", label: "Annual Goal", render: (g) => g.title },
            { key: "up", label: "Rolls Up To", render: (g) => g.rolls_up_to },
            { key: "owner", label: "Owner", render: (g) => g.owner, desktop: true },
            { key: "q4", label: "Q4 Cascade", render: (g) => g.cascade_note, desktop: true },
            { key: "status", label: "Status", render: (g) => <StatusPill s={g.status} /> },
          ]}
        />
      </div>
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Goal Progress" rows={s.data.progress} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function GoalForm({ close }: { close: () => void }) {
  const { me } = useAuth();
  const ceo = !!me?.is_ceo;
  const parents = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisational" } });
  const f = useContractForm({ level: ceo ? "organisational" : "annual", title: "", theme: "", measure: "", baseline: "", rolls_up_to: "" }, {
    title: (v) => (v.trim().length < 4 ? "Name the goal" : null),
    rolls_up_to: (v, all) => (all.level === "annual" && !v ? "Pick the parent goal" : null),
  });
  const save = useMutation("POST /api/v1/performance/goals");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      const g = await save.run({ body: { level: v.level as GoalLevel, title: v.title.trim(), ...(v.theme && { theme: v.theme }), ...(v.measure && { measure: v.measure }), ...(v.baseline && { baseline: v.baseline }), ...(v.level === "annual" && { rolls_up_to: v.rolls_up_to }) } });
      invalidate("/api/v1/performance/goals");
      close();
      toast(g.code ? `${g.code} added as a draft` : "Annual goal added as a draft");
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && e.status === 403) toast(e.message);
    }
  };
  return (
    <>
      <Field label="Level">
        <SelectField options={ceo ? [["organisational", "Organisational"], ["annual", "Annual"]] : [["annual", "Annual"]]} {...f.field("level")} />
      </Field>
      <Field label="Goal" {...f.field("title")}><TextField {...f.field("title")} placeholder="Operate in 12 cities" /></Field>
      {f.values.level === "organisational" ? (
        <>
          <Field label="Strategic Theme"><TextField {...f.field("theme")} placeholder="Growth, Revenue, People" /></Field>
          <Field label="Success Measure"><TextField {...f.field("measure")} placeholder="Cities live" /></Field>
          <Field label="Baseline"><TextField {...f.field("baseline")} placeholder="8" /></Field>
        </>
      ) : (
        <Field label="Rolls Up To" {...f.field("rolls_up_to")}>
          <SelectField placeholder="Organisational goal" options={parents.rows.map((g) => [g.goal_id, `${g.code} · ${g.title}`])} {...f.field("rolls_up_to")} />
        </Field>
      )}
      <p className="text-2xs text-subtle-foreground">Saved as a draft. Nothing binds until the CEO approves.</p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Goal</Button>
      </FormFooter>
    </>
  );
}

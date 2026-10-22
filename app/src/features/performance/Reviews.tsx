/**
 * Performance · Reviews: the interim screen, on the in-browser mock until its pull request lands.
 * PR 3 replaces this with the monthly round, Waiting On You, the list and a review (ReviewPage.tsx).
 */
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { ReviewRow } from "@/api/types/performance";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, KvCard, PagedTable } from "@/features/shared/sections";
import { Button, Card, CardHeader, DateField, Field, formatDate, FormFooter, Grid, IconButton, PageHeader, Quote, StatusPill, TextField, toast, useContractForm, useModal } from "@mycity/ui";
import { person } from "./shared";

export function Reviews() {
  const modal = useModal();
  const s = useApi("GET /api/v1/performance/reviews/summary");
  const list = usePaged("GET /api/v1/performance/reviews");
  return (
    <>
      <PageHeader
        title="Reviews"
        sub={s.data ? `${s.data.cycle} cycle opens ${formatDate(s.data.opens_on)}` : " "}
        actions={
          <>
            <Button icon="doc" onClick={() => modal.open({ title: "Review Form", body: <FormOutline /> })}>Review Form</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Open Cycle", body: (close) => <CycleForm close={close} /> })}>Open Cycle</Button>
          </>
        }
      />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "Cycle", value: s.data.cycle }, { label: "Opens", value: formatDate(s.data.opens_on) }, { label: "Last Cycle", value: s.data.last_cycle }, { label: "Average Rating", value: s.data.average_rating }]} />
          <ChainCard steps={s.data.chain} note="The manager cannot see the form until the employee has submitted their own rating." />
        </>
      )}
      <PagedTable<ReviewRow>
        title="Review History"
        list={list}
        search="Search people"
        rowKey={(r) => r.review_id}
        noun="review"
        columns={[
          { key: "emp", label: "Employee", render: (r) => person(r.employee) },
          { key: "c", label: "Cycle", render: (r) => r.cycle },
          { key: "self", label: "Self Rating", align: "n", render: (r) => r.self_rating ?? "Not yet" },
          { key: "mgr", label: "Manager", align: "n", render: (r) => r.manager_rating ?? "Not yet" },
          { key: "sec", label: "Second Level", render: (r) => r.second_level ?? "Not yet", desktop: true },
          { key: "s", label: "Status", render: (r) => <StatusPill s={r.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="Dictate Your Answer" right={<StatusPill s={{ tone: "info", text: "AI assisted" }} />} />
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
            <IconButton icon="spark" label="Record an answer" className="rounded-full bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" onClick={() => toast("Dictation opens when the review cycle starts")} />
            <span className="text-2xs text-subtle-foreground">Tap to record your answer to “What went well this quarter?”</span>
          </div>
          <Quote className="mt-3">“We closed the Providus sponsorship and got the Lagos venues confirmed, but I was slow on the Eko follow-up.”</Quote>
        </Card>
        <FormOutlineCard />
      </Grid>
    </>
  );
}

const OUTLINE: Array<[string, string]> = [
  ["Section 1", "Rate each of your KPIs, with a comment"],
  ["Section 2", "What went well this quarter"],
  ["Section 3", "What did not, and why"],
  ["Section 4", "What support you need"],
  ["Section 5", "Your rating out of 5"],
  ["Manager sees", "All of it, only after you submit"],
  ["Second level", "The manager’s own line manager approves"],
];
const FormOutlineCard = () => <KvCard title="Review Form" items={OUTLINE} />;
const FormOutline = () => <KvCard title="Quarterly Review" items={OUTLINE} />;

function CycleForm({ close }: { close: () => void }) {
  const f = useContractForm({ name: "", opens_on: "" }, { name: (v) => (!v.trim() ? "Name the cycle" : null), opens_on: (v) => (!v ? "Pick the opening day" : null) });
  const save = useMutation("POST /api/v1/performance/reviews/cycles");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name.trim(), opens_on: f.values.opens_on } });
      invalidate("/api/v1/performance/reviews");
      close();
      toast(`${f.values.name} opens ${formatDate(f.values.opens_on)}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Cycle" {...f.field("name")}><TextField {...f.field("name")} placeholder="Q1 2027" /></Field>
      <Field label="Opens On" {...f.field("opens_on")}><DateField {...f.field("opens_on")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Open Cycle</Button>
      </FormFooter>
    </>
  );
}

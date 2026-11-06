/**
 * Recruitment · Onboarding (M5, owner AJ; INTERIM until M5 puts it on the contract): new hires from
 * documentation to confirmation, each with the document checklist and the plan. Moved out of
 * index.tsx unchanged.
 */
import { useState } from "react";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/recruitment";
import type { OnboardingRow } from "@/api/types/recruitment";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, PagedTable } from "@/features/shared/sections";
import { toTrail } from "@/features/shared/wire";
import { Button, Card, CardHeader, cn, DataView, DetailPane, formatDate, Grid, LoadingRows, Meter, PageHeader, StatusPill, Timeline, toast, useIsPhone } from "@mycity/ui";

export function Onboarding() {
  const s = useApi("GET /api/v1/recruitment/onboarding/summary");
  const list = usePaged("GET /api/v1/recruitment/onboarding");
  const phone = useIsPhone();
  const [sel, setSel] = useState<string | null>(null);
  // On desktop the summary's focus shows unasked under the list; on a phone a new hire opens in a sheet when tapped (F31).
  const focus = sel ?? (phone ? null : (s.data?.focus_id ?? null));
  const d = useApi("GET /api/v1/recruitment/onboarding/:id", { params: { id: focus ?? "" }, enabled: !!focus });
  const remind = useMutation("POST /api/v1/recruitment/onboarding/:id/remind");
  const x = d.data;
  return (
    <>
      <PageHeader title="Onboarding" sub="Documentation first, then onboarding" />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "In Progress", value: String(s.data.in_progress) }, { label: "Blocked on Documents", value: String(s.data.blocked), tone: s.data.blocked ? "warn" : "ok" }, { label: "Starting This Month", value: String(s.data.starting_this_month) }, { label: "Confirmed, 90d", value: String(s.data.confirmed_90d), tone: "ok" }]} />
          <ChainCard steps={s.data.chain} note="Onboarding does not open until the document checklist completes. That sequence was requested by MyCity." />
        </>
      )}
      <PagedTable<OnboardingRow>
        title="In Progress"
        list={list}
        rowKey={(o) => o.onboarding_id}
        noun="new hire"
        onRowClick={(o) => setSel(o.onboarding_id)}
        columns={[
          { key: "n", label: "New Hire", render: (o) => <span className={cn(o.onboarding_id === focus && "font-semibold")}>{o.name}</span> },
          { key: "r", label: "Role", render: (o) => o.role, desktop: true },
          { key: "s", label: "Start Date", render: (o) => formatDate(o.start_date) },
          { key: "d", label: "Documents", render: (o) => `${o.documents_done} of ${o.documents_total}` },
          { key: "st", label: "Stage", render: (o) => <StatusPill s={o.stage} /> },
        ]}
      />
      <DetailPane open={sel !== null} onClose={() => setSel(null)} title="Onboarding">
        {x ? (
          <Grid cols={2} className="mt-3 phone:mt-0">
            <DataView
              title="Document Checklist"
              right={<span className="w-36"><Meter pct={Math.round((x.documents_done * 100) / x.documents_total)} label={`${x.documents_done} of ${x.documents_total}`} /></span>}
              rows={x.checklist}
              rowKey={(r) => r.name}
              columns={[{ key: "d", label: "Required Document", render: (r) => r.name }, { key: "s", label: x.name, render: (r) => <StatusPill s={r.status} /> }]}
              footer={
                x.documents_done < x.documents_total && (
                  <div className="flex justify-end border-t border-border px-3.5 py-2.5">
                    <Button size="sm" icon="bell" busy={remind.pending} onClick={async () => { await remind.run({ params: { id: x.onboarding_id }, body: {} }); toast(`Reminder sent to ${x.name} for ${x.documents_total - x.documents_done} documents`); }}>Remind {x.name.split(" ")[0]}</Button>
                  </div>
                )
              }
            />
            <Card>
              <CardHeader title="Onboarding Plan" />
              <Timeline items={toTrail(x.plan.map((p) => ({ title: p.title, when: p.text, tone: p.done ? "ok" as const : null })))} />
            </Card>
          </Grid>
        ) : (
          phone && focus && <Card><LoadingRows /></Card>
        )}
      </DetailPane>
    </>
  );
}

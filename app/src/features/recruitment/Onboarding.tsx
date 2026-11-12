/**
 * Recruitment · Onboarding (docs/guides/offers.md §2, §3 steps 5a to 8, §10; M5, owner AJ): every
 * case in the reader's scope with the figures above it, across the page; a row opens its case in the
 * wide dialog on desktop and a sheet on a phone (ListDetail `modal`, F31 as amended 11/11/2026). A
 * case is opened by the offer's acceptance, never here, so the screen has no New action.
 *
 * The address opens what ⌘K, the assistant and a notification ask for: `?case=` a case (an
 * employment contract opens its case too), `?status=` a filter, `?panel=settings` the Onboarding
 * settings.
 */
import { useEffect, useRef, useState } from "react";
import type { OnboardingRow, OnboardingStatus } from "@mycity/contract/contract.gen.ts";
import { useApi, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { Button, cn, FilterSelect, formatDate, ListDetail, PageHeader, Toolbar, useIsPhone, useModal } from "@mycity/ui";
import { CASE_STATUS, OnboardingCase } from "./OnboardingCase";
import { OnboardingSettingsPanel } from "./OnboardingSettings";
import { pill } from "./shared";

const STATUSES: Array<[string, string]> = [["", "All Statuses"], ...Object.entries(CASE_STATUS).map(([k, [, t]]) => [k, t] as [string, string])];

export function Onboarding() {
  const modal = useModal();
  const auth = useAuth();
  const mayEdit = auth.can("recruitment", "edit");
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const summary = useApi("GET /api/v1/recruitment/onboarding/summary");
  const list = usePaged("GET /api/v1/recruitment/onboarding", { filters: status ? { status: status as OnboardingStatus } : {} });
  const phone = useIsPhone();
  // Nothing opens unasked: a row opens its case in the dialog, or the sheet on a phone (F31).
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const settings = () => modal.open({ title: "Onboarding Settings", wide: true, body: (close) => <OnboardingSettingsPanel close={close} /> });

  // A link opens what it names whenever it arrives, then leaves the address in one step.
  const linked = params.get("case");
  const panel = params.get("panel");
  const asked = params.get("status");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const ask = linked ? `case:${linked}` : panel === "settings" ? "settings" : asked !== null ? `status:${asked}` : null;
    if (!ask) return void (opened.current = null);
    if (opened.current === ask) return;
    opened.current = ask;
    setParams({ case: null, panel: null, status: null }, { replace: true });
    if (asked !== null) setStatus(asked);
    if (linked) return void setPicked({ id: linked, title: "Onboarding" });
    if (panel === "settings" && mayEdit) settings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, panel, asked]);

  const s = summary.data;
  const n = (v: number | undefined) => (v === undefined ? "–" : String(v));
  return (
    <>
      <PageHeader
        title="Onboarding"
        sub="Documents, checks and the first month"
        actions={mayEdit && <Button icon="cog" onClick={settings}>Onboarding Settings</Button>}
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Documentation", value: n(s?.documentation), sub: s ? `${s.to_verify} to verify` : undefined, tone: s?.to_verify ? "warn" : undefined },
          { label: "Pre-Onboarding", value: n(s?.pre_onboarding) },
          { label: "Onboarding", value: n(s?.onboarding), sub: s ? `${s.overdue_steps} ${s.overdue_steps === 1 ? "step" : "steps"} overdue` : undefined, tone: s?.overdue_steps ? "err" : undefined },
          { label: "Hired This Month", value: n(s?.completed_this_month), tone: s?.completed_this_month ? "ok" : undefined },
        ]}
      />
      <Toolbar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPicked(null);
          }}
          options={STATUSES}
        />
      </Toolbar>
      <ListDetail
        layout="modal"
        size="wide"
        full
        open={picked !== null}
        onClose={() => setPicked(null)}
        title={picked?.title ?? "Onboarding"}
        list={
          <PagedTable<OnboardingRow>
            title="New Hires"
            list={list}
            search="Search hires"
            rowKey={(o) => o.onboarding_case_id}
            noun="new hire"
            onRowClick={(o) => setPicked({ id: o.onboarding_case_id, title: o.hire_name })}
            empty={list.q || status ? undefined : { title: "No New Hires Yet" }}
            columns={[
              { key: "who", label: "New Hire", render: (o) => <span className={cn(o.onboarding_case_id === picked?.id ? "font-semibold" : "font-medium")}>{o.hire_name}</span> },
              { key: "role", label: "Role", render: (o) => o.job_title, desktop: true },
              { key: "dept", label: "Department", render: (o) => o.department ?? "–", desktop: true },
              { key: "start", label: "Start Date", render: (o) => (o.starts_on ? formatDate(o.starts_on) : "–") },
              { key: "out", label: "Outstanding", align: "n", render: (o) => (o.status === "documentation" ? String(o.items_outstanding) : "–") },
              { key: "status", label: "Status", render: (o) => pill(CASE_STATUS[o.status]) },
            ]}
          />
        }
        detail={picked ? <OnboardingCase key={picked.id} id={picked.id} wide={!phone} /> : null}
      />
    </>
  );
}

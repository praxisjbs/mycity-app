import aiControl from "@mycity/contract/schemas/ai_control.js";
import type { AiPraxisSpend, AiProvider, AiProviderSpend, AiSpend, AiSpendAction } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import {
  BarChart,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  ErrorState,
  Field,
  Form,
  FormError,
  FormFooter,
  formatDate,
  Grid,
  HelpTerm,
  KeyValue,
  KpiCard,
  KpiGrid,
  LoadingRows,
  Meter,
  Money,
  MoneyField,
  PageHeader,
  Pill,
  toast,
  toMoneyString,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { useState } from "react";
import { HELP, JOB, NIGHTLY, PROVIDER } from "./words";

/** A cap's naira as the field shows it: "50000.00" → "50,000". */
const typed = (cap: string | null) => (cap ? Number(cap).toLocaleString("en-NG", { maximumFractionDigits: 2 }) : "");

/** Set Cap: a paid provider's monthly cap, or the cap on all AI. Blank is no cap. */
function CapForm({ provider, cap, done }: { provider: AiProvider | null; cap: string | null; done: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const f = useContractForm<{ monthly_cap_ngn: string }>(
    { monthly_cap_ngn: typed(cap) },
    { safeParse: (v: { monthly_cap_ngn: string }) => aiControl.AiCapSave.safeParse({ monthly_cap_ngn: toMoneyString(v.monthly_cap_ngn) }) },
  );
  const save = async () => {
    setProblem(null);
    const body = { monthly_cap_ngn: toMoneyString(f.values.monthly_cap_ngn) };
    try {
      if (provider) await api.call("PUT /api/v1/ai-control/caps/:provider", { params: { provider }, body });
      else await api.call("PUT /api/v1/ai-control/cap", { body });
      invalidate("/api/v1/ai-control");
      toast(body.monthly_cap_ngn ? "Cap set" : "Cap removed");
      done();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && Object.keys(err.fields).length) {
        f.setServerErrors(err.fields);
        // A refusal with its own sentence ("Only a paid provider has a cap") says it beside the mark.
        if (err.code !== "VALIDATION_FAILED") setProblem(err.message);
        return;
      }
      setProblem(err?.message ?? "Not saved");
    }
  };
  return (
    <Form onSubmit={f.submit(save)}>
      <Field label={<HelpTerm help={provider ? HELP.cap : HELP.overall}>Monthly Cap</HelpTerm>} optional {...f.status("monthly_cap_ngn")}>
        <MoneyField {...f.field("monthly_cap_ngn")} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={done}>Cancel</Button>
        <Button variant="primary" type="submit">
          Set Cap
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Spent against a cap: the bar, and the figures in words so colour is never the only sign. */
function AgainstCap({ spent, cap }: { spent: string; cap: string | null }) {
  if (cap === null)
    return (
      <span className="text-sm text-subtle-foreground">
        <Money value={spent} /> spent, no cap
      </span>
    );
  const pct = Number(cap) > 0 ? (Number(spent) / Number(cap)) * 100 : 100;
  return (
    <span className="flex flex-col gap-1">
      <Meter pct={pct} tone={pct >= 100 ? "err" : pct >= 80 ? "warn" : undefined} name="Spent against cap" label={`${Math.min(999, Math.round(pct))}%`} />
      <span className="text-xs text-subtle-foreground">
        <Money value={spent} short /> of <Money value={cap} short /> cap
      </span>
    </span>
  );
}

function ProviderCard({ p }: { p: AiProviderSpend }) {
  const { can } = useAuth();
  const modal = useModal();
  const paid = p.plan === "paid";
  return (
    <Card>
      <CardHeader
        title={PROVIDER[p.provider]}
        actions={
          paid && can("ai_control", "edit") ? (
            <Button size="sm" onClick={() => modal.open({ title: "Set Cap", body: (close) => <CapForm provider={p.provider} cap={p.cap_ngn} done={close} /> })}>
              Set Cap
            </Button>
          ) : undefined
        }
      >
        <span className="flex flex-wrap gap-1.5">
          <Pill tone={paid ? "info" : "neutral"}>{paid ? "Paid" : "Free"}</Pill>
          {!p.set_up && <Pill tone="neutral">Not Set Up</Pill>}
          {p.at_cap && <Pill tone="err">At Cap</Pill>}
        </span>
      </CardHeader>
      <div className="flex flex-col gap-1.5">
        <span className="text-xl font-semibold">
          <Money value={p.spent_ngn} />
        </span>
        {paid ? <AgainstCap spent={p.spent_ngn} cap={p.cap_ngn} /> : null}
        <span className="text-xs text-subtle-foreground">{p.calls.toLocaleString("en-NG")} calls this month</span>
      </div>
    </Card>
  );
}

/** One day as a bar's label, day first without the year: "14/10". */
const dayLabel = (iso: string) => formatDate(iso).slice(0, 5);

function Overall({ s }: { s: AiSpend }) {
  const { can } = useAuth();
  const modal = useModal();
  return (
    <Card>
      <CardHeader
        title="All AI"
        help={HELP.overall}
        actions={
          can("ai_control", "edit") ? (
            <Button size="sm" onClick={() => modal.open({ title: "Set Cap", body: (close) => <CapForm provider={null} cap={s.overall.cap_ngn} done={close} /> })}>
              Set Cap
            </Button>
          ) : undefined
        }
      >
        {s.overall.at_cap && <Pill tone="err">At Cap</Pill>}
      </CardHeader>
      <div className="flex flex-col gap-2">
        <span className="text-2xl font-semibold">
          <Money value={s.overall.spent_ngn} />
        </span>
        <AgainstCap spent={s.overall.spent_ngn} cap={s.overall.cap_ngn} />
        <KeyValue
          items={[
            ["Month Of", formatDate(s.month)],
            ["One Dollar", s.rate ? <Money value={Number(s.rate.usd_ngn).toFixed(2)} /> : null],
            ["Rates Of", s.rate ? formatDate(s.rate.day) : null],
          ]}
        />
      </div>
    </Card>
  );
}

/**
 * Praxis AI's refusals this month and the nightly attack run's last result (docs/guides/ai-control.md
 * §10, praxis-ai.md §6.17): three figures with help terms. The run before the first reads Not Run.
 */
function PraxisFigures({ p }: { p: AiPraxisSpend }) {
  const run = p.nightly;
  const state = run ? NIGHTLY[run.status] : null;
  return (
    <KpiGrid cols={3} className="mt-3">
      <KpiCard title="Reads Refused" value={p.reads_refused.toLocaleString("en-NG")} caption="Praxis AI, this month" help={HELP.readsRefused} />
      <KpiCard title="Presses Refused" value={p.presses_refused.toLocaleString("en-NG")} caption="Praxis AI, this month" help={HELP.pressesRefused} />
      <KpiCard
        title="Nightly Attacks"
        value={run && run.status !== "cannot_run" && run.status !== "failed" ? `${run.passed} of ${run.asked}` : (state?.text ?? "Not Run")}
        tone={state?.tone}
        caption={run ? `${state!.text} ${formatDate(run.finished_at)}` : "No run yet"}
        help={HELP.nightly}
      />
    </KpiGrid>
  );
}

/** AI Control · Spend (docs/guides/ai-control.md §2, §10). */
export function Spend() {
  const read = useApi("GET /api/v1/ai-control/spend");
  const byAction = usePaged("GET /api/v1/ai-control/spend/actions");
  const s = read.data;
  return (
    <>
      <PageHeader title="Spend" sub="This month, against each cap" />
      {read.error ? (
        <ErrorState error={read.error} onRetry={read.reload} />
      ) : !s ? (
        <LoadingRows count={4} />
      ) : (
        <>
          <Grid cols={3}>
            <Overall s={s} />
            {s.providers.map((p) => (
              <ProviderCard key={p.provider} p={p} />
            ))}
          </Grid>
          <PraxisFigures p={s.praxis_ai} />
          <DesktopOnly>
            <BarChart className="mt-3" title="Spend by Day" bars={s.days.map((d) => ({ label: dayLabel(d.day), value: Number(d.spent_ngn) }))} />
          </DesktopOnly>
        </>
      )}
      <DataView<AiSpendAction>
        className="mt-3"
        list={byAction}
        title="By Action"
        caption="Spend by action"
        noun="action"
        rowKey={(r) => r.key}
        empty={{ title: "Nothing Spent", icon: "wallet" }}
        columns={[
          {
            key: "action",
            label: "Action",
            render: (r) => (
              <span className="flex min-w-0 flex-col">
                <span data-copy="content">{r.label}</span>
                {r.job && <span className="text-xs text-subtle-foreground">{JOB[r.job]}</span>}
              </span>
            ),
          },
          { key: "calls", label: "Calls", align: "n", render: (r) => r.calls.toLocaleString("en-NG") },
          { key: "spent", label: "Spent", align: "n", render: (r) => <Money value={r.spent_ngn} /> },
        ]}
      />
    </>
  );
}

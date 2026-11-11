/**
 * Partnerships · Analytics (#55, docs/guides/partnerships.md §6.18, §10): MyCity's monthly performance
 * sheet for a period. The KPI strip, each lead owner's eight measures, deals signed and returns per
 * month, by category, by region and stage to stage. Every figure is the server's (GET
 * /partnerships/analytics), within the reader's scope; Returns per Month only reaches a holder of
 * `partnerships.money` and a rating only where Performance shows it. Export on a computer makes the
 * period's workbook. On a phone: the period, two KPI cards, a card a lead owner and Signed per Month.
 */
import { useState } from "react";
import analyticsSchemas from "@mycity/contract/schemas/partnership_analytics.js";
import type {
  OwnerMeasures,
  PartnershipAnalytics,
} from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  BarChart,
  Button,
  Card,
  DataView,
  DateRangeField,
  EmptyValue,
  ErrorState,
  ExportButton,
  Field,
  Form,
  formatDate,
  formatMoneyShort,
  formatMonth,
  FormFooter,
  Grid,
  HelpTerm,
  LoadingRows,
  PageHeader,
  SegmentedControl,
  todayIso,
  useContractForm,
  useIsPhone,
  useModal,
  Who,
} from "@mycity/ui";
import { useMay } from "./lib";

type Period = "month" | "quarter" | "year" | "custom";
type Dates = { from: string; to: string };
type Query = { period: Period } & Partial<Dates>;

const PERIODS: Array<[Period, string]> = [
  ["month", "This Month"],
  ["quarter", "This Quarter"],
  ["year", "This Year"],
  ["custom", "Custom"],
];

/** The performance sheet's measures, each with its help (tier 2, §10.1). */
const MEASURES: Array<{
  key: keyof OwnerMeasures;
  label: string;
  help: string;
}> = [
  {
    key: "new_prospects",
    label: "New Prospects",
    help: "Leads the owner identified in the period, or created when no date was given.",
  },
  {
    key: "meetings_held",
    label: "Meetings Held",
    help: "Meetings logged on a lead or partner, and connected calendar meetings that took place.",
  },
  {
    key: "proposals_sent",
    label: "Proposals Sent",
    help: "Proposals sent on the owner's deals.",
  },
  {
    key: "partnerships_signed",
    label: "Signed",
    help: "Deals that reached a signed stage in the period. The tracker's imported history is left out.",
  },
  {
    key: "active_partnerships",
    label: "Active Partnerships",
    help: "Partners the owner keeps that had a live deal on the period's last day.",
  },
  {
    key: "downloads",
    label: "Downloads",
    help: "App downloads in the returns of the owner's deals.",
  },
  {
    key: "vendor_leads",
    label: "Vendor Leads",
    help: "New prospects in a category that counts as vendor.",
  },
];
const RATING_HELP =
  "The owner's latest monthly rating from Performance in the period, shown only where Performance lets you see it.";

const count = (n: number) => n.toLocaleString("en-NG");
const monthLabel = (m: string) => formatMonth(`${m}-01`);

/** Custom: From and To, checked as filled by the contract's own rule. */
function CustomPeriodForm({
  initial,
  close,
  onPick,
}: {
  initial: Dates;
  close: () => void;
  onPick: (d: Dates) => void;
}) {
  const f = useContractForm(
    { period: initial },
    {
      safeParse: (v: { period: Dates }) => {
        const r = analyticsSchemas.AnalyticsQuery.safeParse({
          period: "custom",
          from: v.period.from || undefined,
          to: v.period.to || undefined,
        });
        return r.success
          ? r
          : {
              success: false,
              error: {
                issues: (r.error?.issues ?? []).map((i) => ({
                  ...i,
                  path: ["period"],
                })),
              },
            };
      },
    },
  );
  const show = () => {
    if (!f.check()) return;
    onPick(f.values.period);
    close();
  };
  return (
    <Form onSubmit={show}>
      <Field label="Period" {...f.status("period")}>
        <DateRangeField
          value={f.values.period}
          onChange={(p) => f.set("period", p)}
          onProblem={f.field("period").onProblem}
        />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Show Period
        </Button>
      </FormFooter>
    </Form>
  );
}

export function Analytics() {
  const phone = useIsPhone();
  const modal = useModal();
  const mayExport = useMay("export");
  const [period, setPeriod] = useState<Period>("month");
  const [dates, setDates] = useState<Dates | null>(null);
  const query: Query = {
    period,
    ...(period === "custom" && dates ? dates : {}),
  };
  const { data, error, reload } = useApi("GET /api/v1/partnerships/analytics", {
    query,
  });
  const pickDates = () =>
    modal.open({
      title: "Custom Period",
      body: (close) => (
        <CustomPeriodForm
          initial={
            dates ?? {
              from: data?.period.from ?? "",
              to: data?.period.to ?? todayIso(),
            }
          }
          close={close}
          onPick={(d) => {
            setDates(d);
            setPeriod("custom");
          }}
        />
      ),
    });
  const choosePeriod = (v: Period) =>
    v === "custom" ? pickDates() : setPeriod(v);
  const exportPeriod = () =>
    saveExport(
      api.call("POST /api/v1/partnerships/exports", {
        body: { source: "partnerships.analytics", filters: query },
      }),
    );
  return (
    <>
      <PageHeader
        title="Analytics"
        sub={
          data
            ? `${formatDate(data.period.from)} to ${formatDate(data.period.to)}`
            : undefined
        }
        actions={
          <>
            <SegmentedControl
              label="Period"
              value={period}
              onChange={choosePeriod}
              options={PERIODS}
            />
            {period === "custom" && (
              <Button onClick={pickDates}>Change Dates</Button>
            )}
            {mayExport && !phone && <ExportButton onExport={exportPeriod} />}
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && (
        <Card>
          <LoadingRows count={6} />
        </Card>
      )}
      {data && <Figures a={data} phone={phone} />}
    </>
  );
}

function Figures({ a, phone }: { a: PartnershipAnalytics; phone: boolean }) {
  const tiles = [
    {
      key: "p",
      label: "New Prospects",
      value: count(a.kpis.new_prospects),
      help: MEASURES[0].help,
    },
    {
      key: "s",
      label: "Partnerships Signed",
      value: count(a.kpis.partnerships_signed),
      tone: "ok" as const,
      help: MEASURES[3].help,
    },
    {
      key: "m",
      label: "Meetings Held",
      value: count(a.kpis.meetings_held),
      help: MEASURES[1].help,
    },
    {
      key: "pr",
      label: "Proposals Sent",
      value: count(a.kpis.proposals_sent),
      help: MEASURES[2].help,
    },
  ];
  return (
    <>
      <KpiTiles mobileCols={2} items={phone ? tiles.slice(0, 2) : tiles} />
      <DataView<OwnerMeasures>
        className="mt-3"
        title="By Lead Owner"
        rows={a.by_owner}
        rowKey={(r) => r.owner?.employee_id ?? "none"}
        empty={{
          title: "Nothing Yet",
          text: "Each lead owner's month shows here.",
        }}
        columns={[
          {
            key: "owner",
            label: "Lead Owner",
            render: (r) =>
              r.owner ? (
                <Who
                  name={r.owner.display_name}
                  sub={r.owner.department ?? undefined}
                />
              ) : (
                "No Owner"
              ),
          },
          ...MEASURES.map((m) => ({
            key: m.key,
            label: <HelpTerm help={m.help}>{m.label}</HelpTerm>,
            sortLabel: m.label,
            align: "n" as const,
            render: (r: OwnerMeasures) => count(r[m.key] as number),
          })),
          {
            key: "rating",
            label: <HelpTerm help={RATING_HELP}>Rating</HelpTerm>,
            sortLabel: "Rating",
            render: (r) => r.performance_rating ?? <EmptyValue />,
          },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <BarChart
          title="Signed per Month"
          help="Deals that reached a signed stage each month."
          bars={a.signed_per_month.map((m) => ({
            label: monthLabel(m.month),
            value: m.signed,
          }))}
          caption={`${formatMoneyShort(a.signed_per_month.reduce((n, m) => n + Number(m.value), 0).toFixed(2))} signed`}
        />
        {a.returns_per_month && !phone && (
          <BarChart
            title="Returns per Month"
            help="MyCity's commission from each month's returns."
            bars={a.returns_per_month.map((m) => ({
              label: monthLabel(m.month),
              value: Number(m.mycity_commission),
            }))}
            caption={`${count(a.returns_per_month.reduce((n, m) => n + m.downloads, 0))} downloads`}
          />
        )}
      </Grid>
      {!phone && (
        <>
          <Grid cols={2} className="mt-3">
            <DataView
              title="By Category"
              rows={a.by_category}
              rowKey={(r) => r.partner_category_id ?? "none"}
              empty={{ title: "No Deals Yet" }}
              columns={[
                { key: "n", label: "Category", render: (r) => r.name },
                {
                  key: "o",
                  label: <HelpTerm help="Deals open today.">Open</HelpTerm>,
                  sortLabel: "Open",
                  align: "n",
                  render: (r) => count(r.open),
                },
                {
                  key: "s",
                  label: "Signed",
                  align: "n",
                  render: (r) => count(r.signed),
                },
                {
                  key: "v",
                  label: "Signed Value",
                  align: "n",
                  render: (r) => formatMoneyShort(r.value),
                },
              ]}
            />
            <DataView
              title="By Region"
              rows={a.by_region}
              rowKey={(r) => r.region}
              empty={{ title: "No Deals Yet" }}
              columns={[
                { key: "r", label: "Region", render: (r) => r.region },
                {
                  key: "o",
                  label: (
                    <HelpTerm help="Deals open today. A record in two cities counts in each.">
                      Open
                    </HelpTerm>
                  ),
                  sortLabel: "Open",
                  align: "n",
                  render: (r) => count(r.open),
                },
                {
                  key: "s",
                  label: "Signed",
                  align: "n",
                  render: (r) => count(r.signed),
                },
              ]}
            />
          </Grid>
          <DataView
            className="mt-3"
            title="Stage Conversion"
            rows={a.stage_conversion}
            rowKey={(r) => `${r.from_stage}:${r.to_stage}`}
            empty={{ title: "No Stages Yet" }}
            columns={[
              { key: "f", label: "From", render: (r) => r.from_label },
              { key: "t", label: "To", render: (r) => r.to_label },
              {
                key: "m",
                label: (
                  <HelpTerm help="Deals moved or opened in the period that reached the next stage.">
                    Reached
                  </HelpTerm>
                ),
                sortLabel: "Reached",
                align: "n",
                render: (r) => count(r.moved),
              },
              {
                key: "c",
                label: "Rate",
                align: "n",
                render: (r) =>
                  r.rate === null ? <EmptyValue /> : `${r.rate}%`,
              },
            ]}
          />
        </>
      )}
    </>
  );
}

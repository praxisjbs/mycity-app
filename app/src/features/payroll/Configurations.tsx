import payroll from "@mycity/contract/schemas/payroll.js";
import salary from "@mycity/contract/schemas/salary_structure.js";
import statutory from "@mycity/contract/schemas/statutory.js";
import type { GradePlacement, PayComponentSet, PayrollSettings, SalaryGrade, StatutoryItemState, StatutoryRate } from "@mycity/contract/contract.gen.ts";
import { type ReactNode, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { RESTRICTED_HELP } from "@/features/people/status";
import { paging } from "@/features/shared/wire";
import { hasCapability } from "@/shell/access";
import {
  BandChart,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  ChoiceField,
  Chips,
  DataView,
  type DataViewColumn,
  DateField,
  DesktopOnly,
  Field,
  FormError,
  FormFooter,
  formatDate,
  formatMoney,
  formatMoneyShort,
  HelpTerm,
  Inline,
  KeyValue,
  ListDetail,
  LoadingRows,
  Money,
  MoneyField,
  NumberField,
  PageHeader,
  Pill,
  SelectField,
  Switch,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";

/**
 * Payroll · Configurations (docs/guides/payroll.md §2, §3.5, §6.11, §6.12, §10): how MyCity is paid. Always: the Pay Day,
 * Bank Details Required, the Advanced Payroll switch, the Statutory Items and the PAYE Bands, so the first rates are
 * entered before the option is first switched on (§13.1 item 25). Once the option is on or has been: the accountant's
 * three conventions, the salary grades with who sits outside their band, and each person's pay split.
 *
 * Every change is a version from today or later, made by someone holding `payroll.configure`; the screen hides the
 * controls from anyone else (the API still decides). Nothing here is hard-coded data: every rate, band and grade is
 * one MyCity entered. The words of the seven items and their bases are the code's, not figures.
 */

type Item = StatutoryItemState["item"];
type Base = StatutoryItemState["bases"][number];
type Tone = "ok" | "warn" | "info" | "neutral";

const ITEM_WORDS: Record<Item, string> = {
  paye: "PAYE",
  pension_employee: "Employee Pension",
  pension_employer: "Employer Pension",
  nhf: "NHF",
  itf: "ITF",
  nsitf: "NSITF",
  relief: "Relief",
};
const BASE_WORDS: Record<Base, string> = {
  gross: "Gross Pay",
  pensionable: "Pensionable Pay",
  basic: "Basic Pay",
  taxable: "Taxable Pay",
  annual_payroll: "Payroll",
};
const BASIS_WORDS: Record<NonNullable<PayrollSettings["paye_basis"]>, string> = { annualised: "Annualised", monthly: "Monthly" };
const POSITION: Record<NonNullable<GradePlacement["band_position"]>, { tone: Tone; text: string }> = {
  below: { tone: "warn", text: "Below Minimum" },
  within: { tone: "ok", text: "Within Band" },
  above: { tone: "warn", text: "Above Maximum" },
};
const PLACEMENT_CHIPS: Array<[string, string]> = [
  ["all", "All"],
  ["below", "Below Minimum"],
  ["above", "Above Maximum"],
  ["unplaced", "Not Placed"],
];

const ADVANCED_HELP = "From its date, later runs compute PAYE, pension, NHF, ITF and NSITF. Locked runs never change.";
const BANK_HELP = "When on, a person with no bank details blocks Submit.";
const PAY_DAY_HELP = "30 unless changed. A day past a month's end is that month's last day.";
const BASIS_HELP = "Annualised: PAYE bands are annual amounts. Monthly: they are monthly amounts.";
const SPLIT_HELP = "The components add up to the monthly gross.";

const failed = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);
const yesNo = (v: boolean | null) => (v === null ? "Not Set" : v ? "Yes" : "No");
const pct = (rate: string | null) => (rate === null ? "" : `${rate}%`);
const DAYS: Array<readonly [string, string]> = Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)] as const);
const YES_NO: Array<readonly [string, string]> = [
  ["yes", "Yes"],
  ["no", "No"],
];
const BASES: Array<readonly [string, string]> = [
  ["annualised", "Annualised"],
  ["monthly", "Monthly"],
];

/** An amount as a row shows it: the figure, or Restricted where the salary is masked from the reader. */
const amount = (v: string | null) =>
  v !== null ? (
    <Money value={v} />
  ) : (
    <span className="text-subtle-foreground">
      <HelpTerm help={RESTRICTED_HELP}>Restricted</HelpTerm>
    </span>
  );

/** A form's issues moved onto the keys its fields carry, for a body the form builds from flat values. */
type Issue = { path: PropertyKey[]; message: string; code?: string };
type Parsed = { success: boolean; error?: { issues: Issue[] } };
const moved = (r: Parsed, key: (path: PropertyKey[]) => string): Parsed =>
  r.success ? r : { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, code: "custom", path: [key(i.path)] })) } };

/** A 422's fields on the form, or a toast for anything else. */
function landed(e: unknown, set: (fields: Record<string, string[]>) => void, fallback: string) {
  if (e instanceof ApiError && Object.keys(e.fields).length) set(e.fields);
  else failed(e, fallback);
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export default function Configurations() {
  const may = hasCapability(useMe(), "payroll.configure");
  const settings = useApi("GET /api/v1/payroll/settings");
  const items = useApi("GET /api/v1/statutory/items");
  const s = settings.data;
  const shown = Boolean(s && (s.advanced_enabled || s.advanced_has_been_on));
  return (
    <>
      <PageHeader title="Configurations" sub="Pay day, statutory items and grades" />
      {s ? <OptionsCard settings={s} may={may} /> : <Card><LoadingRows /></Card>}
      <StatutoryItems items={items.data?.items ?? []} loading={items.loading} may={may} />
      <PayeBands may={may} basis={s?.paye_basis ?? null} />
      {s && shown && <Conventions settings={s} may={may} />}
      {shown && <Structure may={may} />}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Payroll Options: the pay day, the bank rule and the advanced switch
 * ------------------------------------------------------------------ */

function OptionsCard({ settings: s, may }: { settings: PayrollSettings; may: boolean }) {
  const modal = useModal();
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const next = s.next;
  // Where the switch is heading: a version that starts later decides it, so pressing it again undoes what is waiting.
  const advanced = next ? next.advanced_enabled : s.advanced_enabled;
  const nextPayDay = next && next.pay_day !== null && next.pay_day !== s.pay_day ? next : null;
  const bank = async (on: boolean) => {
    try {
      await patch.run({ body: { effective_from: todayIso(), require_bank_details: on } });
      invalidate("/api/v1/payroll/settings");
      toast(on ? "Bank details now required" : "Bank details now a warning");
    } catch (e) {
      failed(e, "Setting not saved");
    }
  };
  const openAdvanced = () =>
    modal.open({ title: advanced ? "Switch Off Advanced Payroll" : "Switch On Advanced Payroll", body: (close) => <AdvancedForm on={!advanced} settings={s} close={close} /> });
  const advancedState =
    next && next.advanced_enabled !== s.advanced_enabled ? (
      <Pill tone="info">{`${next.advanced_enabled ? "On" : "Off"} from ${formatDate(next.effective_from)}`}</Pill>
    ) : (
      <Pill tone={s.advanced_enabled ? "ok" : "neutral"}>{s.advanced_enabled ? "On" : "Off"}</Pill>
    );
  return (
    <Card>
      <CardHeader title="Payroll Options" />
      <KeyValue
        items={[
          [
            <HelpTerm key="pd" help={PAY_DAY_HELP}>
              Pay Day
            </HelpTerm>,
            <Inline key="pdv" gap={2} className="flex-wrap">
              <span>{s.pay_day_is_default ? `${s.pay_day} (default)` : s.pay_day}</span>
              {nextPayDay && <Pill tone="info">{`${nextPayDay.pay_day} from ${formatDate(nextPayDay.effective_from)}`}</Pill>}
              {may && (
                <Button size="sm" onClick={() => modal.open({ title: "Set Pay Day", body: (close) => <PayDayForm settings={s} close={close} /> })}>
                  Set Pay Day
                </Button>
              )}
            </Inline>,
          ],
          [
            <HelpTerm key="bd" help={BANK_HELP}>
              Bank Details Required
            </HelpTerm>,
            may ? (
              <Switch key="bdv" checked={s.require_bank_details} onChange={bank} label="Bank Details Required" />
            ) : (
              <Pill key="bdv" tone="neutral">
                {s.require_bank_details ? "On" : "Off"}
              </Pill>
            ),
          ],
          [
            <HelpTerm key="ap" help={ADVANCED_HELP}>
              Advanced Payroll
            </HelpTerm>,
            <Inline key="apv" gap={2} className="flex-wrap">
              {advancedState}
              {may && <Switch checked={advanced} onChange={openAdvanced} label="Advanced Payroll" />}
            </Inline>,
          ],
        ]}
      />
    </Card>
  );
}

type PayDayValues = { pay_day: string; effective_from: string };

/** Set Pay Day: a day of the month, 1 to 31, from a day that has not passed. */
function PayDayForm({ settings: s, close }: { settings: PayrollSettings; close: () => void }) {
  const f = useContractForm<PayDayValues>(
    { pay_day: String(s.pay_day), effective_from: todayIso() },
    { safeParse: (v: PayDayValues) => payroll.PayrollSettingsChange.safeParse({ effective_from: v.effective_from, pay_day: Number(v.pay_day) }) },
  );
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const save = async () => {
    if (!f.check()) return;
    try {
      await patch.run({ body: { effective_from: f.values.effective_from, pay_day: Number(f.values.pay_day) } });
      invalidate("/api/v1/payroll/settings");
      close();
      toast("Pay day saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Pay day not saved");
    }
  };
  return (
    <>
      <Field label="Pay Day" help={PAY_DAY_HELP} {...f.status("pay_day")}>
        <SelectField options={DAYS} {...f.field("pay_day")} />
      </Field>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Set Pay Day
        </Button>
      </FormFooter>
    </>
  );
}

type ConventionValues = { effective_from: string; paye_basis: string; pension_reduces_taxable: string; nhf_reduces_taxable: string };

const asFlag = (v: string) => (v === "yes" ? true : v === "no" ? false : undefined);
const fromFlag = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");

/** The body of a change to the conventions, with the three asked for (none has a default, §6.12 rule 1). */
function conventionsBody(v: ConventionValues) {
  return {
    effective_from: v.effective_from,
    paye_basis: (v.paye_basis || undefined) as "annualised" | "monthly" | undefined,
    pension_reduces_taxable: asFlag(v.pension_reduces_taxable),
    nhf_reduces_taxable: asFlag(v.nhf_reduces_taxable),
  };
}
const conventionsCheck = (v: ConventionValues): Parsed => {
  const r = payroll.PayrollSettingsChange.safeParse(conventionsBody(v)) as Parsed;
  const unset: Issue[] = (["paye_basis", "pension_reduces_taxable", "nhf_reduces_taxable"] as const).filter((k) => !v[k]).map((k) => ({ path: [k], message: "Pick one", code: "custom" }));
  const issues = [...(r.success ? [] : (r.error?.issues ?? [])), ...unset];
  return issues.length ? { success: false, error: { issues } } : { success: true };
};

/** The three conventions, asked for whenever the option is switched on or they are changed. */
function ConventionFields({ f }: { f: ReturnType<typeof useContractForm<ConventionValues>> }) {
  return (
    <>
      <Field label="PAYE Basis" help={BASIS_HELP} {...f.status("paye_basis")}>
        <ChoiceField options={BASES} {...f.field("paye_basis")} />
      </Field>
      <Field label="Pension Reduces Taxable Pay" {...f.status("pension_reduces_taxable")}>
        <ChoiceField options={YES_NO} {...f.field("pension_reduces_taxable")} />
      </Field>
      <Field label="NHF Reduces Taxable Pay" {...f.status("nhf_reduces_taxable")}>
        <ChoiceField options={YES_NO} {...f.field("nhf_reduces_taxable")} />
      </Field>
    </>
  );
}

/** Switch On (with the date and the three conventions) or Switch Off (with the date): §10.3, amendment 2. */
function AdvancedForm({ on, settings: s, close }: { on: boolean; settings: PayrollSettings; close: () => void }) {
  const latest = s.next ?? s.current;
  const f = useContractForm<ConventionValues>(
    {
      effective_from: todayIso(),
      paye_basis: latest?.paye_basis ?? "",
      pension_reduces_taxable: fromFlag(latest?.pension_reduces_taxable ?? null),
      nhf_reduces_taxable: fromFlag(latest?.nhf_reduces_taxable ?? null),
    },
    { safeParse: (v: ConventionValues) => (on ? conventionsCheck(v) : payroll.PayrollSettingsChange.safeParse({ effective_from: v.effective_from, advanced_enabled: false })) },
  );
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const save = async () => {
    if (!f.check()) return;
    try {
      await patch.run({ body: on ? { ...conventionsBody(f.values), advanced_enabled: true } : { effective_from: f.values.effective_from, advanced_enabled: false } });
      invalidate("/api/v1/payroll/settings", "/api/v1/salary-structure");
      close();
      toast(on ? "Advanced Payroll switched on" : "Advanced Payroll switched off");
    } catch (e) {
      landed(e, f.setServerErrors, "Not switched");
    }
  };
  return (
    <>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      {on && <ConventionFields f={f} />}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          {on ? "Switch On" : "Switch Off"}
        </Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Statutory Items and PAYE Bands: always on the screen (§13.1 item 25)
 * ------------------------------------------------------------------ */

/** What an item's rate reads as: a percentage, the relief's amount and rate, or how many PAYE bands. */
function rateOf(i: StatutoryItemState) {
  const v = i.current ?? i.next;
  if (!v) return "";
  if (i.item === "paye") return v.bands === 1 ? "1 band" : `${v.bands} bands`;
  if (i.item === "relief") return [v.flat_amount && v.flat_amount !== "0.00" ? formatMoney(v.flat_amount) : null, v.rate && v.rate !== "0" ? pct(v.rate) : null].filter(Boolean).join(" + ");
  return pct(v.rate);
}

function itemStatus(i: StatutoryItemState) {
  if (i.next) return <Pill tone="info">{`${i.current ? "Changes" : "From"} ${formatDate(i.next.effective_from)}`}</Pill>;
  if (i.current) return <Pill tone="ok">In Force</Pill>;
  return <Pill tone="neutral">Not Set</Pill>;
}

function StatutoryItems({ items, loading, may }: { items: StatutoryItemState[]; loading: boolean; may: boolean }) {
  const modal = useModal();
  const open = (i: StatutoryItemState) =>
    modal.open({
      title: i.item === "paye" ? "Set PAYE Bands" : `Set ${ITEM_WORDS[i.item]}`,
      body: (close) => (i.item === "paye" ? <BandsForm close={close} /> : <RateForm state={i} close={close} />),
    });
  const columns: DataViewColumn<StatutoryItemState>[] = [
    { key: "item", label: "Item", render: (i) => <span className="font-semibold">{ITEM_WORDS[i.item]}</span> },
    { key: "kind", label: "Type", render: (i) => (i.kind === "employer" ? "Employer" : "Employee") },
    { key: "rate", label: "Rate", render: rateOf },
    { key: "base", label: "Base", desktop: true, render: (i) => BASE_WORDS[(i.current ?? i.next)?.base ?? i.bases[0]] },
    { key: "status", label: "Status", badge: true, render: itemStatus },
  ];
  return (
    <DataView
      title="Statutory Items"
      rows={items}
      loading={loading}
      rowKey={(i) => i.item}
      onRowClick={may ? open : undefined}
      noun="item"
      columns={columns}
      className="mt-3"
    />
  );
}

/** The band of a PAYE row as the table reads it. */
const bandStatus = (r: StatutoryRate) =>
  r.effective_from > todayIso() ? <Pill tone="info">{`From ${formatDate(r.effective_from)}`}</Pill> : <Pill tone="ok">In Force</Pill>;

function PayeBands({ may, basis }: { may: boolean; basis: PayrollSettings["paye_basis"] }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/statutory/rates", { filters: { item: "paye" } });
  const columns: DataViewColumn<StatutoryRate>[] = [
    { key: "band", label: "Band", render: (r) => <span className="font-semibold">{`Band ${r.position ?? ""}`}</span> },
    { key: "from", label: "From", align: "n", render: (r) => <Money value={r.band_from ?? "0.00"} /> },
    { key: "to", label: "To", align: "n", render: (r) => (r.band_to ? <Money value={r.band_to} /> : "No Limit") },
    { key: "rate", label: "Rate", align: "n", render: (r) => pct(r.rate) },
    { key: "applies", label: "Status", badge: true, render: bandStatus },
  ];
  return (
    <DataView
      title={basis ? `PAYE Bands, ${BASIS_WORDS[basis]}` : "PAYE Bands"}
      help={BASIS_HELP}
      list={list}
      rowKey={(r) => r.statutory_rate_id}
      noun="band"
      empty={{ icon: "list", title: "No PAYE Bands", text: "Set the bands before switching on." }}
      actions={
        may && (
          <Button size="sm" onClick={() => modal.open({ title: "Set PAYE Bands", body: (close) => <BandsForm close={close} /> })}>
            Set Bands
          </Button>
        )
      }
      columns={columns}
      className="mt-3"
    />
  );
}

type RateValues = { rate: string; flat_amount: string; base: string; effective_from: string };

/** Set one item's rate (the relief its flat amount too), from a day: Save Rate. */
function RateForm({ state: i, close }: { state: StatutoryItemState; close: () => void }) {
  const latest = i.next ?? i.current;
  const body = (v: RateValues) => ({
    item: i.item,
    effective_from: v.effective_from,
    ...(v.base && v.base !== i.bases[0] && { base: v.base as Base }),
    ...(v.rate !== "" && { rate: v.rate }),
    ...(i.item === "relief" && v.flat_amount !== "" && { flat_amount: v.flat_amount }),
  });
  const f = useContractForm<RateValues>(
    { rate: latest?.rate && latest.rate !== "0" ? latest.rate : "", flat_amount: latest?.flat_amount ?? "", base: latest?.base ?? i.bases[0], effective_from: todayIso() },
    { safeParse: (v: RateValues) => statutory.StatutoryRatesSave.safeParse(body(v)) },
  );
  const save = useMutation("POST /api/v1/statutory/rates");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: body(f.values) });
      invalidate("/api/v1/statutory");
      close();
      toast("Rate saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Rate not saved");
    }
  };
  return (
    <>
      {i.item === "relief" && (
        <Field label="Flat Amount" optional {...f.status("flat_amount")}>
          <MoneyField {...f.field("flat_amount")} />
        </Field>
      )}
      <Field label="Rate" optional={i.item === "relief"} {...f.status("rate")}>
        <NumberField decimal {...f.field("rate")} placeholder="7.5" />
      </Field>
      {i.bases.length > 1 && (
        <Field label="Base" {...f.status("base")}>
          <ChoiceField options={i.bases.map((b) => [b, BASE_WORDS[b]] as const)} {...f.field("base")} />
        </Field>
      )}
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Save Rate
        </Button>
      </FormFooter>
    </>
  );
}

const MAX_BANDS = 12;
type BandValues = Record<string, string>;

/** The PAYE table as a body: each band starts where the one before ends, the first at nothing; a blank last end is open. */
function bandsBody(v: BandValues, count: number) {
  return {
    item: "paye" as const,
    effective_from: v.effective_from,
    bands: Array.from({ length: count }, (_, i) => ({
      band_from: i === 0 ? "0.00" : v[`to_${i - 1}`] || "",
      band_to: v[`to_${i}`] ? v[`to_${i}`] : null,
      rate: v[`rate_${i}`],
    })),
  };
}

/** Set PAYE Bands: the whole table from a day, each band's upper limit and rate (§6.12). */
function BandsForm({ close }: { close: () => void }) {
  const today = useApi("GET /api/v1/statutory/rates", { query: { item: "paye" } });
  if (today.loading) return <LoadingRows />;
  const rows = today.data?.data ?? [];
  const latestDay = rows.reduce((d, r) => (r.effective_from > d ? r.effective_from : d), "");
  const latest = rows.filter((r) => r.effective_from === latestDay).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return <BandsFields initial={latest} close={close} />;
}

function BandsFields({ initial, close }: { initial: StatutoryRate[]; close: () => void }) {
  const [count, setCount] = useState(Math.max(initial.length, 1));
  const start: BandValues = { effective_from: todayIso() };
  for (let i = 0; i < MAX_BANDS; i += 1) {
    start[`to_${i}`] = initial[i]?.band_to ?? "";
    start[`rate_${i}`] = initial[i]?.rate ?? "";
  }
  const f = useContractForm<BandValues>(start, {
    safeParse: (v: BandValues) =>
      moved(statutory.StatutoryRatesSave.safeParse(bandsBody(v, count)) as Parsed, (path) => {
        if (path[0] !== "bands" || typeof path[1] !== "number") return String(path[0] ?? "to_0") === "bands" ? "to_0" : String(path[0]);
        const i = path[1];
        if (path[2] === "rate") return `rate_${i}`;
        if (path[2] === "band_from") return `to_${Math.max(i - 1, 0)}`;
        return `to_${i}`;
      }),
  });
  const save = useMutation("POST /api/v1/statutory/rates");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: bandsBody(f.values, count) });
      invalidate("/api/v1/statutory");
      close();
      toast("PAYE bands saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Bands not saved");
    }
  };
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mb-2">
          <Field label={`Band ${i + 1} Up To`} optional={i === count - 1} {...f.status(`to_${i}`)}>
            <MoneyField {...f.field(`to_${i}`)} />
          </Field>
          <Field label={`Band ${i + 1} Rate`} {...f.status(`rate_${i}`)}>
            <NumberField decimal {...f.field(`rate_${i}`)} placeholder="10" />
          </Field>
        </div>
      ))}
      <Inline gap={2} className="mb-3 flex-wrap">
        {count < MAX_BANDS && <Button size="sm" icon="plus" onClick={() => setCount(count + 1)}>Add Band</Button>}
        {count > 1 && <Button size="sm" onClick={() => setCount(count - 1)}>Remove Band</Button>}
      </Inline>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Save Bands
        </Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Conventions: once the option is on or has been
 * ------------------------------------------------------------------ */

function Conventions({ settings: s, may }: { settings: PayrollSettings; may: boolean }) {
  const modal = useModal();
  const v = s.next ?? s.current;
  return (
    <Card className="mt-3">
      <CardHeader
        title="Conventions"
        actions={
          may && (
            <Button size="sm" onClick={() => modal.open({ title: "Set Conventions", body: (close) => <ConventionsForm settings={s} close={close} /> })}>
              Set Conventions
            </Button>
          )
        }
      />
      <KeyValue
        items={[
          [
            <HelpTerm key="pb" help={BASIS_HELP}>
              PAYE Basis
            </HelpTerm>,
            v?.paye_basis ? BASIS_WORDS[v.paye_basis] : "Not Set",
          ],
          ["Pension Reduces Taxable Pay", yesNo(v?.pension_reduces_taxable ?? null)],
          ["NHF Reduces Taxable Pay", yesNo(v?.nhf_reduces_taxable ?? null)],
        ]}
      />
    </Card>
  );
}

function ConventionsForm({ settings: s, close }: { settings: PayrollSettings; close: () => void }) {
  const latest = s.next ?? s.current;
  const f = useContractForm<ConventionValues>(
    {
      effective_from: todayIso(),
      paye_basis: latest?.paye_basis ?? "",
      pension_reduces_taxable: fromFlag(latest?.pension_reduces_taxable ?? null),
      nhf_reduces_taxable: fromFlag(latest?.nhf_reduces_taxable ?? null),
    },
    { safeParse: conventionsCheck },
  );
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const save = async () => {
    if (!f.check()) return;
    try {
      await patch.run({ body: conventionsBody(f.values) });
      invalidate("/api/v1/payroll/settings");
      close();
      toast("Conventions saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Conventions not saved");
    }
  };
  return (
    <>
      <ConventionFields f={f} />
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Set Conventions
        </Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Salary Structure and Pay Components: once the option is on or has been
 * ------------------------------------------------------------------ */

function Structure({ may }: { may: boolean }) {
  const modal = useModal();
  const beside = useSideBySide();
  const grades = usePaged("GET /api/v1/salary-structure/grades");
  const [position, setPosition] = useState("all");
  const [pick, setPick] = useState<string | null>(null);
  const people = usePaged("GET /api/v1/salary-structure/placements", { filters: position === "all" ? {} : { band_position: position as "below" | "above" | "unplaced" } });
  const picked = pick ? (people.rows.find((p) => p.employee.employee_id === pick) ?? null) : null;
  const shown = picked ?? (beside ? (people.rows[0] ?? null) : null);

  const banded = grades.rows.filter((g) => g.band_minimum !== null && g.band_maximum !== null);
  const top = banded.reduce((mx, g) => Math.max(mx, Number(g.band_maximum)), 0) * 1.05 || 1;
  const at = (v: string | null) => (Number(v ?? 0) / top) * 100;
  const gradeColumns: DataViewColumn<SalaryGrade>[] = [
    { key: "code", label: "Grade", render: (g) => <span className="font-semibold">{g.code}</span> },
    { key: "name", label: "Name", render: (g) => g.name },
    { key: "minimum", label: "Minimum", align: "n", desktop: true, render: (g) => amount(g.band_minimum) },
    { key: "maximum", label: "Maximum", align: "n", desktop: true, render: (g) => amount(g.band_maximum) },
    { key: "staff", label: "Staff", align: "n", render: (g) => g.staff },
    { key: "outside", label: "Outside Band", align: "n", render: (g) => g.below_minimum + g.above_maximum },
    { key: "from", label: "Status", badge: true, render: (g) => (g.effective_from > todayIso() ? <Pill tone="info">{`From ${formatDate(g.effective_from)}`}</Pill> : <Pill tone="ok">In Force</Pill>) },
  ];
  const peopleColumns: DataViewColumn<GradePlacement>[] = [
    { key: "employee", label: "Employee", render: (p) => <Who name={p.employee.display_name} sub={p.employee.department} /> },
    { key: "grade", label: "Grade", render: (p) => p.grade_code ?? "Not Placed" },
    { key: "gross", label: "Monthly Gross", align: "n", desktop: true, render: (p) => amount(p.gross_pay) },
    { key: "split", label: "Pay Split", desktop: true, render: (p) => (p.has_pay_split ? "Set" : "Not Set") },
    { key: "position", label: "Position", badge: true, render: (p) => (p.band_position ? <Pill tone={POSITION[p.band_position].tone}>{POSITION[p.band_position].text}</Pill> : null) },
  ];
  const addGrade = () => modal.open({ title: "Add Grade", body: (close) => <GradeForm close={close} /> });
  return (
    <>
      {banded.length > 0 && (
        <DesktopOnly unmount className="mt-3">
          <BandChart
            title="Bands by Grade"
            scale={`₦0 to ${formatMoneyShort(String(Math.round(top)))}`}
            rows={banded.map((g) => ({
              label: `${g.code} · ${g.name}`,
              sub: `${g.staff} staff`,
              from: at(g.band_minimum),
              middle: (at(g.band_minimum) + at(g.band_maximum)) / 2,
              to: at(g.band_maximum),
              value: `${formatMoneyShort(g.band_minimum!)} to ${formatMoneyShort(g.band_maximum!)}`,
            }))}
          />
        </DesktopOnly>
      )}
      <DataView
        title="Grades"
        list={grades}
        rowKey={(g) => g.salary_grade_id}
        onRowClick={may ? (g) => modal.open({ title: `Grade ${g.code}`, body: (close) => <GradeForm grade={g} close={close} /> }) : undefined}
        noun="grade"
        empty={{ icon: "list", title: "No Grades", text: "Add a grade with its band." }}
        actions={
          may && (
            <Button size="sm" icon="plus" onClick={addGrade}>
              Add Grade
            </Button>
          )
        }
        columns={gradeColumns}
        className="mt-3"
      />
      <Chips
        label="Position"
        value={position}
        onChange={(v) => {
          setPosition(v);
          setPick(null);
        }}
        options={PLACEMENT_CHIPS}
        className="mb-3 mt-3"
      />
      <ListDetail
        open={picked !== null}
        onClose={() => setPick(null)}
        title="Pay Components"
        list={
          <DataView
            title="Pay Components"
            list={people}
            search="Search people"
            rowKey={(p) => p.employee.employee_id}
            onRowClick={(p) => setPick(p.employee.employee_id)}
            selectedKey={shown ? shown.employee.employee_id : null}
            noun="person"
            nounPlural="people"
            empty={{ icon: "check", title: "Nobody Here", text: "Choose All to see everyone." }}
            columns={peopleColumns}
          />
        }
        detail={shown && <PersonCard placement={shown} may={may} />}
      />
    </>
  );
}

type GradeValues = { code: string; name: string; minimum: string; maximum: string; effective_from: string };

/** Add Grade, or a grade's band from a later day: Save Grade. */
function GradeForm({ grade, close }: { grade?: SalaryGrade; close: () => void }) {
  const f = useContractForm<GradeValues>(
    { code: grade?.code ?? "", name: grade?.name ?? "", minimum: grade?.band_minimum ?? "", maximum: grade?.band_maximum ?? "", effective_from: todayIso() },
    salary.SalaryGradeSave,
  );
  const save = useMutation("POST /api/v1/salary-structure/grades");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/salary-structure");
      close();
      toast("Grade saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Grade not saved");
    }
  };
  return (
    <>
      <Field label="Code" {...f.status("code")}>
        <TextField {...f.field("code")} placeholder="G4" />
      </Field>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Lead" />
      </Field>
      <Field label="Minimum" {...f.status("minimum")}>
        <MoneyField {...f.field("minimum")} />
      </Field>
      <Field label="Maximum" {...f.status("maximum")}>
        <MoneyField {...f.field("maximum")} />
      </Field>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Save Grade
        </Button>
      </FormFooter>
    </>
  );
}

/** A person opened: their grade against its band, and their pay split today and from its next day. */
function PersonCard({ placement: p, may }: { placement: GradePlacement; may: boolean }) {
  const modal = useModal();
  const split = useApi("GET /api/v1/salary-structure/employees/:employee_id/components", { params: { employee_id: p.employee.employee_id } });
  const set = split.data;
  const items: Array<[ReactNode, ReactNode]> = [
    ["Grade", p.grade_code ? `${p.grade_code} · ${p.grade_name}` : "Not Placed"],
    ["Position", p.band_position ? <Pill key="pos" tone={POSITION[p.band_position].tone}>{POSITION[p.band_position].text}</Pill> : "Not Placed"],
    ["Monthly Gross", amount(p.gross_pay)],
  ];
  const version = set?.current ?? set?.next ?? null;
  for (const c of version?.components ?? []) items.push([c.label, <span key={c.code}>{amount(c.pay_amount)}{c.pensionable ? " · Pensionable" : ""}</span>]);
  if (set?.next) items.push(["Next Split", formatDate(set.next.effective_from)]);
  return (
    <Card>
      <CardHeader record title={p.employee.display_name} right={p.has_pay_split ? <Pill tone="ok">Split Set</Pill> : <Pill tone="neutral">No Split</Pill>} />
      {split.loading ? <LoadingRows /> : <KeyValue items={items} />}
      {may && (
        <FormFooter>
          <Button onClick={() => modal.open({ title: "Place Person", body: (close) => <PlacementForm placement={p} close={close} /> })}>Place Person</Button>
          {set && (
            <Button variant="primary" onClick={() => modal.open({ title: "Set Pay Components", body: (close) => <ComponentsForm set={set} close={close} /> })}>
              Set Pay Components
            </Button>
          )}
        </FormFooter>
      )}
    </Card>
  );
}

type PlaceValues = { salary_grade_id: string; effective_from: string };

/** Place Person: a grade from a day. The grades come 25 at a time as the menu nears its end (F32). */
function PlacementForm({ placement: p, close }: { placement: GradePlacement; close: () => void }) {
  const grades = useInfinite("GET /api/v1/salary-structure/grades");
  const f = useContractForm<PlaceValues>({ salary_grade_id: p.salary_grade_id ?? "", effective_from: todayIso() }, salary.GradePlacementSave);
  const save = useMutation("PUT /api/v1/salary-structure/placements/:employee_id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { employee_id: p.employee.employee_id }, body: f.values });
      invalidate("/api/v1/salary-structure");
      close();
      toast("Person placed");
    } catch (e) {
      landed(e, f.setServerErrors, "Person not placed");
    }
  };
  return (
    <>
      <Field label="Grade" {...f.status("salary_grade_id")}>
        <SelectField
          options={grades.rows.map((g) => [g.salary_grade_id, `${g.code} · ${g.name}`] as const)}
          {...paging(grades)}
          valueLabel={p.grade_code ?? undefined}
          {...f.field("salary_grade_id")}
        />
      </Field>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Place Person
        </Button>
      </FormFooter>
    </>
  );
}

const MAX_COMPONENTS = 10;
/** An amount the money field holds ("150000.00") in kobo, exactly; nothing for a blank or half-typed one. */
const koboOf = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? BigInt(v.split(".")[0]) * 100n + BigInt((v.split(".")[1] ?? "").padEnd(2, "0")) : 0n);
const toAmount = (k: bigint) => `${k / 100n}.${String(k % 100n).padStart(2, "0")}`;
type SplitValues = Record<string, string>;
/** A component's code from its label: "Housing Allowance" is housing_allowance; the first is always basic. */
const codeOf = (label: string, i: number) => (i === 0 ? "basic" : label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c_$1"));

function splitBody(v: SplitValues, count: number, pensionable: boolean[]) {
  return {
    effective_from: v.effective_from,
    components: Array.from({ length: count }, (_, i) => ({
      code: codeOf(v[`label_${i}`], i),
      label: v[`label_${i}`].trim(),
      amount: v[`amount_${i}`],
      pensionable: pensionable[i] === true,
    })),
  };
}

/** Set Pay Components: the person's monthly gross split into Basic and any others, from a day (§6.11 rule 6). */
function ComponentsForm({ set, close }: { set: PayComponentSet; close: () => void }) {
  const start = set.next ?? set.current;
  const [count, setCount] = useState(Math.max(start?.components.length ?? 1, 1));
  const [pensionable, setPensionable] = useState<boolean[]>(() => Array.from({ length: MAX_COMPONENTS }, (_, i) => start?.components[i]?.pensionable ?? i === 0));
  const initial: SplitValues = { effective_from: todayIso(), components: "" };
  for (let i = 0; i < MAX_COMPONENTS; i += 1) {
    const c = start?.components[i];
    initial[`label_${i}`] = c?.label ?? (i === 0 ? "Basic" : "");
    initial[`amount_${i}`] = c?.pay_amount ?? (i === 0 && !start ? (set.gross_pay ?? "") : "");
  }
  const f = useContractForm<SplitValues>(initial, {
    safeParse: (v: SplitValues) =>
      moved(salary.PayComponentsSave.safeParse(splitBody(v, count, pensionable)) as Parsed, (path) => {
        if (path[0] !== "components") return String(path[0]);
        if (typeof path[1] !== "number") return "components";
        return path[2] === "amount" ? `amount_${path[1]}` : `label_${path[1]}`;
      }),
  });
  const save = useMutation("PUT /api/v1/salary-structure/employees/:employee_id/components");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { employee_id: set.employee.employee_id }, body: splitBody(f.values, count, pensionable) });
      invalidate("/api/v1/salary-structure");
      close();
      toast("Pay components saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Pay components not saved");
    }
  };
  const total = toAmount(Array.from({ length: count }, (_, i) => koboOf(f.values[`amount_${i}`] || "")).reduce((sum, k) => sum + k, 0n));
  const err = f.errors.components;
  return (
    <>
      <KeyValue
        items={[
          [
            <HelpTerm key="g" help={SPLIT_HELP}>
              Monthly Gross
            </HelpTerm>,
            amount(set.gross_pay),
          ],
          ["Components Total", <Money key="t" value={total} />],
        ]}
      />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mb-2">
          {i === 0 ? (
            <Field label="Component 1">
              <TextField value="Basic" onChange={() => undefined} disabled />
            </Field>
          ) : (
            <Field label={`Component ${i + 1}`} {...f.status(`label_${i}`)}>
              <TextField {...f.field(`label_${i}`)} placeholder="Housing" />
            </Field>
          )}
          <Field label="Amount" {...f.status(`amount_${i}`)}>
            <MoneyField {...f.field(`amount_${i}`)} />
          </Field>
          <CheckboxField label="Pensionable" value={pensionable[i] === true} onChange={(v) => setPensionable((all) => all.map((x, j) => (j === i ? v : x)))} />
        </div>
      ))}
      <Inline gap={2} className="mb-3 flex-wrap">
        {count < MAX_COMPONENTS && <Button size="sm" icon="plus" onClick={() => setCount(count + 1)}>Add Component</Button>}
        {count > 1 && <Button size="sm" onClick={() => setCount(count - 1)}>Remove Component</Button>}
      </Inline>
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      {err && <FormError>{err}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Save Components
        </Button>
      </FormFooter>
    </>
  );
}

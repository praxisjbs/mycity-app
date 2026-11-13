import payroll from "@mycity/contract/schemas/payroll.js";
import salary from "@mycity/contract/schemas/salary_structure.js";
import statutory from "@mycity/contract/schemas/statutory.js";
import type { GradePlacement, PayComponentSet, PayrollSettings, SalaryGrade, StatutoryItemState, StatutoryRate, StatutorySource } from "@mycity/contract/contract.gen.ts";
import { type ReactNode, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
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
  FileRow,
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
  TextAreaField,
  TextField,
  toast,
  todayIso,
  toMoneyString,
  UploadField,
  useConfirm,
  useContractForm,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";

/**
 * Payroll · Configurations (docs/guides/payroll.md §2, §3.5, §6.11, §6.12, §10): how MyCity is paid. Always: the Pay Day,
 * Bank Details Required, the Advanced Payroll switch, the Statutory Items and the PAYE Bands, so the first figures are
 * entered before the option is first switched on (§13.1 item 25). Once the option is on or has been: the salary grades
 * with who sits outside their band, and each person's pay split and Pay to Date. The accountant's conventions left the
 * screen in PR 11: the law settles them, so the engine fixes them (§6.12 rule 14).
 *
 * Every change is a version from today or later, made by someone holding `payroll.configure`; the screen hides the
 * controls from anyone else (the API still decides). A change still waiting for its day can be taken back (Remove
 * Change); one in force is replaced by a new version. Every statutory version names its legal source, or No Legal
 * Source with the reason (§6.12 rule 12). Every deduction is monthly, so nothing here offers a PAYE Basis (§6.12 rule
 * 11). Nothing here is hard-coded data: every rate, band, cap, wage and grade is one MyCity entered. The words of the
 * eight items and their bases are the code's, not figures.
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
  rent_relief: "Rent Relief",
  minimum_wage: "Minimum Wage",
};
const BASE_WORDS: Record<Base, string> = {
  gross: "Gross Pay",
  pensionable: "Pensionable Pay",
  basic: "Basic Pay",
  taxable: "Taxable Pay",
  annual_payroll: "Payroll",
  rent: "Year's Rent",
};

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
const PAY_DAY_HELP = "30 unless changed. A day past a month's end is its last day.";
const BANDS_HELP = "Enter the bands as the law publishes them. Each is taken monthly.";
/**
 * Who the items reach (tier 2, §10.1): a threshold about MyCity itself is not computed, so MyCity enters an item only while
 * it is liable (Pension Reform Act 2014, s.120 as PenCom applies it; ITF Act s.6(1)).
 */
const ITEMS_HELP = "Enter an item only while it applies to MyCity: pension from three employees, ITF from 25. No PAYE at or below the minimum wage.";
const SOURCE_HELP = "The law a figure comes from. No Legal Source when none.";
const SPLIT_HELP = "The components add up to the monthly gross.";
const PRIOR_HELP = "This year's taxable pay and tax before MyCity's first statutory month, from a leaving certificate or earlier months.";

const failed = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);
const pct = (rate: string | null) => (rate === null ? "" : `${rate}%`);
/** The pay day stored as 31 is the month's last day, whatever its length (§6.11 rule 1). */
const LAST_DAY = 31;
const payDayWords = (day: number) => (day === LAST_DAY ? "Last Day of Month" : String(day));
const DAYS: Array<readonly [string, string]> = [
  ...Array.from({ length: LAST_DAY - 1 }, (_, i) => [String(i + 1), String(i + 1)] as const),
  [String(LAST_DAY), "Last Day of Month"],
];
/** A version's source as a row reads it: the instrument and section, or No Legal Source. */
const sourceWords = (v: StatutorySource | null | undefined) => (!v ? "" : v.no_legal_source ? "No Legal Source" : [v.source_title, v.source_section].filter(Boolean).join(", "));
const SOURCE_LABEL = <HelpTerm help={SOURCE_HELP}>Source</HelpTerm>;

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
      <PayeBands may={may} />
      {shown && <Structure may={may} />}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Payroll Options: the pay day, the bank rule and the advanced switch
 * ------------------------------------------------------------------ */

function OptionsCard({ settings: s, may }: { settings: PayrollSettings; may: boolean }) {
  const modal = useModal();
  const confirm = useConfirm();
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const drop = useMutation("DELETE /api/v1/payroll/settings/versions/:effective_from");
  const next = s.next;
  /** Remove Change: the version of the setting waiting for its day comes off, and today's runs on (§5). */
  const removeChange = async () => {
    if (!next) return;
    const day = formatDate(next.effective_from);
    if (!(await confirm({ title: "Remove Change", body: `The change from ${day} comes off. Today's setting stays.`, confirmLabel: "Remove Change", cancelLabel: "Keep Change", destructive: true }))) return;
    try {
      await drop.run({ params: { effective_from: next.effective_from } });
      invalidate("/api/v1/payroll/settings");
      toast("Change removed");
    } catch (e) {
      failed(e, "Change not removed");
    }
  };
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
    modal.open({ title: advanced ? "Switch Off Advanced Payroll" : "Switch On Advanced Payroll", body: (close) => <AdvancedForm on={!advanced} close={close} /> });
  const advancedState =
    next && next.advanced_enabled !== s.advanced_enabled ? (
      <Pill tone="info">{`${next.advanced_enabled ? "On" : "Off"} from ${formatDate(next.effective_from)}`}</Pill>
    ) : (
      <Pill tone={s.advanced_enabled ? "ok" : "neutral"}>{s.advanced_enabled ? "On" : "Off"}</Pill>
    );
  return (
    <Card>
      <CardHeader
        title="Payroll Options"
        actions={
          may &&
          next && (
            <Button size="sm" variant="danger" icon="trash" onClick={removeChange}>
              Remove Change
            </Button>
          )
        }
      />
      <KeyValue
        items={[
          [
            <HelpTerm key="pd" help={PAY_DAY_HELP}>
              Pay Day
            </HelpTerm>,
            <Inline key="pdv" gap={2} className="flex-wrap">
              <span>{s.pay_day_is_default ? `${s.pay_day} (default)` : payDayWords(s.pay_day)}</span>
              {nextPayDay && nextPayDay.pay_day !== null && <Pill tone="info">{`${payDayWords(nextPayDay.pay_day)} from ${formatDate(nextPayDay.effective_from)}`}</Pill>}
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

/** Switch On or Switch Off, from a date: §10.3, amendment 2. Nothing else is asked: the law settles the conventions. */
function AdvancedForm({ on, close }: { on: boolean; close: () => void }) {
  const f = useContractForm<{ effective_from: string }>(
    { effective_from: todayIso() },
    { safeParse: (v: { effective_from: string }) => payroll.PayrollSettingsChange.safeParse({ effective_from: v.effective_from, advanced_enabled: on }) },
  );
  const patch = useMutation("PATCH /api/v1/payroll/settings");
  const save = async () => {
    if (!f.check()) return;
    try {
      await patch.run({ body: { effective_from: f.values.effective_from, advanced_enabled: on } });
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

/** What an item's figure reads as: a percentage, rent relief's rate and cap, the minimum wage, or how many PAYE bands. */
function rateOf(i: StatutoryItemState) {
  const v = i.current ?? i.next;
  if (!v) return "";
  if (i.item === "paye") return v.bands === 1 ? "1 band" : `${v.bands} bands`;
  if (i.item === "minimum_wage") return v.flat_amount ? formatMoney(v.flat_amount) : "";
  if (i.item === "rent_relief") return [pct(v.rate), v.flat_amount ? `cap ${formatMoney(v.flat_amount)}` : null].filter(Boolean).join(", ");
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
    { key: "rate", label: "Figure", render: rateOf },
    { key: "base", label: "Base", desktop: true, render: (i) => BASE_WORDS[(i.current ?? i.next)?.base ?? i.bases[0]] },
    { key: "source", label: SOURCE_LABEL, render: (i) => sourceWords(i.current ?? i.next) },
    { key: "status", label: "Status", badge: true, render: itemStatus },
  ];
  return (
    <DataView
      title="Statutory Items"
      help={ITEMS_HELP}
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

function PayeBands({ may }: { may: boolean }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/statutory/rates", { filters: { item: "paye" } });
  const columns: DataViewColumn<StatutoryRate>[] = [
    { key: "band", label: "Band", render: (r) => <span className="font-semibold">{`Band ${r.position ?? ""}`}</span> },
    { key: "from", label: "From", align: "n", render: (r) => <Money value={r.band_from ?? "0.00"} /> },
    { key: "to", label: "To", align: "n", render: (r) => (r.band_to ? <Money value={r.band_to} /> : "No Limit") },
    { key: "rate", label: "Rate", align: "n", render: (r) => pct(r.rate) },
    { key: "source", label: SOURCE_LABEL, render: sourceWords },
    { key: "applies", label: "Status", badge: true, render: bandStatus },
  ];
  return (
    <DataView
      title="PAYE Bands"
      help={BANDS_HELP}
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

/* A version's legal source (§6.12 rule 12): the instrument, or No Legal Source with the reason. */

type SourceValues = { source_title: string; source_section: string; source_url: string; source_checked_on: string; no_source_reason: string };
type Held = { id: string; name: string } | null;

/**
 * The source fields as a new version starts them: the instrument and link of the version it follows, since one law often
 * serves many, but never the day checked, which the person reads again and enters.
 */
const sourceStart = (v: StatutorySource | null | undefined): SourceValues => ({
  source_title: v?.source_title ?? "",
  source_section: v?.source_section ?? "",
  source_url: v?.source_url ?? "",
  source_checked_on: "",
  no_source_reason: v?.no_source_reason ?? "",
});

/** The part of the body the source fields make: the instrument, or No Legal Source with its reason. */
function sourceBody(v: SourceValues, noLegal: boolean, held: Held) {
  if (noLegal) return { no_legal_source: true as const, ...(v.no_source_reason.trim() && { no_source_reason: v.no_source_reason }) };
  return {
    ...(v.source_title.trim() && { source_title: v.source_title }),
    ...(v.source_section.trim() && { source_section: v.source_section }),
    ...(v.source_url.trim() && { source_url: v.source_url.trim() }),
    ...(held && { source_document_id: held.id }),
    ...(v.source_checked_on && { source_checked_on: v.source_checked_on }),
  };
}

/** What the source fields need of a form, whichever form holds them (Save Rate's or Set Bands'). */
type SourceBinding = ReturnType<typeof useContractForm<SourceValues>>;
type SourceForm = {
  status: (k: keyof SourceValues) => ReturnType<SourceBinding["status"]>;
  field: (k: keyof SourceValues) => ReturnType<SourceBinding["field"]>;
};

/** No Legal Source, then the instrument's fields or, ticked, the reason in their place. */
function SourceFields({ f, noLegal, setNoLegal, held, setHeld }: { f: SourceForm; noLegal: boolean; setNoLegal: (v: boolean) => void; held: Held; setHeld: (v: Held) => void }) {
  return (
    <>
      <CheckboxField label="No Legal Source" value={noLegal} onChange={setNoLegal} />
      {noLegal ? (
        <Field label="Reason" {...f.status("no_source_reason")}>
          <TextAreaField rows={2} {...f.field("no_source_reason")} />
        </Field>
      ) : (
        <>
          <Field label="Source" {...f.status("source_title")}>
            <TextField {...f.field("source_title")} />
          </Field>
          <Field label="Section" {...f.status("source_section")}>
            <TextField {...f.field("source_section")} />
          </Field>
          <Field label="Link" optional {...f.status("source_url")}>
            <TextField {...f.field("source_url")} placeholder="https://" />
          </Field>
          <Field label="Document" optional>
            {held ? (
              <FileRow
                name={held.name}
                action={
                  <Button size="sm" onClick={() => setHeld(null)}>
                    Replace File
                  </Button>
                }
              />
            ) : (
              <UploadField
                upload={upload}
                purpose="document"
                accept=".pdf,image/*"
                multiple={false}
                compact
                onUploaded={(docs) => setHeld(docs[0] ? { id: docs[0].document_id, name: docs[0].file_name } : null)}
              />
            )}
          </Field>
          <Field label="Checked On" {...f.status("source_checked_on")}>
            <DateField {...f.field("source_checked_on")} max={todayIso()} />
          </Field>
        </>
      )}
    </>
  );
}

/** The instrument a waiting or current version holds, as the Document field shows it before anything is uploaded. */
const heldOf = (v: StatutorySource | null | undefined): Held => (v?.source_document_id ? { id: v.source_document_id, name: "Document on File" } : null);

/** Remove Change: the version still waiting for its day comes off, and the one before it stays in force (§5). */
function useRemoveChange(item: StatutoryItemState["item"], close: () => void) {
  const confirm = useConfirm();
  const drop = useMutation("DELETE /api/v1/statutory/rates/:item/versions/:effective_from");
  return async (from: string) => {
    if (!(await confirm({ title: "Remove Change", body: `${ITEM_WORDS[item]} from ${formatDate(from)} comes off. The one before stays.`, confirmLabel: "Remove Change", cancelLabel: "Keep Change", destructive: true }))) return;
    try {
      await drop.run({ params: { item, effective_from: from } });
      invalidate("/api/v1/statutory");
      close();
      toast("Change removed");
    } catch (e) {
      failed(e, "Change not removed");
    }
  };
}

type RateValues = SourceValues & { rate: string; flat_amount: string; base: string; effective_from: string };

/**
 * Set one item's figure from a day, with its source: Save Rate. Rent relief takes its rate and its cap; the minimum wage
 * a month's amount and no rate; every other item one rate (§6.12 rule 7).
 */
function RateForm({ state: i, close }: { state: StatutoryItemState; close: () => void }) {
  const latest = i.next ?? i.current;
  const [noLegal, setNoLegal] = useState(latest?.no_legal_source === true);
  const [held, setHeld] = useState<Held>(heldOf(latest));
  const amountItem = i.item === "rent_relief" || i.item === "minimum_wage";
  const rated = i.item !== "minimum_wage";
  const body = (v: RateValues) => ({
    item: i.item,
    effective_from: v.effective_from,
    ...(v.base && v.base !== i.bases[0] && { base: v.base as Base }),
    ...(rated && v.rate !== "" && { rate: v.rate }),
    ...(amountItem && v.flat_amount !== "" && { flat_amount: toMoneyString(v.flat_amount) }),
    ...sourceBody(v, noLegal, held),
  });
  const f = useContractForm<RateValues>(
    {
      rate: latest?.rate && latest.rate !== "0" ? latest.rate : "",
      flat_amount: latest?.flat_amount ?? "",
      base: latest?.base ?? i.bases[0],
      effective_from: todayIso(),
      ...sourceStart(latest),
    },
    { safeParse: (v: RateValues) => statutory.StatutoryRatesSave.safeParse(body(v)) },
  );
  const save = useMutation("POST /api/v1/statutory/rates");
  const removeChange = useRemoveChange(i.item, close);
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
      {rated && (
        <Field label="Rate" {...f.status("rate")}>
          <NumberField decimal {...f.field("rate")} placeholder="7.5" />
        </Field>
      )}
      {amountItem && (
        <Field label={i.item === "minimum_wage" ? "Monthly Amount" : "Cap a Year"} {...f.status("flat_amount")}>
          <MoneyField {...f.field("flat_amount")} />
        </Field>
      )}
      {i.bases.length > 1 && (
        <Field label="Base" {...f.status("base")}>
          <ChoiceField options={i.bases.map((b) => [b, BASE_WORDS[b]] as const)} {...f.field("base")} />
        </Field>
      )}
      <Field label="Effective From" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <SourceFields f={f} noLegal={noLegal} setNoLegal={setNoLegal} held={held} setHeld={setHeld} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {i.next && (
          <Button variant="danger" onClick={() => removeChange(i.next!.effective_from)}>
            Remove Change
          </Button>
        )}
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
function bandsBody(v: BandValues, count: number, noLegal: boolean, held: Held) {
  return {
    item: "paye" as const,
    effective_from: v.effective_from,
    bands: Array.from({ length: count }, (_, i) => ({
      band_from: i === 0 ? "0.00" : toMoneyString(v[`to_${i - 1}`] ?? ""),
      band_to: v[`to_${i}`] ? toMoneyString(v[`to_${i}`]) : null,
      rate: v[`rate_${i}`],
    })),
    ...sourceBody(v as SourceValues, noLegal, held),
  };
}

/** Set PAYE Bands: the whole table from a day, each band's upper limit and rate, and its source (§6.12). */
function BandsForm({ close }: { close: () => void }) {
  const today = useApi("GET /api/v1/statutory/rates", { query: { item: "paye" } });
  if (today.loading) return <LoadingRows />;
  const rows = today.data?.data ?? [];
  const latestDay = rows.reduce((d, r) => (r.effective_from > d ? r.effective_from : d), "");
  const latest = rows.filter((r) => r.effective_from === latestDay).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  // The table still waiting for its day, the first one after today: what Remove Change takes back.
  const waiting = rows.filter((r) => r.effective_from > todayIso()).reduce<string | null>((d, r) => (d === null || r.effective_from < d ? r.effective_from : d), null);
  return <BandsFields initial={latest} waiting={waiting} close={close} />;
}

function BandsFields({ initial, waiting, close }: { initial: StatutoryRate[]; waiting: string | null; close: () => void }) {
  const [count, setCount] = useState(Math.max(initial.length, 1));
  const [noLegal, setNoLegal] = useState(initial[0]?.no_legal_source === true);
  const [held, setHeld] = useState<Held>(heldOf(initial[0]));
  const start: BandValues = { effective_from: todayIso(), ...sourceStart(initial[0]) };
  for (let i = 0; i < MAX_BANDS; i += 1) {
    start[`to_${i}`] = initial[i]?.band_to ?? "";
    start[`rate_${i}`] = initial[i]?.rate ?? "";
  }
  const f = useContractForm<BandValues>(start, {
    safeParse: (v: BandValues) =>
      moved(statutory.StatutoryRatesSave.safeParse(bandsBody(v, count, noLegal, held)) as Parsed, (path) => {
        if (path[0] !== "bands" || typeof path[1] !== "number") return String(path[0] ?? "to_0") === "bands" ? "to_0" : String(path[0]);
        const i = path[1];
        if (path[2] === "rate") return `rate_${i}`;
        if (path[2] === "band_from") return `to_${Math.max(i - 1, 0)}`;
        return `to_${i}`;
      }),
  });
  const save = useMutation("POST /api/v1/statutory/rates");
  const removeChange = useRemoveChange("paye", close);
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: bandsBody(f.values, count, noLegal, held) });
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
      <SourceFields f={f} noLegal={noLegal} setNoLegal={setNoLegal} held={held} setHeld={setHeld} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {waiting && (
          <Button variant="danger" onClick={() => removeChange(waiting)}>
            Remove Change
          </Button>
        )}
        <Button variant="primary" onClick={submit}>
          Save Bands
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
/** A grade as the API takes it: the band's two ends as two-place amounts, whatever was typed. */
const gradeBody = (v: GradeValues) => ({ ...v, minimum: toMoneyString(v.minimum), maximum: toMoneyString(v.maximum) });

/** Add Grade, or a grade's band from a later day: Save Grade. */
function GradeForm({ grade, close }: { grade?: SalaryGrade; close: () => void }) {
  const f = useContractForm<GradeValues>(
    { code: grade?.code ?? "", name: grade?.name ?? "", minimum: grade?.band_minimum ?? "", maximum: grade?.band_maximum ?? "", effective_from: todayIso() },
    { safeParse: (v: GradeValues) => salary.SalaryGradeSave.safeParse(gradeBody(v)) },
  );
  const save = useMutation("POST /api/v1/salary-structure/grades");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: gradeBody(f.values) });
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
  // The year's pay and tax before MyCity's first statutory month (§13.1 item 42): where the person's PAYE year starts.
  const prior = usePrior(p.employee.employee_id);
  if (prior.entry) {
    items.push([<HelpTerm key="prior" help={PRIOR_HELP}>{`Prior Pay ${prior.entry.year}`}</HelpTerm>, amount(prior.entry.taxable_pay)]);
    items.push([`Prior Tax ${prior.entry.year}`, amount(prior.entry.tax_paid)]);
  } else items.push([<HelpTerm key="prior" help={PRIOR_HELP}>Prior Pay</HelpTerm>, "None"]);
  return (
    <Card>
      <CardHeader record title={p.employee.display_name} right={p.has_pay_split ? <Pill tone="ok">Split Set</Pill> : <Pill tone="neutral">No Split</Pill>} />
      {split.loading ? <LoadingRows /> : <KeyValue items={items} />}
      {may && (
        <FormFooter>
          <Button onClick={() => modal.open({ title: "Place Person", body: (close) => <PlacementForm placement={p} close={close} /> })}>Place Person</Button>
          <Button onClick={() => modal.open({ title: "Set Prior Pay", body: (close) => <PriorPayForm employeeId={p.employee.employee_id} entry={prior.entry} close={close} /> })}>
            Set Prior Pay
          </Button>
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

type PriorEntry = { year: number; taxable_pay: string | null; tax_paid: string | null; document_id: string | null };

/** This year's Pay to Date of one person, or null: the newest of their years (GET …/pay-to-date, newest first). */
function usePrior(employeeId: string) {
  const list = useApi("GET /api/v1/statutory/employees/:employee_id/pay-to-date", { params: { employee_id: employeeId } });
  const year = Number(todayIso().slice(0, 4));
  const entry: PriorEntry | null = (list.data?.data ?? []).find((r) => r.year === year) ?? null;
  return { entry, loading: list.loading };
}

type PriorValues = { year: string; taxable_pay: string; tax_paid: string };

/**
 * Set Prior Pay (§13.1 item 42): this year's or next year's taxable pay and tax before MyCity's first statutory month,
 * from a previous employer's leaving certificate (Operation of PAYE Regulations 2002, reg 5) or MyCity's own months before
 * the option was on. The certificate goes through the upload engine. A person with none starts the year at nothing.
 */
function PriorPayForm({ employeeId, entry, close }: { employeeId: string; entry: PriorEntry | null; close: () => void }) {
  const confirm = useConfirm();
  const thisYear = Number(todayIso().slice(0, 4));
  const years: Array<readonly [string, string]> = [thisYear, thisYear + 1].map((y) => [String(y), String(y)] as const);
  const [held, setHeld] = useState<Held>(entry?.document_id ? { id: entry.document_id, name: "Certificate on File" } : null);
  const body = (v: PriorValues) => ({
    taxable_pay: v.taxable_pay === "" ? "" : toMoneyString(v.taxable_pay),
    tax_paid: v.tax_paid === "" ? "" : toMoneyString(v.tax_paid),
    ...(held && { document_id: held.id }),
  });
  const f = useContractForm<PriorValues>(
    { year: String(entry?.year ?? thisYear), taxable_pay: entry?.taxable_pay ?? "", tax_paid: entry?.tax_paid ?? "" },
    { safeParse: (v: PriorValues) => statutory.PayToDateSave.safeParse(body(v)) },
  );
  const save = useMutation("PUT /api/v1/statutory/employees/:employee_id/pay-to-date/:year");
  const drop = useMutation("DELETE /api/v1/statutory/employees/:employee_id/pay-to-date/:year");
  const params = () => ({ employee_id: employeeId, year: Number(f.values.year) });
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: params(), body: body(f.values) });
      invalidate("/api/v1/statutory/employees");
      close();
      toast("Prior pay saved");
    } catch (e) {
      landed(e, f.setServerErrors, "Prior pay not saved");
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Remove Prior Pay", body: `${f.values.year} starts at nothing for this person.`, confirmLabel: "Remove Prior Pay", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await drop.run({ params: params() });
      invalidate("/api/v1/statutory/employees");
      close();
      toast("Prior pay removed");
    } catch (e) {
      failed(e, "Prior pay not removed");
    }
  };
  return (
    <>
      <Field label="Year" {...f.status("year")}>
        <SelectField options={years} {...f.field("year")} />
      </Field>
      <Field label="Taxable Pay" {...f.status("taxable_pay")}>
        <MoneyField {...f.field("taxable_pay")} />
      </Field>
      <Field label="Tax Paid" {...f.status("tax_paid")}>
        <MoneyField {...f.field("tax_paid")} />
      </Field>
      <Field label="Certificate" optional>
        {held ? (
          <FileRow
            name={held.name}
            action={
              <Button size="sm" onClick={() => setHeld(null)}>
                Replace File
              </Button>
            }
          />
        ) : (
          <UploadField
            upload={upload}
            purpose="document"
            accept=".pdf,image/*"
            multiple={false}
            compact
            onUploaded={(docs) => setHeld(docs[0] ? { id: docs[0].document_id, name: docs[0].file_name } : null)}
          />
        )}
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {entry && (
          <Button variant="danger" onClick={remove}>
            Remove Prior Pay
          </Button>
        )}
        <Button variant="primary" onClick={submit}>
          Save Prior Pay
        </Button>
      </FormFooter>
    </>
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
      amount: toMoneyString(v[`amount_${i}`] ?? ""),
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

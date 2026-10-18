import alerts from "@mycity/contract/schemas/alerts.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeAlert, HomeAlertQuery, HomeAlertSummary } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  Chips,
  content,
  DataView,
  DesktopOnly,
  EmptyState,
  ErrorState,
  formatCount,
  formatDateTime,
  Grow,
  HelpTerm,
  KeyValue,
  KpiCard,
  KpiGrid,
  LoadingRows,
  ModalFooter,
  PageHeader,
  Pill,
  toast,
  useModal,
  type DataViewColumn,
  type KeyValueItem,
} from "@mycity/ui";
import { useRuleForms } from "./AlertRules";
import { ageOf, ALERT_CATEGORY, isMetric, OVER_BY_HELP, overByDetail, overByText, SEVERITY, sourceRows } from "./labels";

/**
 * Home · Alerts (#2, docs/guides/home.md §10): the open alerts the reader may see (the rules
 * whose grant they hold, about people in their scope), the four counts, the category chips,
 * Alert Sources over 30 days, and the dismissed list. Every figure is the server's
 * (GET /home/alerts/summary, /home/alerts); the screen words it and recomputes nothing.
 * The tab needs `alerts.clear` or `alerts.manage`; ./index.tsx shows the lock to anyone else.
 *
 * An alert opens as a sheet (a bottom sheet on a phone): its trigger, who can clear it, its age
 * and Over By, with Clear Alert and Dismiss Alert where `can_clear` says clearing will work, and
 * Edit Rule for a holder of `alerts.manage`. The rules themselves are ./AlertRules.
 *
 * The two shells (§10.2): on desktop the list is a table with Trigger and Age, and Alert Sources
 * sits under it; on a phone the cards are two to a row, each alert is a card with its severity,
 * Who Can Clear and Over By, and Trigger and Age wait in its sheet.
 *
 * Links: `?id=<alert>` opens that alert once it is read, and closing it takes the link out of
 * the address; `?rule=<rule>` (⌘K's Alert Rules) opens Edit Rule for a holder of
 * `alerts.manage` the same way, or Alert Rules for a rule on a metric no longer listed, and
 * anyone else just loses the link; `?category=<category>` is
 * the chip in force; `?action=new` opens New Rule.
 */

export type AlertView = "open" | "dismissed";

/** The list's filters as the API takes them (HomeAlertQuery): the open alerts, of one category or all; or the dismissed. */
export function alertFilters(view: AlertView, category: string | null): Pick<HomeAlertQuery, "category" | "state"> {
  if (view === "dismissed") return { state: "dismissed" };
  return category ? { category } : {};
}

/**
 * Age is how long an alert has been open, so it runs the other way to `raised_at`: Age going up
 * (the youngest first) asks the server for `raised_at` going down. Every other column's key is
 * the server's own field.
 */
const AGE_SORT: Record<string, string> = { age: "-raised_at", "-age": "raised_at" };
const COLUMN_SORT: Record<string, string> = Object.fromEntries(Object.entries(AGE_SORT).map(([column, server]) => [server, column]));

/** The sort the list sends (HomeAlertQuery), from the one the columns show. */
export const serverSort = (sort: string | undefined) => (sort === undefined ? undefined : (AGE_SORT[sort] ?? sort));
/** The sort the columns show, from the one the list sends. */
export const columnSort = (sort: string | undefined) => (sort === undefined ? undefined : (COLUMN_SORT[sort] ?? sort));

/** The category an address names (`?category=`), when the contract has it. */
export const categoryOf = (value: string | null): string | null => (value !== null && alerts.HOME_ALERT_CATEGORIES.includes(value) ? value : null);

/**
 * The chips: All, then each category with open alerts, in the contract's order, with its
 * count. A category the address asks for keeps its chip at 0, so the person sees what the list
 * is narrowed to.
 */
export function categoryChips(summary: Pick<HomeAlertSummary, "open" | "categories">, selected: string | null) {
  const counts = new Map(summary.categories.map((c) => [c.category, c.count]));
  const shown = alerts.HOME_ALERT_CATEGORIES.filter((c) => counts.has(c) || c === selected);
  return [{ value: "all", label: "All", count: summary.open }, ...shown.map((c) => ({ value: c, label: ALERT_CATEGORY[c], count: counts.get(c) ?? 0 }))];
}

/**
 * What an alert's sheet offers: Clear Alert and Dismiss Alert where clearing will work
 * (`can_clear`: open, `alerts.clear`, and the rule's grant over its subject), and Edit Rule to a
 * holder of `alerts.manage` for a rule on a metric still listed.
 */
export function sheetActions(alert: Pick<HomeAlert, "can_clear" | "metric">, manage: boolean) {
  return { editRule: manage && isMetric(alert.metric), clear: alert.can_clear };
}

const severityPill = (a: Pick<HomeAlert, "severity">) => <Pill tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].text}</Pill>;

/** The open list: Trigger and Age are desktop's, in the alert's sheet on a phone. */
const OPEN_COLUMNS: DataViewColumn<HomeAlert>[] = [
  { key: "title", label: "Alert", render: (a) => a.title },
  { key: "trigger", label: "Trigger", desktop: true, render: (a) => a.trigger },
  { key: "who_can_clear", label: "Who Can Clear", render: (a) => a.who_can_clear },
  { key: "age", label: "Age", sortable: true, desktop: true, render: (a) => ageOf(a.raised_at) },
  { key: "over_by", label: <HelpTerm help={OVER_BY_HELP}>Over By</HelpTerm>, render: (a) => overByText(a) },
  { key: "severity", label: "Severity", sortable: true, render: severityPill },
];

/** The dismissed list: when and by whom, in place of the age and how far past its rule. */
const DISMISSED_COLUMNS: DataViewColumn<HomeAlert>[] = [
  { key: "title", label: "Alert", render: (a) => a.title },
  { key: "trigger", label: "Trigger", desktop: true, render: (a) => a.trigger },
  { key: "cleared_at", label: "Dismissed", render: (a) => formatDateTime(a.cleared_at) },
  { key: "cleared_by_name", label: "Dismissed By", render: (a) => a.cleared_by_name },
  { key: "severity", label: "Severity", sortable: true, render: severityPill },
];

export function Alerts({ linked }: { linked: string | null }) {
  const me = useMe();
  const modal = useModal();
  const rules = useRuleForms();
  const manage = hasCapability(me, "alerts.manage");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<AlertView>("open");
  const category = categoryOf(params.get("category"));

  const summary = useApi("GET /api/v1/home/alerts/summary");
  const paged = usePaged("GET /api/v1/home/alerts", { filters: alertFilters(view, category) });
  const list = { ...paged, sort: columnSort(paged.sort), setSort: (sort: string | undefined) => paged.setSort(serverSort(sort)) };

  useScreenAction(manage ? { label: "New Rule", onSelect: rules.openNew } : null);

  /** Opens an alert; `done` runs once the person is finished with it, however they leave it. */
  const openAlert = useCallback(
    (alert: HomeAlert, done?: () => void) =>
      modal.open({
        title: <span {...content}>{alert.title}</span>,
        onClose: done,
        body: (close) => (
          <AlertSheet
            alert={alert}
            manage={manage}
            close={close}
            onEditRule={() => {
              // Edit Rule takes the sheet's place, so the sheet's own close never runs.
              done?.();
              rules.openEdit(alert.home_alert_rule_id);
            }}
          />
        ),
      }),
    [modal, manage, rules],
  );

  /* A link to one alert opens it once it is read; closing it takes the link out of the address. */
  const target = useApi("GET /api/v1/home/alerts/:id", { params: { id: linked ?? "" }, enabled: linked !== null });
  const shown = useRef<string | null>(null);
  const unlink = useRef<() => void>(() => undefined);
  unlink.current = () => setParams({ id: null }, { replace: true });
  useEffect(() => {
    if (linked === null) {
      shown.current = null;
      return;
    }
    if (shown.current === linked) return;
    if (target.data?.home_alert_id === linked) {
      shown.current = linked;
      openAlert(target.data, () => unlink.current());
    } else if (target.error) {
      shown.current = linked;
      unlink.current();
      toast.error("Alert not found");
    }
  }, [linked, target.data, target.error, openAlert]);

  /*
   * A link to a rule opens Edit Rule for a holder of alerts.manage once the rule is read, and
   * closing it takes the link out of the address. A rule on a metric no longer listed is not
   * offered Edit Rule, here as in Alert Rules, so its link opens Alert Rules and leaves the
   * address. A rule that cannot be read opens Edit Rule on its error. Anyone else loses the link.
   */
  const ruleLinked = params.get("rule");
  const ruleTarget = useApi("GET /api/v1/home/alert-rules/:id", { params: { id: ruleLinked ?? "" }, enabled: manage && ruleLinked !== null });
  const ruleShown = useRef<string | null>(null);
  const unlinkRule = useRef<() => void>(() => undefined);
  unlinkRule.current = () => setParams({ rule: null }, { replace: true });
  useEffect(() => {
    if (ruleLinked === null) {
      ruleShown.current = null;
      return;
    }
    if (ruleShown.current === ruleLinked) return;
    if (!manage) {
      ruleShown.current = ruleLinked;
      unlinkRule.current();
      return;
    }
    const rule = ruleTarget.data?.home_alert_rule_id === ruleLinked ? ruleTarget.data : null;
    if (rule === null && !ruleTarget.error) return;
    ruleShown.current = ruleLinked;
    if (rule !== null && !isMetric(rule.metric)) {
      unlinkRule.current();
      rules.openList();
    } else rules.openEdit(ruleLinked, () => unlinkRule.current());
  }, [ruleLinked, manage, rules, ruleTarget.data, ruleTarget.error]);

  const pickCategory = (value: string) => setParams({ category: value === "all" ? null : value }, { replace: true });
  const open = view === "open";

  return (
    <>
      <PageHeader
        title="Alerts"
        actions={
          <>
            <Button onClick={() => setView(open ? "dismissed" : "open")}>{open ? "View Dismissed" : "View Open"}</Button>
            {manage && <Button onClick={rules.openList}>Alert Rules</Button>}
            {manage && (
              <Button variant="primary" icon="plus" onClick={rules.openNew}>
                New Rule
              </Button>
            )}
          </>
        }
      />
      {summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : summary.data ? (
        <AlertCounts summary={summary.data} />
      ) : (
        <LoadingRows count={2} />
      )}
      {open && summary.data && <Chips label="Category" value={category ?? "all"} onChange={pickCategory} options={categoryChips(summary.data, category)} />}
      <DataView
        title={open ? "Open Alerts" : "Dismissed Alerts"}
        list={list}
        rowKey={(a) => a.home_alert_id}
        onRowClick={(a) => openAlert(a)}
        noun="alert"
        columns={open ? OPEN_COLUMNS : DISMISSED_COLUMNS}
        empty={open ? (category ? { icon: "srch", title: "No Alerts Here", text: "Try another category." } : { title: "No Open Alerts" }) : { title: "Nothing Dismissed" }}
      />
      {summary.data && (
        <DesktopOnly unmount className="mt-3">
          <AlertSources sources={summary.data.sources} />
        </DesktopOnly>
      )}
    </>
  );
}

/** The four counts over the alerts the reader may see; two to a row on a phone (KpiGrid). */
function AlertCounts({ summary }: { summary: HomeAlertSummary }) {
  const toned = (n: number, tone: "warn" | "err" | "ok") => (n > 0 ? tone : undefined);
  return (
    <KpiGrid>
      <KpiCard title="Open Alerts" value={formatCount(summary.open)} />
      <KpiCard title="Needs You" value={formatCount(summary.needs_you)} tone={toned(summary.needs_you, "warn")} />
      <KpiCard title="Overdue 7 Days +" value={formatCount(summary.overdue)} tone={toned(summary.overdue, "err")} />
      <KpiCard title="Cleared This Week" value={formatCount(summary.cleared_this_week)} tone={toned(summary.cleared_this_week, "ok")} />
    </KpiGrid>
  );
}

/** Alerts raised in the last 30 days by metric, cleared ones included; the longest bar is the most. Desktop only. */
function AlertSources({ sources }: { sources: HomeAlertSummary["sources"] }) {
  const rows = sourceRows(sources);
  const most = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader title="Alert Sources, 30 Days" />
      {rows.length > 0 ? (
        <Bars rows={rows.map((r) => ({ label: r.label, percent: Math.round((r.count / most) * 100), value: formatCount(r.count) }))} />
      ) : (
        <EmptyState bare title="Nothing Raised" />
      )}
    </Card>
  );
}

type Outcome = "cleared" | "dismissed";

/** One alert, opened: what raised it and where it stands, and what the reader may do about it. */
function AlertSheet({ alert, manage, close, onEditRule }: { alert: HomeAlert; manage: boolean; close: () => void; onEditRule: () => void }) {
  const clear = useMutation("POST /api/v1/home/alerts/:id/clear");
  const [acting, setActing] = useState<Outcome | null>(null);
  const can = sheetActions(alert, manage);

  const act = async (outcome: Outcome) => {
    if (acting) return;
    setActing(outcome);
    try {
      await clear.run({ params: { id: alert.home_alert_id }, body: { outcome } });
      // The counts, the list, the rules' open alerts and the Overview's alerts beside Need You all move.
      invalidate("/api/v1/home");
      close();
      toast(outcome === "cleared" ? "Alert cleared" : "Alert dismissed");
    } catch (e) {
      setActing(null);
      toast.error(e instanceof ApiError ? e.message : "Alert not changed. Try again.");
    }
  };

  const closedBy: KeyValueItem[] =
    alert.outcome === null
      ? []
      : [
          [alert.outcome === "cleared" ? "Cleared" : "Dismissed", formatDateTime(alert.cleared_at)],
          [alert.outcome === "cleared" ? "Cleared By" : "Dismissed By", alert.cleared_by_name],
          ...(alert.note ? [["Note", alert.note] as KeyValueItem] : []),
        ];
  return (
    <>
      <KeyValue
        items={[
          ["Trigger", alert.trigger],
          ["Who Can Clear", alert.who_can_clear],
          ...(alert.outcome === null ? [["Age", ageOf(alert.raised_at)] as KeyValueItem] : []),
          ["Over By", overByDetail(alert)],
          ["Severity", severityPill(alert)],
          ...closedBy,
        ]}
      />
      <ModalFooter>
        <Button onClick={close}>Close</Button>
        <Grow />
        {can.editRule && <Button onClick={onEditRule}>Edit Rule</Button>}
        {can.clear && (
          <Button busy={acting === "dismissed"} onClick={() => void act("dismissed")}>
            Dismiss Alert
          </Button>
        )}
        {can.clear && (
          <Button variant="primary" busy={acting === "cleared"} onClick={() => void act("cleared")}>
            Clear Alert
          </Button>
        )}
      </ModalFooter>
    </>
  );
}

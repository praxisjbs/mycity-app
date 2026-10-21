import alerts from "@mycity/contract/schemas/alerts.js";
import { useMemo, useState } from "react";
import type { HomeAlertRule } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DataView,
  ErrorState,
  Field,
  Form,
  FormFooter,
  formatCount,
  Grow,
  LoadingRows,
  ModalFooter,
  NumberField,
  Pill,
  SelectField,
  Switch,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useModal,
  useUnsavedChanges,
  type DataViewColumn,
} from "@mycity/ui";
import { clearerOptions, isMetric, METRIC_OPTIONS, ruleLine, SEVERITY } from "./labels";

/**
 * Home · Alerts, the rules (docs/guides/home.md §6 Alerts, §10.1), for holders of
 * `alerts.manage`: Alert Rules lists them with their switches; New Rule and Edit Rule are one
 * form, checked by the contract's own rule (HomeAlertRuleCreate), a dialog on desktop and a
 * bottom sheet on a phone. A rule's key is the server's to make, and its metric stays once it
 * is made, so Edit Rule does not offer it. Switching a rule off asks first, since the server
 * dismisses its open alerts with it. The Attendance policy's five consequence rules come first,
 * read only on their own card: they are changed in the policy (Set in Attendance Policy).
 */

/** Knowledge Hub · Policies, open on the Attendance policy. */
export const ATTENDANCE_POLICY_HREF = hrefFor("knowledge", "policies", { policy: "attendance" });

export interface RuleForms {
  /** Alert Rules: every rule, its switch, and the way to change it. */
  openList: () => void;
  openNew: () => void;
  /** Edit Rule; `onClose` runs once it closes, however it closed. */
  openEdit: (ruleId: string, onClose?: () => void) => void;
}

/** The rule dialogs, opened in the app's one modal (each takes the place of whatever was open). */
export function useRuleForms(): RuleForms {
  const modal = useModal();
  return useMemo(() => {
    const forms: RuleForms = {
      openList: () => modal.open({ title: "Alert Rules", wide: true, body: (close) => <RuleList close={close} forms={forms} /> }),
      openNew: () => modal.open({ title: "New Rule", body: (close) => <RuleForm close={close} /> }),
      openEdit: (ruleId, onClose) => modal.open({ title: "Edit Rule", onClose, body: (close) => <EditRule ruleId={ruleId} close={close} /> }),
    };
    return forms;
  }, [modal]);
}

/* ------------------------------------------------------------------ *
 * Alert Rules
 * ------------------------------------------------------------------ */

function RuleList({ close, forms }: { close: () => void; forms: RuleForms }) {
  const list = usePaged("GET /api/v1/home/alert-rules");
  const patch = useMutation("PATCH /api/v1/home/alert-rules/:id");
  const confirm = useConfirm();
  const [switching, setSwitching] = useState<string | null>(null);

  const flip = async (rule: HomeAlertRule, enabled: boolean) => {
    if (switching) return;
    if (!enabled && !(await confirm({ title: "Switch Off Rule", body: "Its open alerts are dismissed.", confirmLabel: "Switch Off", destructive: true }))) return;
    setSwitching(rule.home_alert_rule_id);
    try {
      await patch.run({ params: { id: rule.home_alert_rule_id }, body: { enabled } });
      // Switching off dismisses the rule's open alerts: the counts and the list move with it.
      invalidate("/api/v1/home");
      toast(enabled ? "Rule switched on" : "Rule switched off");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Rule not changed. Try again.");
    } finally {
      setSwitching(null);
    }
  };

  /* A phone card is the rule's name, its threshold, its switch and Edit Rule. */
  const columns: DataViewColumn<HomeAlertRule>[] = [
    { key: "name", label: "Rule", sortable: true, render: (r) => r.name },
    { key: "threshold", label: "Threshold", render: ruleLine },
    { key: "severity", label: "Severity", desktop: true, render: (r) => <Pill tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].text}</Pill> },
    { key: "who_can_clear", label: "Who Can Clear", desktop: true, render: (r) => r.who_can_clear },
    { key: "open_alerts", label: "Open Alerts", align: "n", desktop: true, render: (r) => formatCount(r.open_alerts) },
    { key: "enabled", label: "On", render: (r) => <Switch checked={r.enabled} label={r.name} disabled={switching === r.home_alert_rule_id} onChange={(on) => void flip(r, on)} /> },
    {
      key: "edit",
      label: "",
      // A rule on a metric no longer listed can be switched off, not changed.
      render: (r) =>
        isMetric(r.metric) ? (
          <Button size="sm" onClick={() => forms.openEdit(r.home_alert_rule_id)}>
            Edit Rule
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PolicyRules close={close} />
      <DataView bare caption="Alert Rules" list={list} rowKey={(r) => r.home_alert_rule_id} noun="rule" columns={columns} empty={{ title: "No Rules Yet" }} />
      <ModalFooter>
        <Button onClick={close}>Close</Button>
        <Grow />
        <Button variant="primary" icon="plus" onClick={forms.openNew}>
          New Rule
        </Button>
      </ModalFooter>
    </>
  );
}

/**
 * The Attendance Policy card: the policy's five rules as the version in force today sets them,
 * each with its figures in words (or Off) and what reaching it does; Set in Attendance Policy for
 * a holder of `policies.manage`.
 */
function PolicyRules({ close }: { close: () => void }) {
  const { navigate } = useRouter();
  const { data, error, reload } = useApi("GET /api/v1/home/alert-rules/policy");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={2} />;
  return (
    <Card className="mb-3">
      <CardHeader
        title="Attendance Policy"
        help="These rules are set in the Attendance policy. Their alerts are raised when someone reaches a limit."
        right={
          data.can_set ? (
            <Button size="sm" onClick={() => (close(), navigate(ATTENDANCE_POLICY_HREF))}>
              Set in Attendance Policy
            </Button>
          ) : undefined
        }
      />
      <DataView
        bare
        caption="Attendance Policy Rules"
        rows={data.rules}
        rowKey={(r) => r.rule}
        noun="rule"
        columns={[
          { key: "name", label: "Rule", render: (r) => r.name },
          { key: "figures", label: "Limit", render: (r) => r.figures ?? <Pill tone="neutral">Off</Pill> },
          {
            key: "does",
            label: "Does",
            render: (r) =>
              r.on ? (
                <span className="inline-flex flex-wrap gap-1.5">
                  {r.alert && <Pill tone="info">Alert</Pill>}
                  {r.query && <Pill tone="warn">Raise Query</Pill>}
                </span>
              ) : null,
          },
          { key: "open_alerts", label: "Open Alerts", align: "n", desktop: true, render: (r) => formatCount(r.open_alerts) },
        ]}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * New Rule and Edit Rule
 * ------------------------------------------------------------------ */

/** The rule form's values, as its fields hold them. */
export interface RuleValues extends Record<string, unknown> {
  name: string;
  metric: string;
  threshold: string;
  window_days: string;
  severity: HomeAlertRule["severity"];
  permission_key: string;
}

/** The window a new rule on a metric counted over days starts with. */
const DEFAULT_WINDOW = "30";

const SEVERITY_OPTIONS = alerts.HOME_ALERT_SEVERITIES.map((s): [HomeAlertRule["severity"], string] => [s as HomeAlertRule["severity"], SEVERITY[s as HomeAlertRule["severity"]].text]);

/** Does a rule on this metric count over a window of days ("3 late arrivals in 30 days")? */
const countsOverDays = (metric: string) => isMetric(metric) && alerts.HOME_ALERT_METRICS[metric].window;

/** "3.00" as the form shows it: "3" ("2.50" is "2.5"). */
const plain = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

/** New Rule's first values: the first metric, its window when it counts over days, Medium, and who clears its alerts. */
export function newRuleValues(): RuleValues {
  return withMetric({ name: "", metric: "", threshold: "", window_days: "", severity: "medium", permission_key: "" }, METRIC_OPTIONS[0][0]);
}

/** A rule's values, for Edit Rule. */
export const ruleValues = (rule: HomeAlertRule): RuleValues => ({
  name: rule.name,
  metric: rule.metric,
  threshold: plain(rule.threshold),
  window_days: rule.window_days === null ? "" : String(rule.window_days),
  severity: rule.severity,
  permission_key: rule.permission_key,
});

/**
 * The values once the metric changes: a window only for a metric counted over days (the one
 * typed is kept), and Who Can Clear following the metric unless the person chose another.
 */
export function withMetric(values: RuleValues, metric: string): RuleValues {
  const was = isMetric(values.metric) ? alerts.HOME_ALERT_METRICS[values.metric].permission_key : "";
  const next = isMetric(metric) ? alerts.HOME_ALERT_METRICS[metric] : null;
  return {
    ...values,
    metric,
    window_days: countsOverDays(metric) ? values.window_days || DEFAULT_WINDOW : "",
    permission_key: next && (values.permission_key === "" || values.permission_key === was) ? next.permission_key : values.permission_key,
  };
}

/** The rule as the API takes it: the window only for a metric counted over days. Edit Rule sends no metric. */
export function ruleBody(values: RuleValues) {
  return {
    name: values.name.trim(),
    threshold: values.threshold.trim(),
    ...(countsOverDays(values.metric) ? { window_days: Number(values.window_days) } : {}),
    severity: values.severity,
    permission_key: values.permission_key,
  };
}

/** Edit Rule: the rule is read first (from an alert, the sheet only knows its id). */
function EditRule({ ruleId, close }: { ruleId: string; close: () => void }) {
  const read = useApi("GET /api/v1/home/alert-rules/:id", { params: { id: ruleId } });
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  return <RuleForm rule={read.data} close={close} />;
}

function RuleForm({ rule, close }: { rule?: HomeAlertRule; close: () => void }) {
  // Edit Rule is held to the same rule as New Rule, its metric included, as the server holds a change.
  const f = useContractForm<RuleValues>(rule ? ruleValues(rule) : newRuleValues(), alerts.HomeAlertRuleCreate);
  useUnsavedChanges(f.isDirty);
  const create = useMutation("POST /api/v1/home/alert-rules");
  const update = useMutation("PATCH /api/v1/home/alert-rules/:id");
  const v = f.values;

  const save = async () => {
    try {
      if (rule) await update.run({ params: { id: rule.home_alert_rule_id }, body: ruleBody(v) });
      else await create.run({ body: { ...ruleBody(v), metric: v.metric } });
      invalidate("/api/v1/home");
      close();
      toast(rule ? "Rule saved" : "Rule created");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) f.setServerErrors(e.fields);
      else toast.error(e instanceof ApiError ? e.message : "Rule not saved. Try again.");
    }
  };

  const deadline = isMetric(v.metric) && alerts.HOME_ALERT_METRICS[v.metric].kind === "deadline";
  return (
    <Form onSubmit={f.submit(save)}>
      <Field label="Rule Name" {...f.status("name")}>
        <TextField {...f.field("name")} maxLength={80} />
      </Field>
      {!rule && (
        <Field label="Metric" {...f.status("metric")}>
          <SelectField options={METRIC_OPTIONS} {...f.field("metric")} onChange={(metric) => f.setValues(withMetric(f.values, metric))} />
        </Field>
      )}
      <Field label="Threshold" {...f.status("threshold")}>
        <NumberField {...f.field("threshold")} decimal={!deadline} placeholder={deadline ? "30" : "3"} />
      </Field>
      {countsOverDays(v.metric) && (
        <Field label="Window Days" {...f.status("window_days")}>
          <NumberField {...f.field("window_days")} placeholder={DEFAULT_WINDOW} />
        </Field>
      )}
      <Field label="Severity" {...f.status("severity")}>
        <ChoiceField options={SEVERITY_OPTIONS} {...f.field("severity")} />
      </Field>
      <Field label="Who Can Clear" {...f.status("permission_key")}>
        <SelectField options={clearerOptions(rule?.permission_key ?? "", rule?.who_can_clear)} {...f.field("permission_key")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={create.pending || update.pending}>
          {rule ? "Save Rule" : "Create Rule"}
        </Button>
      </FormFooter>
    </Form>
  );
}

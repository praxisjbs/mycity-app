import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Integration, IntegrationCheck, IntegrationCode, SecretState } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  EmptyState,
  ErrorState,
  Field,
  formatCount,
  formatDate,
  formatDateTime,
  HelpTerm,
  Icon,
  IconButton,
  KeyValue,
  LoadingRows,
  Menu,
  ModalFooter,
  Pill,
  plural,
  TextField,
  toast,
  todayIso,
  useConfirm,
  useModal,
  type KeyValueItem,
  type MenuItem,
} from "@mycity/ui";
import { carriesSecret, EditSettings } from "./EditSettings";
import { HELP, KIND, PROBLEM, STATE, STEP } from "./words";
import { Where } from "./Where";

/** Where Geoapify's test searches, unless the person types another address. */
const LAGOS_ADDRESS = "Admiralty Way, Lekki, Lagos";

const problemOf = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

/** Test a connection on the settings in use; toasts how it went and reloads what shows it. */
export function useTest() {
  return useCallback(async (code: IntegrationCode, address?: string) => {
    try {
      const done = await api.call("POST /api/v1/integrations/:code/test", { params: { code }, body: address ? { address } : {} });
      toast(done.ok ? "Test passed" : `Test failed: ${PROBLEM[done.error_code ?? "UNAVAILABLE"]}`);
    } catch (e) {
      toast(problemOf(e));
    } finally {
      invalidate("/api/v1/integrations");
    }
  }, []);
}

/** Opens a connection: a side panel on desktop, a full-screen sheet on a phone. */
export function useConnection() {
  const modal = useModal();
  return useCallback(
    function open(code: IntegrationCode, name: string) {
      modal.open({ title: name, side: true, full: true, body: <ConnectionPanel code={code} name={name} reopen={() => open(code, name)} /> });
    },
    [modal],
  );
}

function ConnectionPanel({ code, name, reopen }: { code: IntegrationCode; name: string; reopen: () => void }) {
  const { can } = useAuth();
  const read = useApi("GET /api/v1/integrations/:code", { params: { code } });
  const c = read.data;
  const [address, setAddress] = useState(LAGOS_ADDRESS);
  const actions = useActions(code, name, reopen);
  const canEdit = can("integrations", "edit");

  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!c) return <LoadingRows />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={STATE[c.state].tone}>{STATE[c.state].text}</Pill>
        <Where row={c} />
      </div>
      <SettingsCard c={c} />
      {canEdit && code === "geoapify" && c.settings && (
        <Field label="Address">
          <TextField value={address} onChange={setAddress} maxLength={200} />
        </Field>
      )}
      <LastTest check={c.last_check} />
      <Use c={c} />
      <Checks code={code} />
      <ModalFooter>
        {actions.more(c).length > 0 && <Menu label="More Actions" trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={actions.more(c)} />}
        {canEdit && <Button onClick={() => actions.edit(c)}>Edit Settings</Button>}
        {canEdit && (
          <Button variant="primary" onClick={() => actions.test(code === "geoapify" ? address : undefined)}>
            Test
          </Button>
        )}
      </ModalFooter>
    </div>
  );
}

/** Edit, test, send a test email, replace keys and remove: each confirmed and signed in as it needs. */
function useActions(code: IntegrationCode, name: string, reopen: () => void) {
  const { can } = useAuth();
  const modal = useModal();
  const confirm = useConfirm();
  const fresh = useFreshSignIn();
  const test = useTest();
  const running = useRef(false);

  /** One press, one request: a menu item has no spinner, so a second choice waits for the first. */
  const once = (work: () => Promise<void>) => () => {
    if (running.current) return;
    running.current = true;
    work()
      .catch((e: unknown) => toast(problemOf(e)))
      .finally(() => {
        running.current = false;
        invalidate("/api/v1/integrations");
      });
  };

  const edit = async (c: Integration) => {
    // A form that may carry a secret asks first, since the sign-in would replace it at its save.
    if (carriesSecret(code) && !(await fresh.ensure())) return reopen();
    modal.open({ title: `Edit ${name}`, side: true, full: true, body: <EditSettings c={c} done={reopen} /> });
  };

  const sendTestEmail = once(async () => {
    try {
      const done = await api.call("POST /api/v1/integrations/mail_sender/test-email", { body: {} });
      toast(done.ok ? "Test email sent" : `Test failed: ${PROBLEM[done.error_code ?? "UNAVAILABLE"]}`);
    } catch (e) {
      toast(problemOf(e));
    }
  });

  const replaceKeys = once(async () => {
    const sure = await confirm({ title: "Replace Keys", body: "Every device subscribes again the next time the app opens.", destructive: true });
    if (!sure) return;
    const done = await fresh.guard(() => api.call("POST /api/v1/integrations/web_push/replace-keys", { body: {} }));
    if (done) toast("Keys replaced");
    reopen();
  });

  const remove = once(async () => {
    const sure = await confirm({
      title: "Remove Settings",
      body: code === "mail_sender" ? "System mail waits if the server file has no sender." : "The server file's settings apply again, if it has any.",
      destructive: true,
    });
    if (!sure) return;
    const done = await fresh.guard(async () => {
      await api.call("DELETE /api/v1/integrations/:code", { params: { code } });
      return true;
    });
    if (done) toast("Settings removed");
    reopen();
  });

  const more = (c: Integration): MenuItem[] => {
    const items: MenuItem[] = [];
    if (can("integrations", "edit") && code === "mail_sender" && c.settings) items.push({ label: "Send Test Email", icon: "mail", onSelect: sendTestEmail });
    if (can("integrations", "edit") && code === "web_push") items.push({ label: "Replace Keys", icon: "key", onSelect: replaceKeys });
    if (can("integrations", "delete") && c.saved_at) {
      if (items.length) items.push("sep");
      items.push({ label: "Remove Saved Settings", icon: "trash", danger: true, onSelect: remove });
    }
    return items;
  };

  return { edit, test: (address?: string) => test(code, address), more };
}

/* ───────────── Settings ───────────── */

/** A saved secret, as far as it is ever shown: Saved, a key's last four, who set it and when. */
function Secret({ s, pair }: { s: SecretState | undefined; pair?: boolean }) {
  if (!s || !s.set) return null;
  return (
    <>
      {s.hint && !pair ? `Saved, ends ${s.hint}` : "Saved"}
      {s.set_by_name && (
        <span className="text-subtle-foreground">
          {" · "}
          {s.set_by_name}, {formatDate(s.set_at)}
        </span>
      )}
    </>
  );
}

const term = (label: string, help: string) => <HelpTerm help={help}>{label}</HelpTerm>;
const OWN_DOMAIN = "Each address's domain";

function settingsOf(c: Integration): KeyValueItem[] {
  const secret = (key: SecretState["key"]) => c.secrets.find((x) => x.key === key);
  const s = c.settings;
  const daily: KeyValueItem = [term("Daily Limit", HELP.daily), c.daily_limit ? formatCount(c.daily_limit) : null];
  switch (s?.code) {
    case "mail_sender":
      return [
        ["Server", s.host],
        ["Port", String(s.port)],
        [term("Security", HELP.security), s.security === "tls" ? "TLS" : "STARTTLS"],
        ["Username", s.username],
        ["Password", <Secret key="p" s={secret("password")} />],
        ["From", s.from],
        ["Reply-To", s.reply_to],
        [term("Hourly Limit", HELP.hourly), s.per_hour ? formatCount(s.per_hour) : "Unpaced"],
        [term("Local Domains", HELP.local), s.local_domains],
      ];
    case "mailbox_server":
      return [
        [term("IMAP Host", HELP.host), s.imap_host ?? OWN_DOMAIN],
        ["IMAP Port", String(s.imap_port)],
        [term("SMTP Host", HELP.host), s.smtp_host ?? OWN_DOMAIN],
        ["SMTP Port", String(s.smtp_port)],
        [term("Hourly Limit per Person", HELP.perPerson), formatCount(s.per_person_per_hour)],
        [term("Sync Every", HELP.sync), `${s.sync_every_min} min`],
        [term("Live Connections", HELP.live), String(s.live_connections)],
      ];
    case "geoapify":
      return [["API Key", <Secret key="k" s={secret("api_key")} />], daily];
    case "gemini":
      return [["API Key", <Secret key="k" s={secret("api_key")} />], ["Model", s.model], daily];
    case "web_push":
      return [["Subject", s.subject], ["Key Pair", <Secret key="v" s={secret("vapid")} pair />], ["Key ID", s.key_id]];
    default:
      return [];
  }
}

function SettingsCard({ c }: { c: Integration }) {
  const items = settingsOf(c);
  if (c.saved_at && c.saved_by_name) items.push(["Saved By", `${c.saved_by_name}, ${formatDate(c.saved_at)}`]);
  return (
    <Card>
      <CardHeader title="Settings" level={3} />
      {c.settings ? <KeyValue items={items} /> : <EmptyState title="Not Set Up" icon="link" bare />}
    </Card>
  );
}

/* ───────────── Last Test ───────────── */

function StepMark({ ok }: { ok: boolean | null }) {
  if (ok === true) return <Icon name="ok" size="s" className="mt-0.5 text-success" />;
  if (ok === false) return <Icon name="x" size="s" className="mt-0.5 text-destructive" />;
  return <Icon name="minus" size="s" className="mt-0.5 text-subtle-foreground" />;
}

function LastTest({ check }: { check: IntegrationCheck | null }) {
  if (!check) return null;
  const by = check.checked_by_name ?? (check.kind === "watch" ? "Worker" : null);
  return (
    <Card>
      <CardHeader title="Last Test" level={3} actions={<Pill tone={check.ok ? "ok" : "err"}>{check.ok ? "Passed" : "Failed"}</Pill>} />
      <p className="text-xs text-muted-foreground">
        {KIND[check.kind]}, {formatDateTime(check.created_at)}
        {by ? `, ${by}` : ""}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {check.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            <StepMark ok={s.ok} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span>
                  {STEP[s.key]}
                  {s.ok === true && <span className="sr-only">, passed</span>}
                </span>
                {s.ms !== null && <span className="text-xs tabular-nums text-subtle-foreground">{formatCount(s.ms)} ms</span>}
              </div>
              {s.code && <p className={s.ok === false ? "text-xs text-destructive" : "text-xs text-subtle-foreground"}>{PROBLEM[s.code]}</p>}
              {s.found.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {s.found.map((f) => (
                    <li key={f} data-copy="content">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────── Use ───────────── */

function Use({ c }: { c: Integration }) {
  const limit = c.daily_limit;
  const measure = (d: Integration["usage"][number]) => (limit ? d.units : d.calls);
  const top = Math.max(1, limit ?? 0, ...c.usage.map(measure));
  const today = todayIso();
  const figure = (d: Integration["usage"][number]): ReactNode => {
    const used = limit ? `${formatCount(Math.round(d.units))} of ${formatCount(limit)}` : plural(d.calls, "call");
    return d.failures ? `${used}, ${formatCount(d.failures)} failed` : used;
  };
  return (
    <Card>
      <CardHeader title="Use" level={3} help={c.code === "geoapify" ? HELP.units : undefined} />
      <Bars
        rows={[...c.usage].reverse().map((d) => ({
          label: d.day === today ? "Today" : formatDate(d.day),
          percent: Math.min(100, Math.round((measure(d) / top) * 100)),
          value: figure(d),
        }))}
      />
    </Card>
  );
}

/* ───────────── Checks ───────────── */

function Checks({ code }: { code: IntegrationCode }) {
  const list = usePaged("GET /api/v1/integrations/:code/checks", { params: { code } });
  return (
    <DataView<IntegrationCheck>
      list={list}
      title="Checks"
      caption="Checks"
      noun="check"
      rowKey={(r) => r.integration_check_id}
      empty={{ title: "No Checks Yet", icon: "clock" }}
      columns={[
        { key: "when", label: "When", render: (r) => formatDateTime(r.created_at) },
        { key: "kind", label: "Kind", render: (r) => KIND[r.kind] },
        { key: "result", label: "Result", render: (r) => <Pill tone={r.ok ? "ok" : "err"}>{r.ok ? "Passed" : PROBLEM[r.error_code ?? "UNAVAILABLE"]}</Pill> },
        { key: "by", label: "By", render: (r) => r.checked_by_name ?? (r.kind === "watch" ? "Worker" : null) },
      ]}
    />
  );
}

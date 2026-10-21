import { useEffect, useRef, useState } from "react";
import integrations from "@mycity/contract/schemas/integrations.js";
import type { Integration, IntegrationCode, IntegrationPlan, IntegrationSave, SecretState } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { Button, ChoiceField, Field, Form, FormError, FormFooter, HelpTerm, NumberField, SecretField, TextField, toast, useContractForm, Wizard } from "@mycity/ui";
import { dailyHelp, HELP, PLAN } from "./words";

/** The connections that are a key, a daily limit and a plan. */
const KEY_ONLY = ["geoapify", "gemini", "groq", "openai", "anthropic", "deepseek", "exchange_rates"] as const;
type KeyCode = (typeof KEY_ONLY)[number];
const isKeyOnly = (code: IntegrationCode): code is KeyCode => (KEY_ONLY as readonly string[]).includes(code);

/** The connections whose form holds a secret: opening one asks for a fresh sign-in first. */
export const carriesSecret = (code: IntegrationCode) => code === "mail_sender" || isKeyOnly(code);

type Fields = Record<string, string[]>;

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const text = (v: string | number | null | undefined, fallback = "") => (v === null || v === undefined ? fallback : String(v));
const secretOf = (c: Integration, key: SecretState["key"]) => c.secrets.find((s) => s.key === key);

/**
 * Edit Settings: one form per connection, each tested by the server before it is kept
 * (docs/guides/integrations.md §6.5). A failed test lands on the field to blame; with no
 * field to blame it is a line above the buttons. `done` goes back to the connection.
 */
export function EditSettings({ c, done }: { c: Integration; done: () => void }) {
  switch (c.code) {
    case "mail_sender":
      return <SenderForm c={c} done={done} />;
    case "mailbox_server":
      return <ServerForm c={c} done={done} />;
    case "web_push":
      return <PushForm c={c} done={done} />;
    default:
      return <KeyForm c={c} done={done} />;
  }
}

/**
 * The save every form shares: PUT, then back to the connection. A sign-in that has
 * lapsed is asked for and the save runs once more; that replaces the form, so what
 * follows is said in a toast and the connection opens again.
 */
function useSave(c: Integration, done: () => void, onFields: (fields: Fields) => void) {
  const fresh = useFreshSignIn();
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const save = async (body: IntegrationSave) => {
    setProblem(null);
    try {
      const saved = await fresh.guard(() => api.call("PUT /api/v1/integrations/:code", { params: { code: c.code }, body }));
      if (!saved) return;
      invalidate("/api/v1/integrations");
      toast("Settings saved");
      done();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "STALE") {
        toast("Saved by someone else first");
        invalidate("/api/v1/integrations");
        return done();
      }
      if (!alive.current) {
        toast(err?.message ?? "Not saved");
        return done();
      }
      if (err && Object.keys(err.fields).length) return onFields(err.fields);
      setProblem(err?.message ?? "Not saved");
    }
  };
  return { save, problem };
}

/** The step a field the server marked is on, so the wizard goes back to it. */
function stepOf(steps: ReadonlyArray<readonly string[]>, fields: Fields) {
  const first = Object.keys(fields)[0];
  const i = steps.findIndex((keys) => keys.includes(first));
  return i < 0 ? steps.length - 1 : i;
}

/* ───────────── System Sender ───────────── */

type SenderValues = { host: string; port: string; security: "tls" | "starttls"; username: string; password: string; from: string; reply_to: string; per_hour: string; local_domains: string };
const SENDER_STEPS = [["host", "port", "security", "username", "password"], ["from", "reply_to", "per_hour", "local_domains"]] as const;

function SenderForm({ c, done }: { c: Integration; done: () => void }) {
  const s = c.settings?.code === "mail_sender" ? c.settings : null;
  const body = (v: SenderValues) => ({ code: "mail_sender" as const, ...v, port: num(v.port), per_hour: num(v.per_hour), saved_at: c.saved_at });
  const f = useContractForm<SenderValues>(
    {
      host: text(s?.host),
      port: text(s?.port, "465"),
      security: s?.security ?? "tls",
      username: text(s?.username),
      password: "",
      from: text(s?.from),
      reply_to: text(s?.reply_to),
      per_hour: text(s?.per_hour, "50"),
      local_domains: text(s?.local_domains),
    },
    { safeParse: (v: SenderValues) => integrations.MailSenderSave.safeParse(body(v)) },
  );
  const [jump, setJump] = useState({ key: 0, step: 0 });
  const { save, problem } = useSave(c, done, (fields) => {
    f.setServerErrors(fields);
    setJump((j) => ({ key: j.key + 1, step: stepOf(SENDER_STEPS, fields) }));
  });
  const password = secretOf(c, "password");
  const steps = [
    {
      title: "Server",
      check: () => f.check([...SENDER_STEPS[0]]),
      body: (
        <>
          <Field label="Server" {...f.status("host")}>
            <TextField {...f.field("host")} placeholder="mail.mycityapp.io" maxLength={253} />
          </Field>
          <Field label="Port" {...f.status("port")}>
            <NumberField {...f.field("port")} placeholder="465" />
          </Field>
          <Field label={<HelpTerm help={HELP.security}>Security</HelpTerm>} {...f.status("security")}>
            <ChoiceField {...f.field("security")} options={[["tls", "TLS"], ["starttls", "STARTTLS"]]} />
          </Field>
          <Field label="Username" optional {...f.status("username")}>
            <TextField {...f.field("username")} placeholder="no-reply@mycityapp.io" maxLength={254} autoComplete="off" />
          </Field>
          <Field label="Password" {...f.status("password")}>
            <SecretField {...f.field("password")} saved={password?.set} />
          </Field>
          {problem && <FormError>{problem}</FormError>}
        </>
      ),
    },
    {
      title: "Sending",
      body: (
        <>
          <Field label="From" {...f.status("from")}>
            <TextField {...f.field("from")} placeholder="MyCity App <no-reply@mycityapp.io>" maxLength={320} />
          </Field>
          <Field label="Reply-To" optional {...f.status("reply_to")}>
            <TextField type="email" {...f.field("reply_to")} placeholder="it@mycityapp.io" maxLength={254} />
          </Field>
          <Field label={<HelpTerm help={HELP.hourly}>Hourly Limit</HelpTerm>} {...f.status("per_hour")}>
            <NumberField {...f.field("per_hour")} placeholder="50" />
          </Field>
          <Field label={<HelpTerm help={HELP.local}>Local Domains</HelpTerm>} optional {...f.status("local_domains")}>
            <TextField {...f.field("local_domains")} placeholder="mycityapp.io" maxLength={500} />
          </Field>
          {problem && <FormError>{problem}</FormError>}
        </>
      ),
    },
  ];
  return (
    <Wizard
      key={jump.key}
      initialStep={jump.step}
      steps={steps}
      finish="Save Settings"
      onCancel={done}
      onFinish={async () => {
        if (!f.check()) return;
        await save(body(f.values) as IntegrationSave);
      }}
    />
  );
}

/* ───────────── Staff Mail Server ───────────── */

type ServerValues = { imap_host: string; imap_port: string; smtp_host: string; smtp_port: string; per_person_per_hour: string; sync_every_min: string; live_connections: string };
const SERVER_STEPS = [["imap_host", "imap_port", "smtp_host", "smtp_port"], ["per_person_per_hour", "sync_every_min", "live_connections"]] as const;

function ServerForm({ c, done }: { c: Integration; done: () => void }) {
  const s = c.settings?.code === "mailbox_server" ? c.settings : null;
  const body = (v: ServerValues) => ({
    code: "mailbox_server" as const,
    imap_host: v.imap_host,
    imap_port: num(v.imap_port),
    smtp_host: v.smtp_host,
    smtp_port: num(v.smtp_port),
    per_person_per_hour: num(v.per_person_per_hour),
    sync_every_min: num(v.sync_every_min),
    live_connections: num(v.live_connections),
    saved_at: c.saved_at,
  });
  const f = useContractForm<ServerValues>(
    {
      imap_host: text(s?.imap_host),
      imap_port: text(s?.imap_port, "993"),
      smtp_host: text(s?.smtp_host),
      smtp_port: text(s?.smtp_port, "465"),
      per_person_per_hour: text(s?.per_person_per_hour, "50"),
      sync_every_min: text(s?.sync_every_min, "5"),
      live_connections: text(s?.live_connections, "20"),
    },
    { safeParse: (v: ServerValues) => integrations.MailboxServerSave.safeParse(body(v)) },
  );
  const [jump, setJump] = useState({ key: 0, step: 0 });
  const { save, problem } = useSave(c, done, (fields) => {
    f.setServerErrors(fields);
    setJump((j) => ({ key: j.key + 1, step: stepOf(SERVER_STEPS, fields) }));
  });
  const steps = [
    {
      title: "Servers",
      check: () => f.check([...SERVER_STEPS[0]]),
      body: (
        <>
          <Field label={<HelpTerm help={HELP.host}>IMAP Host</HelpTerm>} optional {...f.status("imap_host")}>
            <TextField {...f.field("imap_host")} placeholder="mail.mycityapp.io" maxLength={253} />
          </Field>
          <Field label="IMAP Port" {...f.status("imap_port")}>
            <NumberField {...f.field("imap_port")} placeholder="993" />
          </Field>
          <Field label={<HelpTerm help={HELP.host}>SMTP Host</HelpTerm>} optional {...f.status("smtp_host")}>
            <TextField {...f.field("smtp_host")} placeholder="mail.mycityapp.io" maxLength={253} />
          </Field>
          <Field label="SMTP Port" {...f.status("smtp_port")}>
            <NumberField {...f.field("smtp_port")} placeholder="465" />
          </Field>
          {problem && <FormError>{problem}</FormError>}
        </>
      ),
    },
    {
      title: "Limits",
      body: (
        <>
          <Field label={<HelpTerm help={HELP.perPerson}>Hourly Limit per Person</HelpTerm>} {...f.status("per_person_per_hour")}>
            <NumberField {...f.field("per_person_per_hour")} placeholder="50" />
          </Field>
          <Field label={<HelpTerm help={HELP.sync}>Sync Every, Minutes</HelpTerm>} {...f.status("sync_every_min")}>
            <NumberField {...f.field("sync_every_min")} placeholder="5" />
          </Field>
          <Field label={<HelpTerm help={HELP.live}>Live Connections</HelpTerm>} {...f.status("live_connections")}>
            <NumberField {...f.field("live_connections")} placeholder="20" />
          </Field>
          {problem && <FormError>{problem}</FormError>}
        </>
      ),
    },
  ];
  return (
    <Wizard
      key={jump.key}
      initialStep={jump.step}
      steps={steps}
      finish="Save Settings"
      onCancel={done}
      onFinish={async () => {
        if (!f.check()) return;
        await save(body(f.values) as IntegrationSave);
      }}
    />
  );
}

/* ───────────── A key, a daily limit and a plan ───────────── */

type KeyValues = { api_key: string; daily_limit: string; plan: IntegrationPlan };

/** Each key connection's own save schema. */
const KEY_SCHEMA = {
  geoapify: integrations.GeoapifySave,
  gemini: integrations.GeminiSave,
  groq: integrations.GroqSave,
  openai: integrations.OpenAiSave,
  anthropic: integrations.AnthropicSave,
  deepseek: integrations.DeepSeekSave,
  exchange_rates: integrations.ExchangeRatesSave,
} as const;

/** A daily limit's format example, in the connection's own unit. */
const LIMIT_EXAMPLE: Partial<Record<KeyCode, string>> = { geoapify: "3000", groq: "23040", exchange_rates: "40" };

const PLANS: Array<[IntegrationPlan, string]> = [
  ["free", PLAN.free],
  ["paid", PLAN.paid],
];

function KeyForm({ c, done }: { c: Integration; done: () => void }) {
  const code = c.code as KeyCode;
  const schema = KEY_SCHEMA[code];
  const body = (v: KeyValues) => ({ code, api_key: v.api_key, daily_limit: num(v.daily_limit) ?? null, plan: v.plan, saved_at: c.saved_at });
  const f = useContractForm<KeyValues>(
    { api_key: "", daily_limit: text(c.daily_limit), plan: c.plan ?? "paid" },
    { safeParse: (v: KeyValues) => schema.safeParse(body(v)) },
  );
  const key = secretOf(c, "api_key");
  const { save, problem } = useSave(c, done, f.setServerErrors);
  return (
    <Form onSubmit={f.submit(() => save(body(f.values) as IntegrationSave))}>
      <Field label="API Key" {...f.status("api_key")}>
        <SecretField {...f.field("api_key")} saved={key?.set} hint={key?.hint} noun="key" />
      </Field>
      <Field label={<HelpTerm help={HELP.plan}>Plan</HelpTerm>} {...f.status("plan")}>
        <ChoiceField {...f.field("plan")} options={PLANS} />
      </Field>
      <Field label={<HelpTerm help={dailyHelp(code)}>Daily Limit</HelpTerm>} optional {...f.status("daily_limit")}>
        <NumberField {...f.field("daily_limit")} placeholder={LIMIT_EXAMPLE[code] ?? "1000"} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={done}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Settings
        </Button>
      </FormFooter>
    </Form>
  );
}

/* ───────────── Web Push ───────────── */

type PushValues = { subject: string };

function PushForm({ c, done }: { c: Integration; done: () => void }) {
  const s = c.settings?.code === "web_push" ? c.settings : null;
  const body = (v: PushValues) => ({ code: "web_push" as const, subject: v.subject, saved_at: c.saved_at });
  const f = useContractForm<PushValues>({ subject: text(s?.subject) }, { safeParse: (v: PushValues) => integrations.WebPushSave.safeParse(body(v)) });
  const { save, problem } = useSave(c, done, f.setServerErrors);
  return (
    <Form onSubmit={f.submit(() => save(body(f.values)))}>
      <Field label="Subject" {...f.status("subject")}>
        <TextField {...f.field("subject")} placeholder="mailto:it@mycityapp.io" maxLength={200} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={done}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Settings
        </Button>
      </FormFooter>
    </Form>
  );
}

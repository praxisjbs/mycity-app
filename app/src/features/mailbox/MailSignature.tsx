import { useState } from "react";
import mailbox from "@mycity/contract/schemas/mailbox.js";
import type { MySignature, SignatureConfig } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { hasCapability } from "@/shell/access";
import {
  Button,
  Card,
  CardHeader,
  CheckboxField,
  DesktopOnly,
  Details,
  EmailFrame,
  ErrorState,
  Field,
  Form,
  FormFooter,
  formatPhone,
  formatPhoneLocal,
  Grid,
  IconButton,
  KeyValue,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  SegmentedControl,
  Stack,
  TextAreaField,
  TextField,
  toast,
  ToggleRow,
  useContractForm,
  useIsPhone,
  useModal,
  Wizard,
} from "@mycity/ui";

/**
 * Mailbox · Signature (#94, `signature`; docs/guides/mailbox.md §10): the caller's signature
 * exactly as it sends, the full one for new mail or the slim line for a reply, and the only
 * things they change on it, their numbers. Everything else comes from records. Holders of
 * `mailbox.signature` also see Configure: the company's links and what shows for everyone.
 */
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");

export function MailSignature() {
  const me = useMe();
  const modal = useModal();
  const phone = useIsPhone();
  const sig = useApi("GET /api/v1/mailbox/signature");
  const [variant, setVariant] = useState<"full" | "slim">("full");
  const [switching, setSwitching] = useState(false);
  const configure = hasCapability(me, "mailbox.signature");

  const openConfigure = () => modal.open({ title: "Configure Signature", full: true, body: (close) => <ConfigureSignature close={close} /> });
  const editNumbers = (s: MySignature) => modal.open({ title: "Edit Numbers", body: (close) => <EditNumbers sig={s} close={close} /> });

  /* A switch saves at once (FRONTEND_GUIDE §8.1); the drawing above follows it. */
  const flip = async (key: "show_mobile" | "show_whatsapp", on: boolean) => {
    setSwitching(true);
    try {
      await api.call("PATCH /api/v1/mailbox/signature", { body: { [key]: on } });
      invalidate("/api/v1/mailbox/signature");
      if (key === "show_mobile") toast(on ? "Mobile shown" : "Mobile hidden");
      else toast(on ? "WhatsApp link on" : "WhatsApp link off");
    } catch (e) {
      say(e);
    } finally {
      setSwitching(false);
    }
  };

  const header = (
    <PageHeader
      title="Signature"
      actions={
        configure && (
          <>
            <DesktopOnly as="span">
              <Button icon="cog" onClick={openConfigure}>
                Configure
              </Button>
            </DesktopOnly>
            <PhoneOnly as="span">
              <IconButton icon="cog" label="Configure Signature" onClick={openConfigure} />
            </PhoneOnly>
          </>
        )
      }
    />
  );
  if (sig.error) return <>{header}<ErrorState error={sig.error} onRetry={sig.reload} /></>;
  if (!sig.data) return <>{header}<LoadingRows count={6} /></>;
  const s = sig.data;
  const html = variant === "full" ? s.full_html : s.slim_html;
  const details = [
    ["Name", s.name],
    ["Job Title", s.job_title],
    ["Department", s.department],
    ["Email", s.email],
  ] as Array<[string, string | null]>;

  const yours = (
    <Card>
      <CardHeader
        title="Your Signature"
        actions={<SegmentedControl small label="Signature For" value={variant} onChange={setVariant} options={[["full", "New Mail"], ["slim", "Reply"]]} />}
      />
      <EmailFrame title={variant === "full" ? "Signature for new mail" : "Signature for replies"} html={html} />
      <div className="mt-3 flex justify-end">
        <DesktopOnly>
          <Button icon="copy" onClick={() => copy(s.full_html)}>
            Copy Signature
          </Button>
        </DesktopOnly>
        <PhoneOnly>
          <IconButton icon="copy" label="Copy Signature" onClick={() => copy(s.full_html)} />
        </PhoneOnly>
      </div>
    </Card>
  );
  const numbers = (
    <Card details={phone ? <Details title="Details" items={details.map(([k, v]) => [k, v ?? "Not given"])} /> : undefined}>
      <CardHeader title="Numbers" actions={<Button size="sm" icon="edit" onClick={() => editNumbers(s)}>Edit Numbers</Button>} />
      <KeyValue items={[["Mobile", s.mobile ? formatPhone(s.mobile) : null], ["Office Line", s.office_line ? formatPhone(s.office_line) : null]]} />
      <div className="mt-2">
        <ToggleRow title="Show Mobile" checked={s.show_mobile} disabled={switching} onChange={(on) => void flip("show_mobile", on)} />
        {s.whatsapp_allowed && <ToggleRow title="WhatsApp Link" checked={s.show_whatsapp} disabled={switching} onChange={(on) => void flip("show_whatsapp", on)} />}
      </div>
    </Card>
  );
  const record = (
    <Card>
      <CardHeader title="Details" help="From your employee record and your mailbox. People change your name, title and department." />
      <KeyValue items={details} />
    </Card>
  );

  return (
    <>
      {header}
      <Grid cols="1.4/1">
        {yours}
        <Stack gap={3}>
          {numbers}
          <DesktopOnly>{record}</DesktopOnly>
        </Stack>
      </Grid>
    </>
  );
}

/**
 * The full signature on the clipboard, as HTML for a mail app's own signature setting and as
 * plain text for anywhere else: the way to carry it into a phone's mail app (mailbox.md §11).
 */
async function copy(html: string) {
  const text = (new DOMParser().parseFromString(html.replace(/<\/(div|tr|p)>/gi, "\n$&"), "text/html").body.textContent ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  try {
    if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast("Signature copied");
  } catch {
    toast("Not copied. Try again.");
  }
}

/** The person's numbers: the mobile is their employee record's, the office line the signature's own. */
function EditNumbers({ sig, close }: { sig: MySignature; close: () => void }) {
  const save = useMutation("PATCH /api/v1/mailbox/signature");
  const f = useContractForm({ mobile: formatPhoneLocal(sig.mobile), office_line: formatPhoneLocal(sig.office_line) }, mailbox.MySignatureSave);
  const submit = async () => {
    try {
      await save.run({ body: { mobile: f.values.mobile, office_line: f.values.office_line } });
      invalidate("/api/v1/mailbox/signature");
      close();
      toast("Numbers saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      <Field label="Mobile" {...f.status("mobile")}>
        <TextField type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" {...f.field("mobile")} />
      </Field>
      <Field label="Office Line" optional {...f.status("office_line")}>
        <TextField type="tel" inputMode="tel" autoComplete="off" placeholder="0201 234 5678" {...f.field("office_line")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={save.pending}>
          Save Numbers
        </Button>
      </FormFooter>
    </Form>
  );
}

type ConfigValues = {
  app_store_url: string;
  google_play_url: string;
  instagram_url: string;
  tiktok_url: string;
  linkedin_url: string;
  x_url: string;
  facebook_url: string;
  youtube_url: string;
  confidentiality_note: string;
  show_whatsapp: boolean;
  show_app_links: boolean;
  show_social_links: boolean;
  show_legal: boolean;
};

/** The fields that hold a link: each a web address or empty. */
type LinkKey = "app_store_url" | "google_play_url" | "instagram_url" | "tiktok_url" | "linkedin_url" | "x_url" | "facebook_url" | "youtube_url";

const APP_LINKS: Array<[LinkKey, string, string]> = [
  ["app_store_url", "App Store", "https://apps.apple.com"],
  ["google_play_url", "Google Play", "https://play.google.com"],
];
const SOCIAL_LINKS: Array<[LinkKey, string, string]> = [
  ["instagram_url", "Instagram", "https://instagram.com"],
  ["tiktok_url", "TikTok", "https://tiktok.com"],
  ["linkedin_url", "LinkedIn", "https://linkedin.com"],
  ["x_url", "X", "https://x.com"],
  ["facebook_url", "Facebook", "https://facebook.com"],
  ["youtube_url", "YouTube", "https://youtube.com"],
];

/** Configure (`mailbox.signature`): the company's links and what shows on everyone's signature. */
function ConfigureSignature({ close }: { close: () => void }) {
  const cfg = useApi("GET /api/v1/mailbox/signature/config");
  if (cfg.error) return <ErrorState error={cfg.error} onRetry={cfg.reload} />;
  if (!cfg.data) return <LoadingRows count={5} />;
  return <ConfigureForm cfg={cfg.data} close={close} />;
}

function ConfigureForm({ cfg, close }: { cfg: SignatureConfig; close: () => void }) {
  const save = useMutation("PUT /api/v1/mailbox/signature/config");
  const f = useContractForm<ConfigValues>(
    {
      app_store_url: cfg.app_store_url ?? "",
      google_play_url: cfg.google_play_url ?? "",
      instagram_url: cfg.instagram_url ?? "",
      tiktok_url: cfg.tiktok_url ?? "",
      linkedin_url: cfg.linkedin_url ?? "",
      x_url: cfg.x_url ?? "",
      facebook_url: cfg.facebook_url ?? "",
      youtube_url: cfg.youtube_url ?? "",
      confidentiality_note: cfg.confidentiality_note ?? "",
      show_whatsapp: cfg.show_whatsapp,
      show_app_links: cfg.show_app_links,
      show_social_links: cfg.show_social_links,
      show_legal: cfg.show_legal,
    },
    mailbox.SignatureConfigSave,
  );
  const finish = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/mailbox/signature");
      close();
      toast("Signature saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const link = ([key, label, example]: [LinkKey, string, string]) => (
    <Field key={key} label={label} optional {...f.status(key)}>
      <TextField type="url" inputMode="url" autoComplete="off" placeholder={example} {...f.field(key)} />
    </Field>
  );
  const tick = (key: "show_whatsapp" | "show_app_links" | "show_social_links" | "show_legal", label: string) => (
    <CheckboxField label={label} value={f.values[key]} onChange={(v) => f.set(key, v)} />
  );
  return (
    <Wizard
      finish="Save Signature"
      busy={save.pending}
      onFinish={finish}
      onCancel={close}
      steps={[
        { title: "App Links", check: () => f.check(APP_LINKS.map(([k]) => k)), body: <>{APP_LINKS.map(link)}</> },
        { title: "Social Links", check: () => f.check(SOCIAL_LINKS.map(([k]) => k)), body: <>{SOCIAL_LINKS.map(link)}</> },
        {
          title: "What Shows",
          check: () => f.check(["confidentiality_note"]),
          body: (
            <>
              <div className="mb-3">
                {tick("show_whatsapp", "WhatsApp Links")}
                {tick("show_app_links", "App Links")}
                {tick("show_social_links", "Social Links")}
                {tick("show_legal", "Legal Line")}
              </div>
              <Field
                label="Confidentiality Note"
                optional
                help="Printed under the company line with the RC number from Settings, Organisation, when Legal Line is ticked."
                {...f.status("confidentiality_note")}
              >
                <TextAreaField rows={3} {...f.field("confidentiality_note")} />
              </Field>
            </>
          ),
        },
      ]}
    />
  );
}

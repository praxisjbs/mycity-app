import { useMemo, useState } from "react";
import maps from "@mycity/contract/schemas/maps.js";
import onboardingSchemas from "@mycity/contract/schemas/onboarding.js";
import type { Guarantor, OnboardingItem, UploadPack } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Page } from "@/shell/Page";
import {
  ActionGroup,
  AddressField,
  Banner,
  Button,
  CheckboxField,
  ChoiceField,
  DateField,
  Field,
  FormError,
  formatDate,
  Grid,
  HelpTerm,
  PageMessage,
  Panel,
  PhoneField,
  Pill,
  Skeleton,
  TextAreaField,
  TextField,
  UploadField,
  useContractForm,
  type ContractSchema,
  type PlaceSummary,
  type Places,
  type PlaceValue,
  type StatusTone,
} from "@mycity/ui";
import { LinkProblem } from "./LinkProblem";

/**
 * Upload Documents (#112, M5; docs/guides/offers.md §3 step 6, §10): the new hire's own page, reached
 * from the `onboarding-documents` email. They accept the privacy notice first, then send each document
 * on MyCity's checklist (a file, a typed value, or both), enter two guarantors as MyCity's Guarantor
 * Form asks (both addresses picked, the two answers, the signed form and an ID copy), pick their home
 * address and enter their BVN (correctable until documentation completes). Each item shows its state
 * and, when it was sent back, the reason. Once
 * documentation is complete the page takes nothing more. No account: the token is the key, and the
 * onboarding routes answer it (UploadPack).
 */

const STEPS = ["Privacy Notice", "Your Documents", "Guarantors and Details"];
const BVN_HELP = "Your Bank Verification Number, eleven digits. Dial *565*0# on the phone your bank holds to see it. Kept masked on your staff record.";
const FORM_HELP = "The guarantor form your offer email came with, signed by your guarantor.";
const ID_HELP = "A copy of your guarantor's ID card, driving licence or passport. A civil servant sends their work ID.";
const YES_NO: Array<["yes" | "no", string]> = [
  ["yes", "Yes"],
  ["no", "No"],
];

/**
 * The address search and pin of this page's address fields (F27), through the hire's own link: our
 * API signs every place it hands back, as the staff app's does. No map tiles here: a pin draws its
 * point on a plain ground.
 */
function placesFor(token: string): Places {
  return {
    search: (q, opts) => api.call("GET /api/public/v1/onboard/:token/places/search", { params: { token }, query: { q }, signal: opts?.signal }).then((r) => r.places),
    pin: (point) => api.call("GET /api/public/v1/onboard/:token/places/pin", { params: { token }, query: { lat: point.lat.toFixed(6), lon: point.lon.toFixed(6) } }),
    read: (t: string) => maps.readPlaceToken(t) as PlaceSummary | null,
  };
}
const FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.heic";
const FILE_KINDS = "PDF or a photo";
const MAX = 15 * 1024 * 1024;

const STATE: Record<OnboardingItem["status"], [StatusTone, string]> = {
  pending: ["neutral", "To Send"],
  uploaded: ["info", "Sent"],
  verified: ["ok", "Verified"],
  rejected: ["err", "Send Again"],
};

const failed = (e: unknown) => (e instanceof ApiError ? e.message : "Not sent. Try again.");

export function UploadDocuments({ token }: { token: string }) {
  const pack = useApi("GET /api/public/v1/onboard/:token", { params: { token } });
  if (pack.error) return <LinkProblem error={pack.error} title="Upload Documents" retry={pack.reload} onward={null} />;
  const p = pack.data;
  const done = p !== undefined && p.status !== "documentation";
  const sent = p ? p.items.filter((i) => i.required && i.status !== "pending" && i.status !== "rejected").length : 0;
  const required = p ? p.items.filter((i) => i.required).length : 0;
  return (
    <Page
      title="Upload Documents"
      layout="split"
      name={p?.first_name}
      line={p ? `${p.role}, ${p.company}` : undefined}
      text="Your documents before your first day."
      paragraph={p ? `${sent} of ${required} required documents sent.${p.starts_on ? ` You start on ${formatDate(p.starts_on)}.` : ""}` : undefined}
      steps={{ items: STEPS, at: !p?.privacy_acknowledged ? 0 : sent < required ? 1 : 2, complete: done }}
    >
      {!p ? (
        <Panel>
          <Skeleton lines={8} />
        </Panel>
      ) : done ? (
        <Panel bare>
          <PageMessage icon="ok" tone="ok" title="Documents Complete">
            Everything is checked. We will be in touch before your start date.
          </PageMessage>
        </Panel>
      ) : !p.privacy_acknowledged ? (
        <Privacy p={p} token={token} onPack={pack.set} />
      ) : (
        <div className="flex flex-col gap-7">
          <Items p={p} token={token} onPack={pack.set} />
          <Guarantors p={p} token={token} onPack={pack.set} />
          <Address p={p} token={token} onPack={pack.set} />
          <Bvn p={p} token={token} onPack={pack.set} />
        </div>
      )}
    </Page>
  );
}

type Props = { p: UploadPack; token: string; onPack: (p: UploadPack) => void };

/** The privacy notice, accepted before anything is sent. */
function Privacy({ p, token, onPack }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [mark, setMark] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const accept = async () => {
    setProblem(null);
    if (!agreed) return setMark("Tick to continue");
    try {
      onPack(await api.call("POST /api/public/v1/onboard/:token/privacy", { params: { token }, body: { consent: true } }));
    } catch (e) {
      setProblem(failed(e));
    }
  };
  return (
    <Panel as="section" title="Privacy Notice">
      <div className="flex flex-col gap-2 text-sm" data-copy="content">
        {p.privacy_notice.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </div>
      <div className="mt-4">
        <CheckboxField label="I Have Read the Notice" value={agreed} onChange={(v) => (setAgreed(v), setMark(null))} state={mark ? "bad" : undefined} />
        {mark && <FormError>{mark}</FormError>}
      </div>
      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" size="lg" className="phone:w-full" onClick={accept}>
          Accept Notice
        </Button>
      </div>
    </Panel>
  );
}

/** Every item on the checklist, each sent on its own. */
function Items({ p, token, onPack }: Props) {
  return (
    <Panel as="section" title="Your Documents">
      <ul className="flex flex-col">
        {p.items.map((it) => (
          <li key={it.onboarding_checklist_item_id} className="border-t border-border py-4 first:border-t-0 first:pt-0">
            <ItemRow it={it} token={token} onPack={onPack} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * An item's typed value checked by the contract's own UploadItem (gate 12): its length as the API
 * holds it, and "Enter the value" on the field when it is empty.
 */
const ITEM_VALUE = {
  safeParse: (v: { entered_value?: string }) => {
    const r = onboardingSchemas.UploadItem.safeParse({ entered_value: String(v.entered_value ?? "").trim() || undefined });
    if (r.success) return r;
    return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: ["entered_value"], code: "custom", message: i.path[0] === "document_id" ? "Enter the value" : i.message })) } };
  },
} as unknown as ContractSchema;

function ItemRow({ it, token, onPack }: { it: OnboardingItem; token: string; onPack: (p: UploadPack) => void }) {
  const f = useContractForm({ entered_value: it.entered_value ?? "" }, ITEM_VALUE);
  const value = f.values.entered_value;
  const [doc, setDoc] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = it.status !== "verified";
  const wantsFile = it.kind !== "number";
  const wantsValue = it.kind !== "file";
  const send = async (documentId: string | null) => {
    setProblem(null);
    if (wantsValue && !f.check()) return;
    const body = { ...(documentId ? { document_id: documentId } : {}), ...(wantsValue && value.trim() ? { entered_value: value.trim() } : {}) };
    if (wantsFile && !body.document_id) return setProblem("Add the file");
    try {
      onPack(await api.call("POST /api/public/v1/onboard/:token/items/:item_id", { params: { token, item_id: it.onboarding_checklist_item_id }, body }));
      setDoc(null);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setProblem(failed(e));
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{it.title}</span>
          {!it.required && <Pill dot={false}>Optional</Pill>}
        </span>
        <Pill tone={STATE[it.status][0]}>{STATE[it.status][1]}</Pill>
      </div>
      {it.status === "rejected" && it.rejected_reason && (
        <p className="mt-1 text-sm text-subtle-foreground" data-copy="content">
          {it.rejected_reason}
        </p>
      )}
      {it.document && <p className="mt-1 text-sm text-subtle-foreground" data-copy="content">{it.document.file_name}</p>}
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {wantsValue && (
            <Field label="Value" {...f.status("entered_value")}>
              <TextField {...f.field("entered_value")} maxLength={80} autoComplete="off" />
            </Field>
          )}
          {wantsFile ? (
            <UploadField
              endpoint={`/api/public/v1/onboard/${encodeURIComponent(token)}/files`}
              purpose="document"
              upload={upload}
              multiple={false}
              accept={FILE_TYPES}
              kinds={FILE_KINDS}
              maxBytes={MAX}
              label={it.status === "pending" ? "Choose a File" : "Send Another File"}
              onUploaded={(docs) => {
                const d = docs[0];
                if (!d) return;
                if (wantsValue && !value.trim()) return setDoc(d.document_id);
                return send(d.document_id);
              }}
            />
          ) : (
            <ActionGroup>
              <div className="flex justify-end">
                <Button variant="primary" className="phone:w-full" onClick={() => send(null)}>
                  Save Value
                </Button>
              </div>
            </ActionGroup>
          )}
          {doc && (
            <div className="flex justify-end">
              <Button variant="primary" className="phone:w-full" onClick={() => send(doc)}>
                Send Document
              </Button>
            </div>
          )}
          {problem && <FormError>{problem}</FormError>}
        </div>
      )}
    </>
  );
}

/** The two guarantors: a previous employer and someone who has known the hire four years or more. */
function Guarantors({ p, token, onPack }: Props) {
  const of = (n: 1 | 2) => p.guarantors.find((g) => g.position === n) ?? null;
  const places = useMemo(() => placesFor(token), [token]);
  return (
    <Panel as="section" title="Your Guarantors">
      <div className="flex flex-col gap-6">
        <GuarantorForm position={1} g={of(1)} token={token} places={places} onPack={onPack} />
        <GuarantorForm position={2} g={of(2)} token={token} places={places} onPack={onPack} />
      </div>
    </Panel>
  );
}

type GValues = {
  full_name: string;
  relationship: string;
  organisation: string;
  job_title: string;
  phone: string;
  email: string;
  years_known: string;
  date_of_birth: string;
  contact_address: PlaceValue | null;
  residential_address: PlaceValue | null;
  convicted: "" | "yes" | "no";
  conviction_details: string;
  recommends: "" | "yes" | "no";
  form_document_id: string;
  id_document_id: string;
};

/** The form's answers as the contract's GuarantorInput takes them: Yes and No as true and false. */
const bodyOf = (v: GValues) => ({
  ...v,
  convicted: v.convicted === "" ? undefined : v.convicted === "yes",
  conviction_details: v.convicted === "yes" ? v.conviction_details : "",
  recommends: v.recommends === "" ? undefined : v.recommends === "yes",
  contact_address: v.contact_address ?? undefined,
  residential_address: v.residential_address ?? undefined,
});

const CHECK: Record<Guarantor["check_status"], [StatusTone, string]> = {
  pending: ["info", "Being Checked"],
  passed: ["ok", "Passed"],
  failed: ["err", "Change Guarantor"],
};

const yesNo = (b: boolean | null | undefined): "" | "yes" | "no" => (b === null || b === undefined ? "" : b ? "yes" : "no");

function GuarantorForm({ position, g, token, places, onPack }: { position: 1 | 2; g: Guarantor | null; token: string; places: Places; onPack: (p: UploadPack) => void }) {
  const kind = position === 1 ? "previous_employer" : "personal";
  const schema = onboardingSchemas.GuarantorInput;
  const f = useContractForm<GValues>(
    {
      full_name: g?.full_name ?? "",
      relationship: g?.relationship ?? "",
      organisation: g?.organisation ?? "",
      job_title: g?.job_title ?? "",
      phone: g?.phone ?? "",
      email: g?.email ?? "",
      years_known: g?.years_known != null ? String(g.years_known) : "",
      date_of_birth: g?.date_of_birth ?? "",
      // A saved address goes back only as a fresh pick: the page holds its line, not its place.
      contact_address: null,
      residential_address: null,
      convicted: yesNo(g?.convicted),
      conviction_details: g?.conviction_details ?? "",
      recommends: yesNo(g?.recommends),
      form_document_id: g?.form?.document_id ?? "",
      id_document_id: g?.id_document?.document_id ?? "",
    },
    { safeParse: (v: unknown) => schema.safeParse({ ...bodyOf(v as GValues), position, kind }) } as ContractSchema,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(g?.form?.file_name ?? null);
  const [idCopy, setIdCopy] = useState<string | null>(g?.id_document?.file_name ?? null);
  const locked = g?.check_status === "passed";
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      onPack(await api.call("POST /api/public/v1/onboard/:token/guarantors", { params: { token }, body: { ...bodyOf(f.values), position, kind } as never }));
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setProblem(failed(e));
    }
  };
  const title = position === 1 ? "Previous Employer" : "Personal Guarantor";
  return (
    <section aria-label={title} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {g && <Pill tone={CHECK[g.check_status][0]}>{CHECK[g.check_status][1]}</Pill>}
      </div>
      {locked ? (
        <p className="text-sm" data-copy="content">{`${g!.full_name}, ${g!.relationship}`}</p>
      ) : (
        <>
          <Grid cols={2}>
            <Field label="Full Name" {...f.status("full_name")}>
              <TextField {...f.field("full_name")} autoComplete="off" maxLength={120} />
            </Field>
            <Field label="Relationship" {...f.status("relationship")}>
              <TextField {...f.field("relationship")} maxLength={80} />
            </Field>
            {position === 1 && (
              <>
                <Field label="Organisation" optional {...f.status("organisation")}>
                  <TextField {...f.field("organisation")} maxLength={160} />
                </Field>
                <Field label="Job Title" optional {...f.status("job_title")}>
                  <TextField {...f.field("job_title")} maxLength={120} />
                </Field>
              </>
            )}
            <Field label="Phone" {...f.status("phone")}>
              <PhoneField {...f.field("phone")} placeholder="803 000 0000" />
            </Field>
            <Field label="Email" optional {...f.status("email")}>
              <TextField {...f.field("email")} placeholder="name@example.com" autoComplete="off" />
            </Field>
            {position === 2 && (
              <Field label="Years Known" {...f.status("years_known")}>
                <TextField {...f.field("years_known")} inputMode="numeric" maxLength={2} />
              </Field>
            )}
            <Field label="Date of Birth" {...f.status("date_of_birth")}>
              <DateField {...f.field("date_of_birth")} />
            </Field>
          </Grid>
          <Field label="Contact Address" {...f.status("contact_address")}>
            <AddressField {...f.field("contact_address")} places={places} />
          </Field>
          {g?.contact_address && !f.values.contact_address && <p className="text-sm text-subtle-foreground" data-copy="content">{g.contact_address}</p>}
          <Field label="Residential Address" {...f.status("residential_address")}>
            <AddressField {...f.field("residential_address")} places={places} />
          </Field>
          {g?.residential_address && !f.values.residential_address && <p className="text-sm text-subtle-foreground" data-copy="content">{g.residential_address}</p>}
          <Grid cols={2}>
            <Field label="Ever Convicted" {...f.status("convicted")}>
              <ChoiceField options={YES_NO} {...f.field("convicted")} />
            </Field>
            <Field label="Recommends You" {...f.status("recommends")}>
              <ChoiceField options={YES_NO} {...f.field("recommends")} />
            </Field>
          </Grid>
          {f.values.convicted === "yes" && (
            <Field label="What Happened" {...f.status("conviction_details")}>
              <TextAreaField {...f.field("conviction_details")} rows={3} maxLength={500} />
            </Field>
          )}
          <Field label={<HelpTerm help={FORM_HELP}>Guarantor Form</HelpTerm>} optional {...f.status("form_document_id")}>
            <UploadField
              endpoint={`/api/public/v1/onboard/${encodeURIComponent(token)}/files`}
              purpose="document"
              upload={upload}
              multiple={false}
              accept={FILE_TYPES}
              kinds={FILE_KINDS}
              maxBytes={MAX}
              label={form ? "Send Another Form" : "Choose the Form"}
              onUploaded={(docs) => {
                const d = docs[0];
                if (!d) return;
                f.set("form_document_id", d.document_id);
                setForm(d.file_name);
              }}
            />
          </Field>
          {form && <p className="text-sm text-subtle-foreground" data-copy="content">{form}</p>}
          <Field label={<HelpTerm help={ID_HELP}>ID Copy</HelpTerm>} optional {...f.status("id_document_id")}>
            <UploadField
              endpoint={`/api/public/v1/onboard/${encodeURIComponent(token)}/files`}
              purpose="document"
              upload={upload}
              multiple={false}
              accept={FILE_TYPES}
              kinds={FILE_KINDS}
              maxBytes={MAX}
              label={idCopy ? "Send Another Copy" : "Choose the Copy"}
              onUploaded={(docs) => {
                const d = docs[0];
                if (!d) return;
                f.set("id_document_id", d.document_id);
                setIdCopy(d.file_name);
              }}
            />
          </Field>
          {idCopy && <p className="text-sm text-subtle-foreground" data-copy="content">{idCopy}</p>}
          {problem && <FormError>{problem}</FormError>}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" className="phone:w-full" onClick={save}>
              Save Guarantor
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** The hire's home address, picked (F27): their staff record's home address. */
function Address({ p, token, onPack }: Props) {
  const places = useMemo(() => placesFor(token), [token]);
  const f = useContractForm<{ home_address: PlaceValue | null }>({ home_address: null }, {
    safeParse: (v: unknown) => onboardingSchemas.HireAddressEnter.safeParse({ home_address: (v as { home_address: PlaceValue | null }).home_address ?? undefined }),
  } as ContractSchema);
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      onPack(await api.call("POST /api/public/v1/onboard/:token/address", { params: { token }, body: { home_address: f.values.home_address } as never }));
      setChanging(false);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setProblem(failed(e));
    }
  };
  return (
    <Panel as="section" title="Your Address" status={p.address_entered ? "Entered" : undefined}>
      {p.address_entered && !changing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Entered. Thank you.</p>
          <Button size="sm" onClick={() => setChanging(true)}>Change Address</Button>
        </div>
      ) : (
        <>
          <Field label="Home Address" {...f.status("home_address")}>
            <AddressField {...f.field("home_address")} places={places} />
          </Field>
          {problem && <FormError>{problem}</FormError>}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" size="lg" className="phone:w-full" onClick={save}>
              Save Address
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** The BVN: eleven digits, never shown back; correctable until documentation completes. */
function Bvn({ p, token, onPack }: Props) {
  const f = useContractForm({ bvn: "" }, onboardingSchemas.BvnEnter);
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      onPack(await api.call("POST /api/public/v1/onboard/:token/bvn", { params: { token }, body: f.values }));
      setChanging(false);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setProblem(failed(e));
    }
  };
  return (
    <Panel as="section" title="Your BVN" status={p.bvn_entered ? "Entered" : undefined}>
      {p.bvn_entered && !changing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Entered. Thank you.</p>
          <Button size="sm" onClick={() => setChanging(true)}>Change BVN</Button>
        </div>
      ) : (
        <>
          <Field label={<HelpTerm help={BVN_HELP}>BVN</HelpTerm>} {...f.status("bvn")}>
            <TextField {...f.field("bvn")} inputMode="numeric" maxLength={11} autoComplete="off" />
          </Field>
          {problem && <FormError>{problem}</FormError>}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" size="lg" className="phone:w-full" onClick={save}>
              Save BVN
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

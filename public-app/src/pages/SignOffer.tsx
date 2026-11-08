import { useCallback, useRef, useState } from "react";
import signatureSchemas from "@mycity/contract/schemas/signatures.js";
import type { SignCodeSent, SigningView, SignerView } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Page } from "@/shell/Page";
import {
  ActionGroup,
  Banner,
  Button,
  CheckboxField,
  ChoiceField,
  Field,
  FormError,
  formatDate,
  formatTime,
  HelpTerm,
  IssuedLetter,
  KeyValue,
  OtpField,
  PageMessage,
  Panel,
  SignatureField,
  Skeleton,
  TextAreaField,
  TextField,
  useContractForm,
  type ContractSchema,
  type SignatureFieldHandle,
} from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { LinkProblem } from "./LinkProblem";

/** The three steps in the aside: the letter is read, the email confirmed, then signed. */
const STEPS = ["Read the Letter", "Confirm Your Email", "Sign Below"] as const;
const CODE_HELP = "A six-digit code goes to the address your offer came to. It works for ten minutes.";
const METHODS: Array<["draw" | "type", string]> = [
  ["draw", "Draw"],
  ["type", "Type"],
];

/**
 * Sign Offer (#84, M5; docs/guides/offers.md §3 step 4): the candidate reads the same text the PDF
 * holds, receives an email code, types full name and title, draws or types a signature, ticks the
 * consent and presses Accept and Sign, from a phone. Signing is acceptance; the sealed copy is
 * emailed and verifiable. Decline the Offer takes a reason. No account: the token is the key, and
 * the signatures routes answer it (SigningView).
 */
export function SignOffer({ token }: { token: string }) {
  const o = useApi("GET /api/public/v1/sign/:token", { params: { token } });
  const [sent, setSent] = useState<SignCodeSent | null>(null);
  if (o.error) return <LinkProblem error={o.error} title="Offer of Employment" retry={o.reload} />;
  const d = o.data;
  const role = d ? d.title.replace(/^Offer of Employment:\s*/, "") : undefined;
  return (
    <Page
      title="Offer of Employment"
      layout="split"
      name={role}
      line={d ? `Offer of Employment, ${d.reference}` : undefined}
      text="Your offer, ready to sign."
      paragraph={d ? `For ${d.signer_name}, from ${d.company}.${d.expires_at ? ` It expires on ${formatDate(d.expires_at)}.` : ""}` : undefined}
      steps={{ items: STEPS, at: d?.code_verified ? 2 : sent ? 1 : 0, complete: d != null && d.state === "signed" }}
    >
      {!d ? (
        <Panel>
          <Skeleton lines={8} />
        </Panel>
      ) : d.state === "awaiting" ? (
        <Sign d={d} token={token} sent={sent} onSent={setSent} onView={o.set} />
      ) : (
        <Closed d={d} />
      )}
    </Page>
  );
}

/** Who signs, in order, and where each stands. */
function Signers({ signers }: { signers: SignerView[] }) {
  return (
    <Panel as="section" title="Signers">
      <KeyValue
        layout="rows"
        items={signers.map((s) => [
          s.role === "mycity" ? `${s.name}, for the Company` : s.name,
          s.status === "signed" ? (s.signed_at ? `Signed ${formatDate(s.signed_at)}` : "Signed") : s.status === "pending" ? "Waiting" : s.status === "declined" ? "Declined" : "Not Signed",
        ])}
      />
    </Panel>
  );
}

function Sign({ d, token, sent, onSent, onView }: { d: SigningView; token: string; sent: SignCodeSent | null; onSent: (s: SignCodeSent) => void; onView: (d: SigningView) => void }) {
  const [declining, setDeclining] = useState(false);
  const letter = (
    <IssuedLetter label="The offer letter" meta={[d.company, "Lagos, Nigeria", formatDate(d.issued_at)]} title="Offer of Employment" paragraphs={d.letter.slice(1)} />
  );
  return (
    <div className="flex flex-col gap-7">
      {letter}
      <Signers signers={d.signers} />
      {declining ? (
        <Decline token={token} onView={onView} back={() => setDeclining(false)} />
      ) : d.code_verified ? (
        <SignBelow d={d} token={token} onView={onView} decline={() => setDeclining(true)} />
      ) : (
        <ConfirmEmail token={token} sent={sent} onSent={onSent} onView={onView} decline={() => setDeclining(true)} />
      )}
    </div>
  );
}

/** Send Code, then the six digits: the email the link was sent to is the signer's. */
function ConfirmEmail({ token, sent, onSent, onView, decline }: { token: string; sent: SignCodeSent | null; onSent: (s: SignCodeSent) => void; onView: (d: SigningView) => void; decline: () => void }) {
  const [code, setCode] = useState("");
  const [mark, setMark] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ask = async () => {
    setProblem(null);
    try {
      onSent(await api.call("POST /api/public/v1/sign/:token/code", { params: { token }, body: {} }));
      setCode("");
      setMark(null);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The code did not send. Try again.");
    }
  };
  const check = async (typed = code) => {
    setProblem(null);
    if (!/^\d{6}$/.test(typed)) return setMark("Six digits");
    try {
      onView(await api.call("POST /api/public/v1/sign/:token/code/verify", { params: { token }, body: { code: typed } }));
    } catch (e) {
      if (e instanceof ApiError && e.fields.code?.[0]) setMark(e.fields.code[0]);
      else setProblem(e instanceof ApiError ? e.message : "The code did not check. Try again.");
    }
  };
  return (
    <Panel as="section" title="Confirm Your Email">
      {sent ? (
        <>
          <Field label={<HelpTerm help={CODE_HELP}>Email Code</HelpTerm>} state={mark ? "bad" : undefined} message={mark ?? undefined}>
            <OtpField
              label="Email Code"
              value={code}
              onChange={(v) => (setCode(v), setMark(null))}
              onComplete={(v) => {
                void check(v);
              }}
              state={mark ? "bad" : undefined}
            />
          </Field>
          <p className="mt-2 text-sm text-subtle-foreground">Sent to {sent.sent_to}</p>
        </>
      ) : (
        <p className="text-sm">We email you a code to confirm it is you.</p>
      )}
      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <ActionGroup>
          <Button variant="line" size="lg" className="phone:w-full" onClick={decline}>
            Decline the Offer
          </Button>
          {sent ? (
            <>
              <Button variant="ghost" size="lg" className="phone:w-full" onClick={ask}>
                Send Again
              </Button>
              <Button variant="primary" size="lg" className="phone:w-full" onClick={() => check()}>
                Confirm Code
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" className="phone:w-full" onClick={ask}>
              Send Code
            </Button>
          )}
        </ActionGroup>
      </div>
    </Panel>
  );
}

type Values = { full_name: string; title: string; method: "draw" | "type"; typed: string; consent: boolean };

/**
 * The pad's ink is read when Accept and Sign is pressed, so the schema checks the other fields
 * against a stand-in image while the pad has ink; an empty pad is marked on the pad itself.
 */
const INKED = "data:image/png;base64,iVBORw0KGgo=";
const bodyOf = (v: Values, png?: string) => ({
  full_name: v.full_name,
  ...(v.title.trim() ? { title: v.title } : {}),
  method: v.method,
  ...(v.method === "draw" ? { signature_png: png ?? INKED } : { typed: v.typed }),
  consent: v.consent as true,
});
const signSchema: ContractSchema = {
  safeParse: (v: unknown) => {
    const r = (signatureSchemas.SignSubmit as unknown as ContractSchema).safeParse(bodyOf(v as Values));
    return r.success ? { success: true, data: v } : { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: [String(i.path[0] ?? "")] })) } };
  },
};

function SignBelow({ d, token, onView, decline }: { d: SigningView; token: string; onView: (d: SigningView) => void; decline: () => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const f = useContractForm<Values>({ full_name: d.signer_name, title: "", method: "draw", typed: "", consent: false }, signSchema);
  const [empty, setEmpty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ink = useCallback((v: boolean) => v && setEmpty(false), []);
  const sign = async () => {
    setProblem(null);
    const png = f.values.method === "draw" ? (pad.current?.toPng() ?? undefined) : undefined;
    const drawn = f.values.method !== "draw" || Boolean(png);
    setEmpty(!drawn);
    if (!f.check() || !drawn) return;
    try {
      onView(await api.call("POST /api/public/v1/sign/:token/sign", { params: { token }, body: bodyOf(f.values, png) }));
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields.signature_png) setEmpty(true);
        f.setServerErrors(e.fields);
        setProblem(Object.keys(e.fields).length ? null : e.message);
      } else setProblem("The signature did not send. Try again.");
    }
  };
  return (
    <Panel as="section" title="Sign Below">
      <div className="grid gap-x-4 md:grid-cols-2">
        <Field label="Full Name" {...f.status("full_name")}>
          <TextField {...f.field("full_name")} autoComplete="name" maxLength={120} />
        </Field>
        <Field label="Title" optional {...f.status("title")}>
          <TextField {...f.field("title")} placeholder="Mr, Ms, Dr" maxLength={120} />
        </Field>
      </div>
      <Field label="Signature" {...f.status("method")}>
        <ChoiceField options={METHODS} {...f.field("method")} />
      </Field>
      {f.values.method === "draw" ? (
        <>
          <SignatureField ref={pad} look="pad" hint="Draw your signature here" state={empty ? "bad" : undefined} onChange={ink} label="Signature box. Draw your signature with a finger or a mouse." />
          {empty && (
            <div className="mt-2">
              <FormError>Draw your signature</FormError>
            </div>
          )}
        </>
      ) : (
        <Field label="Typed Signature" {...f.status("typed")}>
          <TextField {...f.field("typed")} maxLength={120} />
        </Field>
      )}
      <div className="mt-4">
        <CheckboxField label="Agree to Sign Electronically" {...f.field("consent")} />
      </div>
      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <ActionGroup>
          <Button variant="line" size="lg" className="phone:w-full" onClick={decline}>
            Decline the Offer
          </Button>
          <Button variant="primary" size="lg" className="phone:w-full" onClick={sign}>
            Accept and Sign
          </Button>
        </ActionGroup>
      </div>
    </Panel>
  );
}

function Decline({ token, onView, back }: { token: string; onView: (d: SigningView) => void; back: () => void }) {
  const f = useContractForm({ reason: "" }, signatureSchemas.SignDecline as unknown as ContractSchema);
  const [problem, setProblem] = useState<string | null>(null);
  const decline = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      onView(await api.call("POST /api/public/v1/sign/:token/decline", { params: { token }, body: { reason: f.values.reason.trim() } }));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not record your answer. Try again.");
    }
  };
  return (
    <Panel as="section" title="Decline the Offer">
      <Field label="Reason for Declining" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={4} maxLength={500} />
      </Field>
      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <ActionGroup>
          <Button variant="ghost" size="lg" onClick={back}>
            Back to the Offer
          </Button>
          <Button variant="line" size="lg" className="phone:w-full" onClick={decline}>
            Confirm Decline
          </Button>
        </ActionGroup>
      </div>
    </Panel>
  );
}

function Closed({ d }: { d: SigningView }) {
  const { navigate } = useRouter();
  return (
    <div className="flex flex-col gap-7">
      <Panel bare>
        {d.state === "signed" ? (
          <PageMessage
            icon="ok"
            tone="ok"
            title="Offer Signed"
            reference={d.verify_number ? { label: "Reference", value: d.verify_number } : undefined}
            action={
              d.verify_number ? (
                <Button variant="primary" size="lg" onClick={() => navigate(`/verify/${d.verify_number}`)}>
                  Verify This Document
                </Button>
              ) : undefined
            }
          >
            <p>{d.verify_number ? "We emailed you a signed copy." : "We email you the signed copy shortly."}</p>
            {d.signed_at && (
              <p>
                Signed on {formatDate(d.signed_at)} at {formatTime(d.signed_at)}.
              </p>
            )}
          </PageMessage>
        ) : d.state === "declined" ? (
          <PageMessage icon="ok" title="Offer Declined">
            We told the hiring team. Thank you for letting us know.
          </PageMessage>
        ) : d.state === "expired" ? (
          <PageMessage icon="clock" tone="warn" title="This Offer Has Expired">
            {d.expires_at ? `It expired on ${formatDate(d.expires_at)} without a signature.` : "It expired without a signature."} If you still want the role, reply to the email the offer came with.
          </PageMessage>
        ) : (
          <PageMessage icon="alert" title="Offer Withdrawn">
            It can no longer be signed. If you think this is a mistake, reply to the email the offer came with.
          </PageMessage>
        )}
      </Panel>
      {d.state === "signed" && <Signers signers={d.signers} />}
    </div>
  );
}

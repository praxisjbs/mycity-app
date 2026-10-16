import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { OfferToSign } from "@/api/types/public";
import { Page } from "@/shell/Page";
import { Banner, Brand, Button, Field, formatDate, formatTime, PageMessage, SignatureField, Skeleton, Sub, TextAreaField, type SignatureFieldHandle } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { LinkProblem } from "./LinkProblem";

/**
 * Sign Offer (#84): the candidate reads the same text that is in the PDF and
 * signs on a canvas, from a phone. On signing, the signature is written into
 * the document, the final PDF is rendered once, two hashes are stored and the
 * document locks (MILESTONES §10). No account: the token is the key.
 */
export function SignOffer({ token }: { token: string }) {
  const o = useApi("GET /api/public/v1/sign/:token", { params: { token } });
  if (o.error) return <LinkProblem error={o.error} title="Offer of Employment" retry={o.reload} />;
  const d = o.data;
  if (!d)
    return (
      <Page title="Offer of Employment" brandInCard>
        <Skeleton lines={8} />
      </Page>
    );
  if (d.state === "awaiting") return <Sign d={d} token={token} onDone={o.set} />;
  return <Closed d={d} token={token} />;
}

function Head({ d }: { d: OfferToSign }) {
  return (
    <>
      <div className="mb-[18px] text-center">
        <Brand name="MyCityApp" />
      </div>
      <h1 className="text-[19px]">Offer of Employment</h1>
      <Sub className="mt-1">
        {d.candidate_name} · {d.role} · {d.reference}
      </Sub>
    </>
  );
}

function Sign({ d, token, onDone }: { d: OfferToSign; token: string; onDone: (d: OfferToSign) => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const onInk = useCallback((v: boolean) => setInked(v), []);

  const run = async (fn: () => Promise<OfferToSign>, fallback: string) => {
    setBusy(true);
    setProblem(null);
    try {
      onDone(await fn());
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.fields.signature_png?.[0] ?? e.message) : fallback);
      setBusy(false);
    }
  };
  const sign = () => {
    const png = pad.current?.toPng();
    if (!png) return setProblem("Sign in the box first.");
    void run(() => api.call("POST /api/public/v1/sign/:token/sign", { params: { token }, body: { signature_png: png } }), "The signature did not send. Try again.");
  };
  const decline = () => void run(() => api.call("POST /api/public/v1/sign/:token/decline", { params: { token }, body: { reason: reason.trim() } }), "Could not record your answer. Try again.");

  return (
    <Page title="Offer of Employment" brandInCard>
      <Head d={d} />
      <Sub className="mt-0.5">
        Expires {formatDate(d.expires_at)}
      </Sub>
      <div className="mt-3.5 max-h-[170px] overflow-y-auto rounded-[10px] border border-border p-3.5 text-[13px] leading-[1.6] text-muted-foreground max-md:max-h-[260px]" tabIndex={0} aria-label="The offer letter">
        {d.letter.map((p, n) => (
          <p key={n} className={n ? "mt-[9px]" : undefined}>
            {p}
          </p>
        ))}
      </div>
      {!declining ? (
        <>
          <div className="mt-4">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">Sign Below</span>
            <SignatureField ref={pad} noClear onChange={onInk} disabled={busy} label="Signature box. Draw your signature with a finger or a mouse." />
            <div className="mt-2 flex justify-end">
              <Button disabled={!inked || busy} onClick={() => pad.current?.clear()}>
                Clear
              </Button>
            </div>
          </div>
          {problem && (
            <div className="mt-2">
              <Banner tone="err">{problem}</Banner>
            </div>
          )}
          <Button variant="primary" block className="mt-2" disabled={busy || !inked} onClick={sign}>
            {busy ? "Signing" : "Accept and Sign"}
          </Button>
          <Sub className="mt-2.5 text-center">Once signed, this document is locked and verifiable at go.mycityapp.io/verify</Sub>
          <div className="mt-3 text-center">
            <button type="button" className="text-[12.5px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setDeclining(true)}>
              Decline the Offer
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Reason for Declining" htmlFor="reason" optional>
            <TextAreaField id="reason" rows={3} value={reason} onChange={setReason} maxLength={1000} />
          </Field>
          {problem && <Banner tone="err">{problem}</Banner>}
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => (setDeclining(false), setProblem(null))}>
              Back to the Offer
            </Button>
            <Button variant="primary" disabled={busy} onClick={decline}>
              {busy ? "Sending" : "Confirm Decline"}
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}

function Closed({ d, token }: { d: OfferToSign; token: string }) {
  const { navigate } = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const download = () => {
    if (import.meta.env.VITE_API_MODE === "mock") return setNote("This is the demo. The live site downloads the signed PDF here.");
    window.location.assign(`/api/public/v1/sign/${encodeURIComponent(token)}/document`);
  };
  return (
    <Page title="Offer of Employment" brandInCard>
      <Head d={d} />
      {d.state === "signed" ? (
        <PageMessage
          icon="ok"
          tone="ok"
          title="Offer signed"
          action={
            <>
              <Button onClick={download} icon="doc">
                Download Signed PDF
              </Button>
              <Button variant="primary" onClick={() => navigate(`/verify/${d.verify_number}`)}>
                View Verification
              </Button>
            </>
          }
        >
          <p>
            Signed on {formatDate(d.signed_at)} at {formatTime(d.signed_at)} WAT. The document is locked and nothing can change it.
          </p>
          <p className="mt-2">Anyone you give the reference {d.verify_number} to can check it at go.mycityapp.io/verify. We will email you the list of documents to upload before your first day.</p>
          {note && (
            <div className="mt-3 text-left">
              <Banner tone="info">{note}</Banner>
            </div>
          )}
        </PageMessage>
      ) : d.state === "declined" ? (
        <PageMessage icon="ok" title="Offer declined">
          Thank you for letting us know. Your answer has been recorded and the hiring team has been told. We wish you well.
        </PageMessage>
      ) : d.state === "expired" ? (
        <PageMessage icon="clock" tone="warn" title="This offer has expired">
          It expired on {formatDate(d.expires_at)} without a signature. If you still want the role, reply to the email the offer came with.
        </PageMessage>
      ) : (
        <PageMessage icon="alert" title="This offer has been withdrawn">
          It can no longer be signed. If you think this is a mistake, reply to the email the offer came with.
        </PageMessage>
      )}
    </Page>
  );
}

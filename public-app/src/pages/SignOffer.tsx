import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { OfferToSign } from "@/api/types/public";
import { Page } from "@/shell/Page";
import { ActionGroup, Banner, Button, Field, FormError, formatDate, formatTime, IssuedLetter, PageMessage, Panel, SignatureField, Skeleton, TextAreaField, type SignatureFieldHandle } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { LinkProblem } from "./LinkProblem";

/** The two steps in the aside: the letter is read, then signed. */
const STEPS = ["Read the Letter", "Sign Below"] as const;

/**
 * Sign Offer (#84, M5): the candidate reads the same text that is in the PDF (the Letter) and signs in
 * the box with a finger or a mouse, from a phone. On signing, the signature is written into the
 * document, the final PDF is rendered once, two hashes are stored and the document locks (MILESTONES
 * §10). No account: the token is the key. Built on the INTERIM shapes and the mock until M5's signing
 * API lands (types/public.ts).
 */
export function SignOffer({ token }: { token: string }) {
  const o = useApi("GET /api/public/v1/sign/:token", { params: { token } });
  const [inked, setInked] = useState(false);
  if (o.error) return <LinkProblem error={o.error} title="Offer of Employment" retry={o.reload} />;
  const d = o.data;
  return (
    <Page
      title="Offer of Employment"
      layout="split"
      name={d?.role}
      line={d ? `Offer of Employment, ${d.reference}` : undefined}
      text="Your offer, ready to sign."
      paragraph={d ? `For ${d.candidate_name}, from ${d.company}. It expires on ${formatDate(d.expires_at)}.` : undefined}
      steps={{ items: STEPS, at: inked ? 1 : 0, complete: d != null && d.state === "signed" }}
    >
      {!d ? (
        <Panel>
          <Skeleton lines={8} />
        </Panel>
      ) : d.state === "awaiting" ? (
        <Sign d={d} token={token} onDone={o.set} onInk={setInked} />
      ) : (
        <Closed d={d} />
      )}
    </Page>
  );
}

function Sign({ d, token, onDone, onInk }: { d: OfferToSign; token: string; onDone: (d: OfferToSign) => void; onInk: (inked: boolean) => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const ink = useCallback(
    (v: boolean) => {
      onInk(v);
      if (v) setEmpty(false);
    },
    [onInk],
  );

  const run = async (fn: () => Promise<OfferToSign>, fallback: string) => {
    setProblem(null);
    try {
      onDone(await fn());
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.fields.signature_png?.[0] ?? e.message) : fallback);
    }
  };
  const sign = () => {
    const png = pad.current?.toPng();
    if (!png) return setEmpty(true);
    return run(() => api.call("POST /api/public/v1/sign/:token/sign", { params: { token }, body: { signature_png: png } }), "The signature did not send. Try again.");
  };
  const decline = () => run(() => api.call("POST /api/public/v1/sign/:token/decline", { params: { token }, body: { reason: reason.trim() } }), "Could not record your answer. Try again.");
  const [last, ...rest] = [...d.letter].reverse();

  return (
    <div className="flex flex-col gap-7">
      <IssuedLetter label="The offer letter" meta={[d.company, "Lagos, Nigeria", formatDate(d.issued_at)]} title="Offer of Employment" paragraphs={rest.reverse()} from={last} />
      <Panel as="section" title="Sign Below">
        <SignatureField ref={pad} look="pad" hint="Draw your signature here" state={empty ? "bad" : undefined} onChange={ink} label="Signature box. Draw your signature with a finger or a mouse." />
        {empty && (
          <div className="mt-2">
            <FormError>Draw your signature</FormError>
          </div>
        )}
        {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
        {!declining ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <ActionGroup>
              <Button variant="line" size="lg" onClick={() => (setDeclining(true), setProblem(null))}>
                Decline the Offer
              </Button>
              <Button variant="primary" size="lg" onClick={sign}>
                Accept and Sign
              </Button>
            </ActionGroup>
          </div>
        ) : (
          <div className="mt-5 rounded-sheet border border-canvas-line-strong p-6 phone:p-4">
            <Field label="Reason for Declining" htmlFor="reason" optional>
              <TextAreaField id="reason" rows={4} value={reason} onChange={setReason} maxLength={1000} />
            </Field>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <ActionGroup>
                <Button variant="ghost" size="lg" onClick={() => (setDeclining(false), setProblem(null))}>
                  Back to the Offer
                </Button>
                <Button variant="line" size="lg" onClick={decline}>
                  Confirm Decline
                </Button>
              </ActionGroup>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Closed({ d }: { d: OfferToSign }) {
  const { navigate } = useRouter();
  return (
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
          <p>We emailed you a signed copy.</p>
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
          It expired on {formatDate(d.expires_at)} without a signature. If you still want the role, reply to the email the offer came with.
        </PageMessage>
      ) : (
        <PageMessage icon="alert" title="Offer Withdrawn">
          It can no longer be signed. If you think this is a mistake, reply to the email the offer came with.
        </PageMessage>
      )}
    </Panel>
  );
}

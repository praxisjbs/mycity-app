import { useState } from "react";
import type { VerifyByToken, VerifyResult } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { Button, Form, formatDate, formatTime, Match, PageMessage, Panel, Skeleton, TextField, VerifyCard } from "@mycity/ui";
import { Page } from "@/shell/Page";
import { useRouter } from "@/lib/router";

/**
 * Verify Document (#85, M5): two hashes, two verdicts (A12). The content hash is over the data the
 * document was rendered from; the artifact hash is over the stored bytes. One hash alone cannot tell
 * a changed record from a changed file. Anyone with the reference may look (`/verify/<number>`): the
 * type, the signer and the verdicts, never the content. The QR printed on each page of a sealed
 * document (`/verify/t/<token>`) also shows the document itself (docs/guides/partnerships.md §6.9).
 * The signatures routes answer it (VerifyResult, VerifyByToken): the record's status (an agreement's
 * own too: active, expiring, expired), every signer and when they signed (a paper signature by its
 * day, "signed outside the hub"), and the two verdicts; from the QR, an agreement's whole text.
 */
export function Verify({ number, qr }: { number: string | null; qr?: string }) {
  return (
    <Page
      title="Verify a Document"
      layout="split"
      name="Document Check"
      line="Offer letters, certificates and agreements"
      text="Check any document we issued."
      textSize="l"
      paragraph="Enter the reference printed on the document, for example OFF-0018, or scan the QR code on any of its pages."
      aside={<Lookup initial={number ?? ""} />}
    >
      {qr ? <ByToken token={qr} /> : number ? <ByNumber number={number} /> : <VerifyCard empty={{ title: "Enter a Reference", text: "The document's record shows here." }} />}
    </Page>
  );
}

/** The reference and Verify, in the aside: a reference opens its own address, so it can be shared. */
function Lookup({ initial }: { initial: string }) {
  const { navigate } = useRouter();
  const [ref, setRef] = useState(initial);
  const clean = ref.trim().toUpperCase();
  return (
    <Form className="flex max-w-130 gap-2.5 phone:flex-col" onSubmit={() => clean && navigate(`/verify/${encodeURIComponent(clean)}`)}>
      <div className="min-w-0 flex-1">
        <TextField aria-label="Reference" value={ref} onChange={setRef} placeholder="OFF-0018" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </div>
      <Button type="submit" variant="solid" size="lg">
        Verify
      </Button>
    </Form>
  );
}

/** The verdict in words: both hashes match, or which of the two was altered. */
function verdict(r: VerifyResult): { tone: "ok" | "warn"; title: string; text: string } {
  if (r.content === "matches" && r.artifact === "matches") return { tone: "ok", title: "Document Verified", text: "This document is genuine and unchanged." };
  if (r.content === "matches") return { tone: "warn", title: "Not This Document", text: "The stored file was altered." };
  if (r.artifact === "matches") return { tone: "warn", title: "Not This Document", text: "The record was altered." };
  return { tone: "warn", title: "Not This Document", text: "The record and the stored file were altered." };
}

const TYPE: Record<VerifyResult["document_type"], string> = { offer_letter: "Offer of employment", employment_contract: "Employment contract", agreement: "Partnership agreement" };
const STATUS: Record<VerifyResult["status"], string> = { pending: "Awaiting signatures", completed: "Signed by everyone", declined: "Declined", expired: "Expired unsigned", revoked: "Withdrawn" };
const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;
/** An agreement's own state beyond signing (record_status): active, expiring, expired past its end, renewed, closed. */
const RECORD: Record<string, string> = { signed: "Signed", active: "Active", expiring: "Expiring", expired: "Expired", renewed: "Renewed", closed: "Closed" };
const signerLabel = (role: VerifyResult["signers"][number]["role"]) => (role === "mycity" ? "For the Company" : role === "partner" ? "For the Partner" : "Signed By");

const rowsOf = (r: VerifyResult) => [
  { label: "Document", value: TYPE[r.document_type] },
  { label: "Reference", value: r.reference },
  { label: "Status", value: r.signed_outside ? "Signed outside the hub" : STATUS[r.status] },
  ...(r.record_status && RECORD[r.record_status] ? [{ label: TYPE[r.document_type].replace(/^Partnership /, "").replace(/^./, (c) => c.toUpperCase()), value: RECORD[r.record_status] }] : []),
  ...r.signers.map((s, i) => ({
    key: `signer-${i}`,
    label: signerLabel(s.role),
    value: s.signed_at ? `${s.name}, ${s.method === "paper" ? formatDate(s.signed_at) : when(s.signed_at)}` : `${s.name}, not signed`,
  })),
  { label: "Issued By", value: r.issued_by },
  { label: "Content Hash", value: <Match value={r.content} /> },
  { label: "Artifact Hash", value: <Match value={r.artifact} /> },
];

function ByNumber({ number }: { number: string }) {
  const r = useApi("GET /api/public/v1/verify/:ref", { params: { ref: number } });
  if (r.error)
    return r.error.status === 404 ? (
      <VerifyCard tone="err" title="Not Found" text="No document has this reference." items={[{ label: "Reference", value: number.toUpperCase() }]} note="Check the reference on the document and try again. It looks like OFF-0018." />
    ) : (
      <Failed message={r.error.message} retry={r.reload} />
    );
  if (!r.data) return <Waiting />;
  return <VerifyCard {...verdict(r.data)} items={rowsOf(r.data)} />;
}

function ByToken({ token }: { token: string }) {
  const r = useApi("GET /api/public/v1/verify/t/:token", { params: { token } });
  if (r.error)
    return r.error.status === 404 ? (
      <VerifyCard tone="err" title="Not Found" text="This code opens no document." note="Scan the whole code again, or enter the reference printed on the document." />
    ) : (
      <Failed message={r.error.message} retry={r.reload} />
    );
  const d: VerifyByToken | undefined = r.data;
  if (!d) return <Waiting />;
  // The opening of the letter: the line after the addressee, and the offer itself.
  const opening = d.document.letter.filter((l) => /^Dear |^We are pleased/.test(l));
  return (
    <VerifyCard
      {...verdict(d)}
      items={rowsOf(d)}
      document={{
        heading: "The Document",
        title: d.document.title,
        paragraphs: opening,
        blocks: d.document.blocks,
        action: (
          <Button variant="line" size="sm" icon="download" asChild>
            <a href={d.document.url} download={d.document.file_name}>
              Download PDF
            </a>
          </Button>
        ),
      }}
    />
  );
}

function Waiting() {
  return (
    <Panel>
      <Skeleton lines={7} />
    </Panel>
  );
}

function Failed({ message, retry }: { message: string; retry: () => unknown }) {
  return (
    <Panel bare>
      <PageMessage
        title="This Check Did Not Load"
        action={
          <Button variant="primary" size="lg" onClick={retry}>
            Try Again
          </Button>
        }
      >
        {message}
      </PageMessage>
    </Panel>
  );
}

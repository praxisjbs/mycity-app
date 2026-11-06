import { useState } from "react";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { VerifyByToken, VerifyResult } from "@/api/types/public";
import { Button, Form, formatDate, formatTime, Match, PageMessage, Panel, Skeleton, TextField, VerifyCard } from "@mycity/ui";
import { Page } from "@/shell/Page";
import { useRouter } from "@/lib/router";

/**
 * Verify Document (#85, M5): two hashes, two verdicts (A12). The content hash is over the data the
 * document was rendered from; the artifact hash is over the stored bytes. One hash alone cannot tell
 * a changed record from a changed file. Anyone with the reference may look (`/verify/<number>`): the
 * type, the signer and the verdicts, never the content. The QR printed on each page of a sealed
 * document (`/verify/t/<token>`) also shows the document itself (docs/guides/partnerships.md §6.9).
 * Built on the INTERIM shapes and the mock until M5's verify API lands (types/public.ts).
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

const rowsOf = (r: VerifyResult) => [
  { label: "Document", value: r.document_type },
  { label: "Reference", value: r.number },
  { label: "Signed By", value: r.signed_by },
  { label: "Signed On", value: `${formatDate(r.signed_at)}, ${formatTime(r.signed_at)}` },
  { label: "Issued By", value: r.issued_by },
  { label: "Content Hash", value: <Match value={r.content} /> },
  { label: "Artifact Hash", value: <Match value={r.artifact} /> },
];

function ByNumber({ number }: { number: string }) {
  const r = useApi("GET /api/public/v1/verify/:number", { params: { number } });
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
  const [dear, offer] = d.document.letter;
  return (
    <VerifyCard
      {...verdict(d)}
      items={rowsOf(d)}
      document={{
        heading: "The Document",
        title: d.document.title,
        paragraphs: [dear, offer].filter((p): p is string => !!p),
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

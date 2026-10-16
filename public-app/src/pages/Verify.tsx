import { useState, type ReactNode } from "react";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { VerifyResult } from "@/api/types/public";
import { Brand, Button, cn, Field, Form, formatDate, formatTime, Icon, Pill, Skeleton, TextField } from "@mycity/ui";
import { Page } from "@/shell/Page";
import { Sub } from "@/components/ui";
import { useRouter } from "@/lib/router";

/**
 * Verify Document (#85): two hashes, two verdicts (A12). The content hash is
 * over the data the document was rendered from; the artifact hash is over the
 * stored bytes. One hash alone cannot tell a changed record from a changed
 * file. Anyone with the reference may look; only the type, the signer and the
 * verdicts are shown. Never the file.
 */
const OUTCOME = (r: VerifyResult): { ok: boolean; title: string; text: string } => {
  if (r.content === "matches" && r.artifact === "matches") return { ok: true, title: "Document verified", text: "The content hash confirms the wording. The artifact hash confirms the stored file. Both match." };
  if (r.content === "matches") return { ok: false, title: "The stored file was altered", text: "The wording matches what was signed, but the stored file is not the one that was locked. Do not rely on a copy of it." };
  if (r.artifact === "matches") return { ok: false, title: "The record was altered", text: "The stored file is the one that was locked, but the record it was made from has changed since. Do not rely on it." };
  return { ok: false, title: "Not this document", text: "Neither the wording nor the stored file matches what was signed under this reference." };
};

export function Verify({ number }: { number: string | null }) {
  return (
    <Page title={number ? `Verify ${number}` : "Verify a Document"} brandInCard>
      <div className="text-center">
        <Brand name="MyCityApp" />
      </div>
      {number ? <Result number={number} /> : <Lookup />}
    </Page>
  );
}

function Lookup({ initial = "", heading }: { initial?: string; heading?: ReactNode }) {
  const { navigate } = useRouter();
  const [ref, setRef] = useState(initial);
  const clean = ref.trim().toUpperCase();
  return (
    <Form className="mx-auto mt-5 max-w-[380px]" onSubmit={() => clean && navigate(`/verify/${encodeURIComponent(clean)}`)}>
      {heading ?? (
        <>
          <h1 className="text-center text-[19px]">Verify a Document</h1>
          <Sub className="mt-1 mb-4 text-center">Enter the reference printed on the document, for example OFF-0018.</Sub>
        </>
      )}
      <Field label="Reference" htmlFor="ref">
        <TextField id="ref" value={ref} onChange={setRef} placeholder="OFF-0018" autoCapitalize="characters" spellCheck={false} />
      </Field>
      <Button type="submit" variant="primary" block className="mt-3" disabled={!clean}>
        Verify
      </Button>
    </Form>
  );
}

function Result({ number }: { number: string }) {
  const r = useApi("GET /api/public/v1/verify/:number", { params: { number } });
  if (r.error)
    return r.error.status === 404 ? (
      <Lookup
        initial={number}
        heading={
          <div className="mb-4 text-center">
            <Badge ok={false} />
            <h1 className="mt-3 text-[19px]">No document has this reference</h1>
            <Sub className="mt-1">Check the reference on the document and try again. It looks like OFF-0018.</Sub>
          </div>
        }
      />
    ) : (
      <div className="mt-6 text-center">
        <Sub>{r.error.message}</Sub>
        <Button className="mt-3" onClick={r.reload}>
          Try Again
        </Button>
      </div>
    );
  const d = r.data;
  if (!d)
    return (
      <div className="mt-6">
        <Skeleton lines={6} />
      </div>
    );
  const o = OUTCOME(d);
  const pill = (v: VerifyResult["content"]) => <Pill tone={v === "matches" ? "ok" : "err"}>{v === "matches" ? "Matches" : "Differs"}</Pill>;
  const rows: Array<[string, ReactNode]> = [
    ["Document", `${d.document_type}, ${d.number}`],
    ["Signed By", d.signed_by],
    ["Signed On", `${formatDate(d.signed_at)} at ${formatTime(d.signed_at)} WAT`],
    ["Content Hash", pill(d.content)],
    ["Artifact Hash", pill(d.artifact)],
    ["Issued By", d.issued_by],
  ];
  return (
    <>
      <div className="mt-[18px] text-center">
        <Badge ok={o.ok} />
        <h1 className="mt-3 text-[19px]">{o.title}</h1>
      </div>
      <dl className="mt-5 grid grid-cols-[150px_1fr] gap-x-3 gap-y-2.5 text-[13px] max-md:grid-cols-[120px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-subtle-foreground">{k}</dt>
            <dd className="m-0 font-[550]">{v}</dd>
          </div>
        ))}
      </dl>
      <Sub className={cn("mt-[18px] border-t border-border pt-3.5", !o.ok && "text-destructive")}>{o.text}</Sub>
    </>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span className={cn("mx-auto flex size-[58px] items-center justify-center rounded-full", ok ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive")}>
      <Icon name={ok ? "ok" : "x"} className="size-7" />
    </span>
  );
}

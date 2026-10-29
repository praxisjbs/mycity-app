import { useFileBlob } from "@/api/download";
import { DocumentPreview, EmptyState, Paper, PaperFoot, PaperLogo, PaperTitle, Signature } from "@mycity/ui";

/**
 * A letter's wording as the document engine fills it (the contract's LetterPreview), the
 * words taken from the record marked. Recruitment's offer letter (INTERIM) also carries
 * its signer and a line about the fields; a query or sanction letter signs in its body.
 */
export interface LetterLike {
  reference: string;
  title: string;
  date_line: string;
  paragraphs: Array<Array<{ text: string; filled?: boolean }>>;
  signer?: string;
  signer_role?: string;
  fields_note?: string;
}

export function Letter({ l, note = "Underlined words come from the record." }: { l: LetterLike; note?: string }) {
  return (
    <Paper note={note}>
      <PaperLogo reference={l.reference} />
      <PaperTitle sub={l.date_line}>{l.title}</PaperTitle>
      {l.paragraphs.map((p, i) => (
        <p key={i}>{p.map((x, j) => (x.filled ? <em key={j} className="underline decoration-dotted underline-offset-2">{x.text}</em> : <span key={j}>{x.text}</span>))}</p>
      ))}
      {l.signer && <div className="mt-3"><Signature>{l.signer}</Signature></div>}
      {l.signer_role && <p className="mt-0.5 border-t border-paper-dash pt-1 text-2xs text-paper-faint">{l.signer_role}</p>}
      {l.fields_note && <PaperFoot><span>{l.fields_note}</span></PaperFoot>}
    </Paper>
  );
}

/**
 * A letter already sent: the PDF the employee received, from the vault. Its bytes go to the viewer
 * with the link: the security policy lets no page read a blob URL back (connect-src 'self').
 */
export function LetterFile({ documentId, name }: { documentId: string | null; name: string }) {
  const { blob, href, failed } = useFileBlob(documentId ? `/api/v1/documents/${documentId}/content` : null);
  if (!documentId) return <EmptyState bare icon="doc" title="No Letter Yet" />;
  if (failed) return <EmptyState bare icon="doc" title="Letter Not Ready" text="It is still being made. Try again shortly." />;
  if (!blob || !href) return <EmptyState bare icon="doc" title="Opening Letter" />;
  return <DocumentPreview name={`${name}.pdf`} mime="application/pdf" href={href} file={blob} height="page" />;
}

/** The policy a query cites: its title, number and version, and the clause quoted. */
export function PolicyCited({ policy, clause }: { policy: { title: string; number: string; version: number }; clause: string | null }) {
  return (
    <span>
      {policy.title} ({policy.number}, Version {policy.version})
      {clause && <span className="block text-subtle-foreground" data-copy="content">{clause}</span>}
    </span>
  );
}

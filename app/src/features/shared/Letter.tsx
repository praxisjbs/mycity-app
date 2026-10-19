import { useFileUrl } from "@/api/download";
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

export function Letter({ l, note = "As it is sent. Everything underlined came from the record, not from typing." }: { l: LetterLike; note?: string }) {
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

/** A letter already sent: the PDF the employee received, from the vault. */
export function LetterFile({ documentId, name }: { documentId: string | null; name: string }) {
  const href = useFileUrl(documentId ? `/api/v1/documents/${documentId}/content` : null);
  if (!documentId) return <EmptyState bare icon="doc" title="No Letter Yet" text="It is written once approved." />;
  if (!href) return <EmptyState bare icon="doc" title="Opening" text="This takes a moment." />;
  return <DocumentPreview name={`${name}.pdf`} mime="application/pdf" href={href} />;
}

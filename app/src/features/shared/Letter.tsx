import type { LetterPreview } from "@/api/types/queries";
import { Paper, PaperFoot, PaperLogo, PaperTitle, Signature } from "@/components/ui/Paper";

/** A letter as the document engine fills it; the words taken from the record are marked. */
export function Letter({ l, note = "As it is sent. Everything underlined came from the record, not from typing." }: { l: LetterPreview; note?: string }) {
  return (
    <Paper note={note}>
      <PaperLogo reference={l.reference} />
      <PaperTitle sub={l.date_line}>{l.title}</PaperTitle>
      {l.paragraphs.map((p, i) => (
        <p key={i}>{p.map((x, j) => (x.filled ? <em key={j} className="underline decoration-dotted underline-offset-2">{x.text}</em> : <span key={j}>{x.text}</span>))}</p>
      ))}
      <div className="mt-3"><Signature>{l.signer}</Signature></div>
      <p className="mt-0.5 border-t border-paper-dash pt-1 text-[10.5px] text-paper-faint">{l.signer_role}</p>
      <PaperFoot><span>{l.fields_note}</span></PaperFoot>
    </Paper>
  );
}

/**
 * @component IssuedLetter
 * @group Documents
 * @summary A letter as it was issued, on white paper in both themes: a City Green to yellow rule along its top, the letterhead (the mark and the name, the company, its place and the date at the right), its title, its paragraphs and the line it is signed from.
 * @use The public site's Sign Offer: the offer's text exactly as the PDF has it, above Sign Below.
 * @avoid A document being laid out in the staff app (Paper); a file someone uploaded (DocumentPreview); text the page writes itself.
 * @phone 24 px inside; the letterhead stacks, the company and date under the mark, left aligned.
 * @a11y An article named by `label`; the letter's words are content (data-copy), never interface copy; the mark is decorative beside the name.
 * @status beta
 * @example <IssuedLetter label="The offer letter" meta={["MyCity App Ltd", "Lagos, Nigeria", "06/11/2026"]} title="Offer of Employment" paragraphs={offer.letter.slice(0, -1)} from={offer.letter.at(-1)} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Brand } from "../shell/Brand";

export interface IssuedLetterProps {
  /** Names the letter for assistive technology (The offer letter). */
  label: string;
  /** The lines at the letterhead's right: the company, its place, the date. */
  meta: ReadonlyArray<string>;
  /** The letter's title (Offer of Employment). */
  title: string;
  /** Its paragraphs, as the document has them. */
  paragraphs: ReadonlyArray<string>;
  /** The line it is signed from, in bold at its foot. */
  from?: ReactNode;
  /** The name beside the mark; MyCityApp unless set. */
  brand?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function IssuedLetter({ label, meta, title, paragraphs, from, brand = "MyCityApp", className }: IssuedLetterProps) {
  return (
    <article className={cn("ps-letter", className)} aria-label={label} {...content}>
      <div className="ps-lh">
        <span className="ps-lh-brand">
          <span aria-hidden="true">
            <Brand tile="deep" />
          </span>
          <b>{brand}</b>
        </span>
        <small>
          {meta.map((m, i) => (
            <span key={i} className="block">
              {m}
            </span>
          ))}
        </small>
      </div>
      <h2>{title}</h2>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {from != null && <p className="ps-sig-from">{from}</p>}
    </article>
  );
}

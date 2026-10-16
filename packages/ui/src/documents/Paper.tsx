/**
 * @component Paper
 * @group Documents
 * @summary A document the product generated, as it will print: white paper in both themes, with the City Green mark and its yellow rule.
 * @use An offer, a payslip, an invoice, a letter, a certificate: anything the document engine will render as a PDF.
 * @avoid A file someone uploaded (use DocumentPreview); a screen's own content dressed as paper; colours of the theme rather than the paper tokens.
 * @phone The sheet keeps its proportions with tighter margins, so what is on screen is what will print.
 * @a11y The document's text is content, not interface copy, so the copy gates skip it and a screen reader reads it as written.
 * @status stable
 * @exports PaperLogo, PaperTitle, PaperTable, PaperFoot, Signature
 * @example <Paper note="This is how the letter will print"><PaperLogo reference="OFF/2026/0041" /><PaperTitle>Offer of Employment</PaperTitle></Paper>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";

export interface PaperProps {
  /** What goes on the paper. */
  children: ReactNode;
  /** One line above the sheet, at most 8 words: what this is. */
  note?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Paper({ children, note, className }: PaperProps) {
  return (
    <div className={cn("rounded-card border border-border bg-muted px-4 py-5", className)}>
      {note != null && (
        <p className="mb-3.5 flex items-center justify-center gap-2 text-2xs text-subtle-foreground">
          <Icon name="doc" size="s" />
          {note}
        </p>
      )}
      <div {...content} className="mx-auto max-w-prose rounded-box border border-border bg-paper px-7 py-6 text-xs leading-relaxed text-paper-ink shadow-2 phone:px-4 phone:py-4">
        {children}
      </div>
    </div>
  );
}

export interface PaperLogoProps {
  /** The document's own number, from `numbering.allocate()`. */
  reference: string;
}

/** The letterhead: the pin, the company, the document's number, and the yellow rule under them. */
export function PaperLogo({ reference }: PaperLogoProps) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b-2 border-paper-gold pb-3 text-paper-brand">
      <Icon name="pin" size="m" />
      <b className="text-base">MyCity App Ltd</b>
      <em className="ml-auto text-2xs tracking-caps text-paper-faint not-italic">{reference}</em>
    </div>
  );
}

export interface PaperTitleProps {
  /** What the document is ("Offer of Employment"). */
  children: ReactNode;
  /** The line under it: who it is for, the date it takes effect. */
  sub?: ReactNode;
}

/** The document's own heading, inside the sheet. */
export function PaperTitle({ children, sub }: PaperTitleProps) {
  return (
    <>
      <h3 className="text-md text-paper-heading">{children}</h3>
      {sub != null && <p className="mt-0.5 text-2xs text-paper-muted">{sub}</p>}
    </>
  );
}

export interface PaperTableProps {
  /** The two column headings. */
  head: [ReactNode, ReactNode];
  /** The lines, each a label and an amount. */
  rows: Array<[ReactNode, ReactNode]>;
  /** The lines ruled off in City Green at the foot (Gross, Net). */
  totals?: Array<[ReactNode, ReactNode]>;
}

/** A table on paper: a payslip's lines, an invoice's items. */
export function PaperTable({ head, rows, totals }: PaperTableProps) {
  return (
    <table className="mt-2.5 w-full border-collapse text-2xs">
      <thead>
        <tr>
          <th scope="col" className="border-b border-paper-line bg-paper-head px-2.5 py-1.5 text-left tracking-caps text-paper-muted uppercase">
            {head[0]}
          </th>
          <th scope="col" className="border-b border-paper-line bg-paper-head px-2.5 py-1.5 text-right tracking-caps text-paper-muted uppercase">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, amount], i) => (
          <tr key={i}>
            <td className="border-b border-paper-rule px-2.5 py-1.5">{label}</td>
            <td className="border-b border-paper-rule px-2.5 py-1.5 text-right tabular-nums">{amount}</td>
          </tr>
        ))}
        {totals?.map(([label, amount], i) => (
          <tr key={`t${i}`}>
            <td className="border-t-2 border-paper-brand bg-paper-head px-2.5 py-1.5 font-bold">{label}</td>
            <td className="border-t-2 border-paper-brand bg-paper-head px-2.5 py-1.5 text-right font-bold tabular-nums">{amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface PaperFootProps {
  /** The footer's pieces: who signed, when, the verification number. */
  children: ReactNode;
}

/** The dashed rule and the small print at the foot of the sheet. */
export function PaperFoot({ children }: PaperFootProps) {
  return <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-dashed border-paper-dash pt-3 text-2xs text-paper-faint">{children}</div>;
}

export interface SignatureProps {
  /** The signed name. */
  children: ReactNode;
}

/** A signed name in the execution block, in the script face. */
export function Signature({ children }: SignatureProps) {
  return <span className="font-script text-2xl text-paper-heading">{children}</span>;
}

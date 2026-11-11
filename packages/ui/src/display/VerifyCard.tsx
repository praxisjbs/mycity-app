/**
 * @component VerifyCard
 * @group Display
 * @summary What a check of a document found, on the site's large card: before any check a Deep Green shield over a title and a line; after it a verdict band (verified in green, altered in amber, not found in red) with its glyph, the record as label and value rows with each hash marked Matches or Differs, a note, and for a QR check the document itself (an agreement's headings, clauses and tables included) with its download.
 * @use The right-hand card of Verify a Document (/verify, /verify/<number>, /verify/t/<token>).
 * @avoid A form's outcome (PageMessage); a notice about the system (Banner); the staff app.
 * @phone Full width; the band and the rows keep 20 px at their sides.
 * @a11y A live region, so a new verdict is heard when it lands; the verdict is in words (the title and its line), never colour alone, and each hash says Matches or Differs beside its glyph; the glyphs are decorative. The record's values and the document are content. Match is exported for a hash's mark.
 * @status beta
 * @exports Match
 * @example <VerifyCard empty={{ title: "Enter a Reference", text: "The document's record shows here." }} />
 * @example <VerifyCard tone="ok" title="Document Verified" text="This document is genuine and unchanged." items={rows} />
 */
import { RichText, type RichTextBlock } from "../documents/RichText";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";
import { KeyValue, type KeyValueItem } from "./KeyValue";

export interface VerifyCardProps {
  /** The verdict's tone: `ok` verified, `warn` altered, `err` not found. Left out, the card waits for a check (`empty`). */
  tone?: "ok" | "warn" | "err";
  /** The verdict, at most 4 words (Document Verified, Not This Document, Not Found). */
  title?: ReactNode;
  /** One line under it (This document is genuine and unchanged.). */
  text?: ReactNode;
  /** The record, label and value (Document, Reference, Signed By, Signed On, Issued By, Content Hash, Artifact Hash). */
  items?: ReadonlyArray<KeyValueItem>;
  /** A line under the rows (what to do when nothing was found). */
  note?: ReactNode;
  /**
   * A QR check's document: its heading, title, opening words and its download; or, for a document with
   * headings, clauses and tables (an agreement), the whole text as `blocks`, drawn in place of the words.
   */
  document?: { heading: string; title: string; paragraphs: ReadonlyArray<string>; blocks?: RichTextBlock[] | null; action?: ReactNode };
  /** Before a check: the title and line under the shield. */
  empty?: { title: string; text: string };
  /** Layout classes only (spacing). */
  className?: string;
}

export function VerifyCard({ tone, title, text, items = [], note, document, empty, className }: VerifyCardProps) {
  return (
    <div className={cn("ps-result", className)} data-tone={tone} aria-live="polite">
      {tone == null ? (
        <div className="ps-result-empty">
          <span aria-hidden="true" className="ps-shield">
            <Icon name="shieldok" className="size-14" />
          </span>
          {empty && (
            <>
              <b data-ui="title">{empty.title}</b>
              <span>{empty.text}</span>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="ps-verdict">
            <span aria-hidden="true" className="ps-verdict-ic">
              <Icon name={tone === "ok" ? "ok" : "x"} className="size-7.5" />
            </span>
            <div>
              <h2 data-ui="title">{title}</h2>
              {text != null && <p>{text}</p>}
            </div>
          </div>
          {items.length > 0 && <KeyValue layout="rows" items={items} className="ps-result-kv" />}
          {note != null && <p className="ps-result-note">{note}</p>}
          {document && (
            <div className="ps-qrdoc" {...content}>
              <span className="ps-qrdoc-h">{document.heading}</span>
              <p>
                <b>{document.title}</b>
              </p>
              {document.blocks && document.blocks.length > 0 ? (
                <RichText look="site" blocks={document.blocks} top={3} />
              ) : (
                document.paragraphs.map((p, i) => <p key={i}>{p}</p>)
              )}
              {document.action != null && <div className="ps-qrdoc-act">{document.action}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface MatchProps {
  /** What the check found: the hash matches what was sealed, or differs from it. */
  value: "matches" | "differs";
}

/** A hash's verdict: a tick and Matches, or a cross and Differs. */
export function Match({ value }: MatchProps) {
  return (
    <span className="ps-match" data-match={value}>
      <Icon name={value === "matches" ? "ok" : "x"} className="size-4" />
      {value === "matches" ? "Matches" : "Differs"}
    </span>
  );
}

/**
 * @component DocumentEditor
 * @group Forms
 * @summary The editor for an agreement template's wording: headings, numbered clauses, tables, and named fields drawn as chips.
 * @use An agreement template on Categories, and Tidy With AI's draft before it is kept. A chip stands for a value filled when the agreement is made (a business name, the deal's options).
 * @avoid A message, an announcement or a policy (use RichTextField); a short answer (TextField); fields typed by hand as braces, which the editor never asks of a person.
 * @phone The toolbar wraps and every control is 44 px; Insert Field opens the branded sheet; a table scrolls inside its own box and the page never scrolls sideways.
 * @a11y A named multi-line textbox with a formatting group whose buttons say whether they are on; a chip is one unit read by its label and removed with Backspace; the whole toolbar is reachable by Tab.
 * @status stable
 * @example <Field label="Wording" {...f.status("body_html")}><DocumentEditor label="Wording" fields={fields} {...f.field("body_html")} /></Field>
 */
import { Suspense } from "react";
import { Skeleton } from "../display/Skeleton";
import { lazyDraw } from "../charts/lazy";
import { useFieldControl } from "./Field";
import type { FieldState } from "./binding";
import type { DocumentEditorDrawProps } from "./DocumentEditor.draw";

const Draw = lazyDraw<DocumentEditorDrawProps>(() => import("./DocumentEditor.draw"));

/** A value the wording may name, and how its chip is written in the saved wording. */
export interface DocumentEditorField {
  /** The name inside the braces: `partner.name`, `custom.ticket_model`, `ask.opening_hours`. */
  field: string;
  /** What the chip reads, Title Case, at most 4 words: "Business Name". */
  label: string;
  /** What the saved wording carries for it, formats included: `{{ longdate deal.valid_until }}`. */
  tag: string;
  /** The group it is listed under in Insert Field: "Partner", "Deal", "Ask". */
  group?: string;
}

export interface DocumentEditorProps {
  /** The HTML, as the server hands it back (chips are `span[data-field]`). */
  value: string;
  /** Called with the new HTML, or "" when the box is emptied. */
  onChange: (html: string) => void;
  /** Called when the person leaves the box: the moment it is first checked. */
  onBlur?: () => void;
  /** Names the box, Title Case, at most 4 words; the Field's label otherwise. */
  label: string;
  /** Every value the wording may name, offered by Insert Field; a chip the list lacks still shows by its own label. */
  fields: DocumentEditorField[];
  /** A format example of at most 3 words, never an instruction. */
  placeholder?: string;
  /** Read it without being able to change it. */
  readOnly?: boolean;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id, when the caller sets it; the Field's otherwise. */
  id?: string;
}

export function DocumentEditor({ value, onChange, onBlur, label, fields, placeholder = "", readOnly, state, message: _message, id }: DocumentEditorProps) {
  const a = useFieldControl({ id, state });
  return (
    <Suspense fallback={<Skeleton shape="block" className="h-72" />}>
      <Draw
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        label={label}
        fields={fields}
        readOnly={readOnly}
        bad={a.state === "bad"}
        id={a.id}
        describedBy={a["aria-describedby"]}
      />
    </Suspense>
  );
}

/**
 * @component RichTextField
 * @group Forms
 * @summary Long text with the little formatting a message needs, loaded only when a composer opens.
 * @use A mail body, an announcement, a letter's own paragraphs, a policy's text.
 * @avoid Any short answer (use TextField); a note nobody formats (use TextAreaField); pasting a whole page of foreign markup into a record.
 * @phone The toolbar wraps and every button is 44 px; the box grows with the text rather than scrolling inside itself.
 * @a11y A named multi-line textbox with a formatting group whose buttons say whether they are on; the whole toolbar is reachable by Tab.
 * @status stable
 * @example <Field label="Message" {...f.status("body")}><RichTextField label="Message" {...f.field("body")} /></Field>
 */
import { Suspense } from "react";
import { Skeleton } from "../display/Skeleton";
import { lazyDraw } from "../charts/lazy";
import { useFieldControl } from "./Field";
import type { FieldState } from "./binding";
import type { RichTextDrawProps } from "./RichTextField.draw";

const Draw = lazyDraw<RichTextDrawProps>(() => import("./RichTextField.draw"));

export interface RichTextFieldProps {
  /** The HTML, as the record stores it. */
  value: string;
  /** Called with the new HTML, or "" when the box is emptied. */
  onChange: (html: string) => void;
  /** Called when the person leaves the box: the moment it is first checked. */
  onBlur?: () => void;
  /** Names the box, Title Case, at most 4 words; the Field's label otherwise. */
  label: string;
  /** A format example of at most 3 words, never an instruction. */
  placeholder?: string;
  /** Read it without being able to change it (a sent message, a signed letter). */
  readOnly?: boolean;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id, when the caller sets it; the Field's otherwise. */
  id?: string;
}

export function RichTextField({ value, onChange, onBlur, label, placeholder = "", readOnly, state, message: _message, id }: RichTextFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <Suspense fallback={<Skeleton shape="block" className="h-36" />}>
      <Draw
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        label={label}
        readOnly={readOnly}
        bad={a.state === "bad"}
        id={a.id}
        describedBy={a["aria-describedby"]}
      />
    </Suspense>
  );
}

/**
 * @component SecretField
 * @group Forms
 * @summary A password or an API key the server may already keep: Saved (with a key's last four) and Replace, never a character of what is saved.
 * @use A secret in a settings form that the server never sends back (a mail password, a provider's key), where leaving the field alone keeps the saved one.
 * @avoid Signing in or choosing your own password (use PasswordField); a value a person may read back (use TextField).
 * @phone The same: Replace and Keep Saved are 44 px buttons beside the line, and the field Replace opens fills the rest of the width.
 * @a11y The saved line is a read-only field named by the Field's label; Replace moves focus into the new field and Keep Saved back to Replace. The caller passes `saved` and, for a key, `hint`.
 * @status beta
 * @example <Field label="API Key"><SecretField saved={key.set} hint={key.hint} noun="key" {...form.field("api_key")} /></Field>
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass, PasswordField } from "./TextField";

export interface SecretFieldProps {
  /** What was typed, from form.field(name). Empty keeps the saved one. */
  value: string;
  /** Called with the new value. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** One is saved: the field reads Saved and offers Replace instead of an empty box. */
  saved?: boolean;
  /** What may be shown of the saved one: a key's last four characters. Never any part of a password. */
  hint?: string | null;
  /** What it is, for the show and hide button: password (the default) or key. */
  noun?: "password" | "key";
  /** The control's id when no Field gives one. */
  id?: string;
  /** Layout classes only (spacing, width). */
  className?: string;
}

export function SecretField({ value, onChange, onBlur, state, message: _message, saved = false, hint, noun = "password", id, className }: SecretFieldProps) {
  const { state: mark, ...control } = useFieldControl({ id, state });
  const [replacing, setReplacing] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const moved = useRef<"in" | "out" | null>(null);
  const open = !saved || replacing || value !== "";

  useEffect(() => {
    if (!moved.current) return;
    const target = moved.current === "in" ? box.current?.querySelector("input") : box.current?.querySelector("button");
    moved.current = null;
    target?.focus();
  }, [open]);

  if (!open)
    return (
      <span ref={box} className={cn("flex items-center gap-2", className)}>
        <input
          {...control}
          readOnly
          data-copy="content"
          className={cn(controlClass(mark), "h-control bg-muted text-muted-foreground")}
          value={hint ? `Saved, ends ${hint}` : "Saved"}
        />
        <Button
          size="sm"
          onClick={() => {
            moved.current = "in";
            setReplacing(true);
          }}
        >
          Replace
        </Button>
      </span>
    );

  return (
    <span ref={box} className={cn("flex items-center gap-2", className)}>
      <span className="min-w-0 flex-1">
        <PasswordField {...control} state={mark} value={value} onChange={onChange} onBlur={onBlur} noun={noun} autoComplete="new-password" />
      </span>
      {saved && (
        <Button
          size="sm"
          onClick={() => {
            moved.current = "out";
            onChange("");
            setReplacing(false);
          }}
        >
          Keep Saved
        </Button>
      )}
    </span>
  );
}

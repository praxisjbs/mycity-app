/**
 * The form hook (FRONTEND_GUIDE §8.3): react-hook-form validating with the
 * contract's own Zod schema, the rule the API applies, so a field rule cannot
 * differ on the two sides. The frontend writes no rules of its own.
 *
 *   import { schemas } from "@mycity/contract/contract.gen";
 *   const form = useContractForm(schemas.organisation.EmployeeCreate, { first_name: "", ... });
 *   <Form onSubmit={form.submit((employee) => save.run(employee))}>
 *     <Field label="First Name" {...form.status("first_name")}><TextField {...form.field("first_name")} /></Field>
 *
 * Reward early, punish late: a field is first checked when the person leaves
 * it, or after they pause typing for 600 ms; once marked it is re-checked on
 * every change, so the mark clears the moment it is fixed. Submit is never
 * disabled: it checks everything, marks every problem and moves focus to the
 * first. A server 422's `fields` land on the same marks. Messages are at most
 * 4 words (gate 12): the contract's own message when it is that short, else a
 * short one chosen by the kind of problem.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm as useHookForm, type FieldError, type FieldValues, type Path, type PathValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import type { FieldBinding, FieldState, ServerFields } from "./binding";

/** Milliseconds of no typing after which an untouched field is first checked. */
export const PAUSE_MS = 600;

const words = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A field error as at most 4 words: the contract's message when it fits, else one by kind. */
export function shortMessage(error: Pick<FieldError, "type" | "message"> | undefined): string | undefined {
  if (!error) return undefined;
  const message = String(error.message ?? "");
  if (error.type === "server" && message) return message;
  switch (error.type) {
    case "invalid_type":
      return "Required";
    case "too_small":
      return /at least 1 /.test(message) ? "Required" : "Too short";
    case "too_big":
      return "Too long";
    case "invalid_enum_value":
      return "Choose one";
    case "invalid_date":
      return "Not a real date";
    case "invalid_string":
      return /email/i.test(message) ? "Check the email" : "Check the format";
    default:
      return message && words(message).length <= 4 ? sentence(message) : "Check this value";
  }
}

export interface ContractFormOptions {
  /** The pause before an untouched field is first checked; 600 ms. */
  pauseMs?: number;
}

/* The schema's input type (what the fields hold) and output type (what submit receives). */
type AnySchema = z.ZodType<unknown, z.ZodTypeDef, unknown>;

export function useContractForm<S extends AnySchema, In extends FieldValues = z.input<S> & FieldValues, Out = z.output<S>>(
  schema: S,
  initial: In,
  { pauseMs = PAUSE_MS }: ContractFormOptions = {},
) {
  const form = useHookForm<In, unknown, Out>({
    // The resolver's overloads cover Zod 3 and 4; the contract is Zod 3.
    resolver: zodResolver(schema as never) as never,
    defaultValues: initial as never,
    mode: "onTouched",
    reValidateMode: "onChange",
    shouldFocusError: false,
  });
  const values = form.watch();
  const { errors, isDirty, isSubmitting } = form.formState;
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  const show = useCallback((k: string) => setShown((s) => (s[k] ? s : { ...s, [k]: true })), []);
  const errorOf = (k: string) => (errors as Record<string, FieldError | undefined>)[k];
  const marked = (k: string) => !!shown[k] || !!errorOf(k);

  const stateOf = (k: string): FieldState => {
    if (!marked(k)) return undefined;
    if (errorOf(k)) return "bad";
    const v = (values as Record<string, unknown>)[k];
    return v !== "" && v != null ? "good" : undefined;
  };

  /** Props for a field control: its value, change handler and mark. */
  const field = <K extends Path<In>>(k: K): FieldBinding<PathValue<In, K>> & { name: K } => ({
    name: k,
    value: form.getValues(k),
    onChange: (v) => {
      form.setValue(k, v, { shouldDirty: true });
      clearTimeout(timers.current[k]);
      if (marked(k)) void form.trigger(k);
      else
        timers.current[k] = setTimeout(() => {
          show(k);
          void form.trigger(k);
        }, pauseMs);
    },
    onBlur: () => {
      clearTimeout(timers.current[k]);
      show(k);
      void form.trigger(k);
    },
    state: stateOf(k),
    message: marked(k) ? shortMessage(errorOf(k)) : undefined,
  });

  /** Props for the Field around a control: its mark and message. */
  const status = (k: Path<In>) => ({ state: stateOf(k), message: marked(k) ? shortMessage(errorOf(k)) : undefined });

  const markAll = () => setShown(Object.fromEntries(Object.keys(form.getValues()).map((k) => [k, true])));

  /** Focus the first field with a problem, in the order the form declares them. */
  const focusFirst = () => {
    const first = Object.keys(form.getValues()).find((k) => errorOf(k) ?? form.getFieldState(k as Path<In>).error);
    if (!first || typeof document === "undefined") return;
    const el = document.getElementsByName(first)[0] as HTMLElement | undefined;
    el?.focus();
  };

  /** Check every field and mark every problem; true when the form is clean. */
  const check = async () => {
    markAll();
    const ok = await form.trigger();
    if (!ok) focusFirst();
    return ok;
  };

  /** A submit handler for <Form onSubmit>: checks everything, then calls onValid with the parsed values. */
  const submit = (onValid: (data: Out) => unknown) => () =>
    form.handleSubmit(
      (data) => onValid(data),
      () => {
        markAll();
        setTimeout(focusFirst, 0);
      },
    )();

  /** Put a server 422's fields on the same marks. */
  const setServerErrors = (fields: ServerFields) => {
    for (const [k, list] of Object.entries(fields)) {
      if (!list?.length) continue;
      form.setError(k as Path<In>, { type: "server", message: list[0] });
      show(k);
    }
  };

  return {
    values: values as In,
    field,
    status,
    check,
    submit,
    setServerErrors,
    reset: form.reset,
    /** True once anything changed: a modal asks before discarding. */
    isDirty,
    isSubmitting,
    valid: Object.keys(errors).length === 0,
    /** The react-hook-form instance, for the rare case the binding does not cover. */
    hookForm: form,
  };
}

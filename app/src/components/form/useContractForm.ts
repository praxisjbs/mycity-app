import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm as useHookForm, type DefaultValues, type FieldErrors, type FieldValues, type Path, type PathValue, type Resolver } from "react-hook-form";

/**
 * The one form hook (FRONTEND_GUIDE §8.3, §8.6), on react-hook-form.
 *
 *   const f = useContractForm({ title: "", due: "" }, schema);
 *   <Field label="Title" {...f.field("title")}><TextField {...f.field("title")} /></Field>
 *   <FormFooter><Button variant="primary" onClick={() => f.check() && save()}>Create Task</Button></FormFooter>
 *
 * The rules come from the contract: pass the Zod schema the API validates with
 * (packages/contract/schemas/<module>.js). Until a module's schemas land, pass
 * its INTERIM rules instead (a function per field, a few words per message);
 * swapping one for the other changes nothing else in the form.
 *
 * Reward early, punish late: a field is checked when the person leaves it, or
 * after they pause typing for about 600 ms. Once a field is marked it is
 * re-checked on every keystroke, so the mark clears the moment it is fixed.
 * check() marks every problem, moves focus to the first one and returns
 * whether the form is clean; Submit is never disabled. The server's 422
 * `fields` land on the same marks (setServerErrors).
 */
type Rule<V> = (value: V, all: Record<string, unknown>) => string | null | undefined;
export type FormRules<T> = Partial<{ [K in keyof T]: Rule<T[K]> }>;

/** A contract schema: anything with Zod's safeParse. The frontend declares no Zod of its own. */
export interface ContractSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

const PAUSE_MS = 600;
const isSchema = (r: unknown): r is ContractSchema => !!r && typeof (r as ContractSchema).safeParse === "function";

/** Every field's first problem, from the schema or the INTERIM rules. */
function problemsOf<T extends Record<string, unknown>>(values: T, rules: FormRules<T> | ContractSchema): Partial<Record<keyof T, string>> {
  const out: Partial<Record<keyof T, string>> = {};
  if (isSchema(rules)) {
    const r = rules.safeParse(values);
    for (const issue of r.success ? [] : (r.error?.issues ?? [])) {
      const k = String(issue.path[0] ?? "") as keyof T;
      if (k && !out[k]) out[k] = issue.message;
    }
    return out;
  }
  for (const k of Object.keys(rules) as Array<keyof T>) {
    const msg = rules[k]?.(values[k], values);
    if (msg) out[k] = msg;
  }
  return out;
}

export function useContractForm<T extends Record<string, unknown>>(initial: T, rules: FormRules<T> | ContractSchema = {}) {
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const resolver = useCallback<Resolver<FieldValues>>(async (values) => {
    const problems = problemsOf(values as T, rulesRef.current);
    const errors: FieldErrors<FieldValues> = {};
    for (const [k, message] of Object.entries(problems)) errors[k] = { type: "contract", message: message as string };
    return Object.keys(errors).length ? { values: {}, errors } : { values, errors: {} };
  }, []);

  const form = useHookForm<FieldValues>({ defaultValues: initial as DefaultValues<FieldValues>, mode: "onTouched", reValidateMode: "onChange", resolver });
  const values = form.watch() as T;
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [server, setServer] = useState<Record<string, string[]>>({});
  const timers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);

  const local = useMemo(() => problemsOf(values, rules), [values, rules]);
  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = { ...local };
    for (const [k, msgs] of Object.entries(server)) if (msgs[0] && !out[k as keyof T]) out[k as keyof T] = msgs[0];
    return out;
  }, [local, server]);

  const touch = useCallback((k: keyof T) => setTouched((s) => (s[k] ? s : { ...s, [k]: true })), []);

  const set = useCallback(
    <K extends keyof T>(k: K, v: T[K]) => {
      const name = k as Path<FieldValues>;
      form.setValue(name, v as PathValue<FieldValues, Path<FieldValues>>, { shouldDirty: true });
      setServer((s) => {
        if (!(k in s)) return s;
        const next = { ...s };
        delete next[k as string];
        return next;
      });
      // An untouched field is checked once the person pauses; a marked one on every keystroke (it re-renders from `errors`).
      window.clearTimeout(timers.current[k as string]);
      timers.current[k as string] = window.setTimeout(() => {
        touch(k);
        void form.trigger(name);
      }, PAUSE_MS);
    },
    [form, touch],
  );

  const setValues = useCallback(
    (next: T | ((prev: T) => T)) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(form.getValues() as T) : next;
      for (const [k, x] of Object.entries(v)) form.setValue(k as Path<FieldValues>, x as PathValue<FieldValues, Path<FieldValues>>, { shouldDirty: true });
    },
    [form],
  );

  /** Props for a field: its value, change and blur handlers, its mark and its message. */
  const field = <K extends keyof T>(k: K) => {
    const shown = touched[k] || server[k as string];
    const message = shown ? errors[k] : undefined;
    const value = values[k];
    return {
      value,
      onChange: (v: T[K]) => set(k, v),
      onBlur: () => {
        touch(k);
        void form.trigger(k as Path<FieldValues>);
      },
      state: (shown ? (message ? "bad" : value !== "" && value != null ? "good" : undefined) : undefined) as "bad" | "good" | undefined,
      message,
    };
  };

  /**
   * Mark every field (or only `keys`, for a wizard step), move focus to the
   * first problem and say whether they are clean. Never disables anything.
   */
  const check = (keys?: Array<keyof T>) => {
    const all = (keys ?? (Object.keys(form.getValues()) as Array<keyof T>)) as Array<keyof T>;
    setTouched((s) => ({ ...s, ...Object.fromEntries(all.map((k) => [k, true])) }));
    void form.trigger(all as Array<Path<FieldValues>>);
    const now = { ...problemsOf(form.getValues() as T, rulesRef.current), ...Object.fromEntries(Object.entries(server).map(([k, m]) => [k, m[0]])) } as Partial<Record<keyof T, string>>;
    const bad = all.filter((k) => now[k]);
    if (bad.length) {
      window.requestAnimationFrame(() => {
        const scope = document.querySelector("[data-ui=modal]") ?? document;
        scope.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      });
    }
    return bad.length === 0;
  };

  return { values, setValues, set, field, errors, check, setServerErrors: setServer, valid: Object.keys(errors).length === 0 };
}

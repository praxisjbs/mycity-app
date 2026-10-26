/**
 * The one form hook (FRONTEND_GUIDE §8.3, §8.6), on react-hook-form.
 *
 *   const f = useContractForm({ title: "", due: "" }, schemas.workspace.TaskCreate);
 *   <Field label="Title" {...f.field("title")}><TextField {...f.field("title")} /></Field>
 *   <FormFooter><Button variant="primary" onClick={() => f.check() && save()}>Create Task</Button></FormFooter>
 *
 * The rules come from the contract: pass the Zod schema the API validates with
 * (packages/contract/schemas/<module>.js). Until a module's schemas land, pass
 * its INTERIM rules instead (a function per field, `rules` below); swapping one
 * for the other changes nothing else in the form.
 *
 * Reward early, punish late: a field is checked when the person leaves it, or
 * after they pause typing for about 600 ms. Once a field is marked it is
 * re-checked on every keystroke, so the mark clears the moment it is fixed.
 * check() marks every problem, moves focus to the first one and returns
 * whether the form is clean; Submit is never disabled. The server's 422
 * `fields` land on the same marks (setServerErrors), and so does what a control
 * alone can see (the binding's onProblem: a typed date that is not real, or one
 * outside the field's min and max). Messages are at most 4
 * words (gate 12): the contract's own message when it is that short, else a
 * short one chosen by the kind of problem.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm as useHookForm, type DefaultValues, type FieldErrors, type FieldValues, type Path, type PathValue, type Resolver } from "react-hook-form";
import type { FieldBinding, FieldState, ServerFields } from "./binding";

/** Milliseconds of no typing after which an untouched field is first checked. */
export const PAUSE_MS = 600;

/** An INTERIM rule: the field's problem in at most 4 words, or nothing when it is right. */
export type Validator<V> = (value: V, all: Record<string, unknown>) => string | null | undefined;

/** INTERIM rules, one per field, until the module's contract schema exists. */
export type FormRules<T> = Partial<{ [K in keyof T]: Validator<T[K]> }>;

/** A contract schema: anything with Zod's safeParse. The frontend declares no Zod of its own. */
export interface ContractSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> } };
}

export interface ContractFormOptions {
  /** The pause before an untouched field is first checked; 600 ms. */
  pauseMs?: number;
}

const words = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A limit as a person reads it: 4000 is "4,000". */
const grouped = (n: string) => (/^\d{4,}$/.test(n) ? Number(n).toLocaleString("en-GB") : n);

/**
 * Zod's own sentence for a limit, as the limit in short words: "Number must be less than or equal
 * to 168" reads "At most 168", "String must contain at least 3 character(s)" reads "At least 3
 * characters", "Array must contain at most 5 element(s)" reads "At most 5". A server 422 carries
 * these sentences raw, so they are read whatever kind the problem arrives as.
 */
function zodLimit(message: string): string | undefined {
  const size = /^(String|Array|Set) must contain (at least|at most|exactly) (\d+) /.exec(message);
  if (size) {
    const [, kind, how, count = "0"] = size;
    const n = Number(count);
    if (how === "at least" && n <= 1) return "Required";
    const unit = kind === "String" ? (n === 1 ? " character" : " characters") : "";
    return `${how === "at least" ? "At least" : how === "at most" ? "At most" : "Exactly"} ${grouped(count)}${unit}`;
  }
  const bound = /^(?:Number|BigInt|Date) must be (greater than or equal to|greater than|less than or equal to|less than|exactly equal to) (\S+?)\.?$/.exec(message);
  const words: Record<string, string> = { "greater than or equal to": "At least", "greater than": "Over", "less than or equal to": "At most", "less than": "Under", "exactly equal to": "Exactly" };
  if (bound) return `${words[bound[1] ?? ""] ?? "Check"} ${grouped(bound[2] ?? "")}`;
  if (/^Number must be a multiple of/.test(message)) return "Check the number";
  if (/^Expected integer/.test(message)) return "Whole numbers only";
  return undefined;
}

/** Zod's own words for a wrong string ("Invalid", "Invalid email"), never a schema's. */
const zodInvalid = (message: string) => !message || /^Invalid( |$)/.test(message);

/** A contract problem as at most 4 words: its own message when it fits, else one by kind. */
export function shortMessage(error: { type?: string; message?: string } | undefined): string | undefined {
  if (!error) return undefined;
  const message = String(error.message ?? "");
  const limit = zodLimit(message);
  if (limit) return limit;
  switch (error.type) {
    case "invalid_type":
      // A schema's own message for a missing or wrong value ("Pick an address") over the generic one.
      return message && !/^(Required|Expected )/.test(message) && words(message).length <= 4 ? sentence(message) : "Required";
    case "too_small":
    case "too_big":
      // A schema's own words for its limit ("At least 150 m", "Add a recipient"); a limit Zod worded
      // itself has already been read above.
      if (message && words(message).length <= 4) return sentence(message);
      return error.type === "too_big" ? "Too long" : "Too short";
    case "invalid_enum_value":
      return "Choose one";
    case "invalid_date":
      return "Not a real date";
    case "invalid_string":
      // A schema's own words for a pattern ("Ten digits", "Not a price") when they fit.
      if (!zodInvalid(message) && words(message).length <= 4) return sentence(message);
      return /email/i.test(message) ? "Check the email" : "Check the format";
    default:
      return message && words(message).length <= 4 ? sentence(message) : "Check this value";
  }
}

/** The schema's own words for an empty field ("Pick a model"), when they were written for it. */
function emptyMessage(issue: { code?: string; message: string }): string {
  const own = issue.code === "invalid_type" || issue.code === "too_small";
  if (own && issue.message && !/^(Required|Expected |String must|Array must|Number must)/.test(issue.message) && words(issue.message).length <= 4) return sentence(issue.message);
  return "Required";
}

const isSchema = (r: unknown): r is ContractSchema => !!r && typeof (r as ContractSchema).safeParse === "function";

const isEmpty = (v: unknown) => v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * Every field's first problem, from the schema or the INTERIM rules. A field left empty that the
 * schema needs reads Required, whatever the type would have said of a wrong value ("Check the
 * format" on an empty date or department said nothing useful); a rule's own words ("Pick a
 * worksite") still speak for themselves.
 */
function problemsOf<T extends Record<string, unknown>>(values: T, rules: FormRules<T> | ContractSchema): Partial<Record<keyof T, string>> {
  const out: Partial<Record<keyof T, string>> = {};
  if (isSchema(rules)) {
    const r = rules.safeParse(values);
    for (const issue of r.success ? [] : (r.error?.issues ?? [])) {
      const k = String(issue.path[0] ?? "") as keyof T;
      if (!k || out[k]) continue;
      out[k] = isEmpty(values[k]) && issue.code !== "custom" ? emptyMessage(issue) : shortMessage({ type: issue.code, message: issue.message });
    }
    return out;
  }
  for (const k of Object.keys(rules) as Array<keyof T>) {
    const msg = rules[k]?.(values[k], values);
    if (msg) out[k] = msg;
  }
  return out;
}

export function useContractForm<T extends Record<string, unknown>>(initial: T, rules: FormRules<T> | ContractSchema = {}, options: ContractFormOptions = {}) {
  const pauseMs = options.pauseMs ?? PAUSE_MS;
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
  // What a control alone can see, by field: it speaks over the contract, whose value it did not hand over.
  const [own, setOwn] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);

  const local = useMemo(() => problemsOf(values, rules), [values, rules]);
  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = { ...local, ...(own as Partial<Record<keyof T, string>>) };
    for (const [k, msgs] of Object.entries(server)) if (msgs[0] && !out[k as keyof T]) out[k as keyof T] = msgs[0];
    return out;
  }, [local, own, server]);

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
      }, pauseMs);
    },
    [form, touch, pauseMs],
  );

  const setValues = useCallback(
    (next: T | ((prev: T) => T)) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(form.getValues() as T) : next;
      for (const [k, x] of Object.entries(v)) form.setValue(k as Path<FieldValues>, x as PathValue<FieldValues, Path<FieldValues>>, { shouldDirty: true });
    },
    [form],
  );

  const shown = (k: keyof T) => !!touched[k] || !!server[k as string];
  const stateOf = (k: keyof T): FieldState => {
    if (!shown(k)) return undefined;
    if (errors[k]) return "bad";
    const value = values[k];
    return value !== "" && value != null ? "good" : undefined;
  };

  /** Props for a field and its control: value, change and blur handlers, its mark and its message. */
  const field = <K extends keyof T>(k: K): FieldBinding<T[K]> & { name: string } => ({
    name: String(k),
    value: values[k],
    onChange: (v: T[K]) => set(k, v),
    onBlur: () => {
      touch(k);
      void form.trigger(k as Path<FieldValues>);
    },
    state: stateOf(k),
    message: shown(k) ? errors[k] : undefined,
    onProblem: (message: string | undefined, now?: boolean) => {
      setOwn((s) => {
        if (s[k as string] === message) return s;
        const next = { ...s };
        if (message) next[k as string] = message;
        else delete next[k as string];
        return next;
      });
      if (message && now) touch(k);
    },
  });

  /** Only the mark and the message, for the Field around a control. */
  const status = (k: keyof T) => ({ state: stateOf(k), message: shown(k) ? errors[k] : undefined });

  /**
   * Mark every field (or only `keys`, for a wizard step), move focus to the
   * first problem and say whether they are clean. Never disables anything.
   */
  const check = (keys?: Array<keyof T>) => {
    const all = (keys ?? (Object.keys(form.getValues()) as Array<keyof T>)) as Array<keyof T>;
    setTouched((s) => ({ ...s, ...Object.fromEntries(all.map((k) => [k, true])) }));
    void form.trigger(all as Array<Path<FieldValues>>);
    const now = { ...problemsOf(form.getValues() as T, rulesRef.current), ...own, ...Object.fromEntries(Object.entries(server).map(([k, m]) => [k, m[0]])) } as Partial<Record<keyof T, string>>;
    const bad = all.filter((k) => now[k]);
    if (bad.length) {
      window.requestAnimationFrame(() => {
        const scope = document.querySelector("[data-ui=modal]") ?? document;
        const first = scope.querySelector<HTMLElement>(`[name="${String(bad[0])}"]`) ?? scope.querySelector<HTMLElement>("[aria-invalid=true]");
        first?.focus();
      });
    }
    return bad.length === 0;
  };

  /** A submit handler for <Form>: checks everything, then calls onValid with the values (the schema's parsed output when there is one). */
  const submit = (onValid: (data: T) => unknown) => () => {
    if (!check()) return;
    const v = form.getValues() as T;
    const r = rulesRef.current;
    if (isSchema(r)) {
      const parsed = r.safeParse(v);
      return onValid((parsed.success ? parsed.data : v) as T);
    }
    return onValid(v);
  };

  /** Back to the initial values (or `next`), with no marks. */
  const reset = (next?: T) => {
    // A pause check still waiting from the last key would mark the emptied field (a comment box
    // cleared after a quick send read Required).
    Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    timers.current = {};
    form.reset((next ?? initial) as DefaultValues<FieldValues>);
    setTouched({});
    setServer({});
    setOwn({});
  };

  /** The server's per-field messages on the marks, each kept to four words like the form's own. */
  const setServerErrors = (fields: ServerFields) =>
    setServer(
      Object.fromEntries(
        // Only a list of messages marks a field: a refusal's details (a mail server's reason, a code) are not marks.
        Object.entries(fields)
          .filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].length > 0 && e[1].every((m) => typeof m === "string"))
          .map(([k, msgs]) => [k, msgs.map((m) => shortMessage({ type: "custom", message: m }) ?? m)]),
      ),
    );

  return { values, setValues, set, field, status, errors, check, submit, reset, setServerErrors, isDirty: form.formState.isDirty, valid: Object.keys(errors).length === 0 };
}

/** Common INTERIM rules. Messages are at most 4 words (gate 12). */
export const rules = {
  required:
    (msg = "Required") =>
    (v: unknown) =>
      v == null || String(v).trim() === "" ? msg : null,
  email: (v: unknown) => {
    const s = String(v ?? "");
    if (!s.trim()) return "Enter an email";
    if (!s.includes("@")) return "Needs an @";
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : "Check the spelling";
  },
  min: (n: number, msg?: string) => (v: unknown) => (String(v ?? "").length < n ? (msg ?? `At least ${n} characters`) : null),
  amount: (v: unknown) => {
    const s = String(v ?? "").replace(/,/g, "");
    if (!s.trim()) return "Enter an amount";
    return /^\d{1,16}(\.\d{1,2})?$/.test(s) ? null : "Two decimals at most";
  },
};

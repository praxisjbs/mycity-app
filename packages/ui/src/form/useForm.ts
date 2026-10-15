/**
 * The interim form hook: inline validation with hand-written rules, for a module
 * whose contract schema does not exist yet. Retire it per module: once the
 * module's schema is in packages/contract, the screen switches to
 * useContractForm(schema) and the fields stay as they are (same binding).
 *
 * Validation is inline (gate 12): a field is checked on every change once it has
 * been touched or the server has marked it, and the signal is the field's own
 * mark and a few words, never a dialog and never only on submit.
 */
import { useCallback, useMemo, useState } from "react";
import type { FieldBinding, FieldState, ServerFields } from "./binding";

/** A rule: the error in at most 4 words, or nothing when the value is right. */
export type Validator<V> = (value: V, all: Record<string, unknown>) => string | null | undefined;

export function useForm<T extends Record<string, unknown>>(initial: T, rules: Partial<{ [K in keyof T]: Validator<T[K]> }> = {}) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [server, setServer] = useState<ServerFields>({});

  const errorOf = useCallback(
    (k: keyof T): string | null => {
      const rule = rules[k];
      const local = rule ? rule(values[k], values) : null;
      return local || server[k as string]?.[0] || null;
    },
    [rules, values, server],
  );

  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = {};
    (Object.keys(values) as Array<keyof T>).forEach((k) => {
      const e = errorOf(k);
      if (e) out[k] = e;
    });
    return out;
  }, [values, errorOf]);

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setTouched((s) => ({ ...s, [k]: true }));
    setServer((s) => {
      if (!(k in s)) return s;
      const next = { ...s };
      delete next[k as string];
      return next;
    });
  }, []);

  const shown = (k: keyof T) => !!touched[k] || !!server[k as string];
  const stateOf = (k: keyof T): FieldState => {
    if (!shown(k)) return undefined;
    if (errors[k]) return "bad";
    return values[k] !== "" && values[k] != null ? "good" : undefined;
  };

  /** Props for a field control: its value, change handler and mark. */
  const field = <K extends keyof T>(k: K): FieldBinding<T[K]> => ({
    value: values[k],
    onChange: (v: T[K]) => set(k, v),
    onBlur: () => setTouched((s) => ({ ...s, [k]: true })),
    state: stateOf(k),
    message: shown(k) ? errors[k] : undefined,
  });

  /** Props for the Field around a control: its mark and message. */
  const status = (k: keyof T) => ({ state: stateOf(k), message: shown(k) ? errors[k] : undefined });

  /** Mark every field touched; true when the form is clean. */
  const check = () => {
    setTouched(Object.fromEntries(Object.keys(values).map((k) => [k, true])) as Partial<Record<keyof T, boolean>>);
    return Object.keys(errors).length === 0;
  };

  return { values, setValues, set, field, status, errors, check, setServerErrors: setServer, valid: Object.keys(errors).length === 0 };
}

/** Common rules. Messages are at most 4 words (gate 12). */
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

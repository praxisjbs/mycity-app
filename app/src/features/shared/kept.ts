import { useState } from "react";

/**
 * A list's chips and filters, kept while the person is on a record's own page (F31 as amended for
 * Partnerships and the Library): Back returns to the list as they left it. Held for the session in
 * memory only, never stored or sent.
 */
const kept = new Map<string, unknown>();
export function useKept<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  return [value, (next: T) => (kept.set(key, next), setValue(next))];
}
/** Forgets every kept list state (a test's fresh start). */
export const forgetKept = () => kept.clear();

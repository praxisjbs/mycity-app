import { ApiError } from "@/api/client";
import type { PersonRef } from "@/api/types/common";
import { toast } from "@mycity/ui";

/** Wiring the Partnerships screens share: a failed request's message, a short name, a select's options. */
export const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");
export const short = (p: PersonRef) => {
  const [a, b] = p.display_name.split(" ");
  return `${a} ${b?.[0] ?? ""}.`;
};
export const opts = (l: string[]): Array<[string, string]> => l.map((x) => [x, x]);

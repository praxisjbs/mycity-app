import type { RefObject } from "react";
import type { ContractSchema, SignatureFieldHandle } from "@mycity/ui";

/**
 * The contract's schema with the pad's PNG put in for `signature` when the form is checked, and a
 * plain mark on the pad when nothing is drawn (Policies, Queries & Sanctions). The form holds
 * "drawn" or "" for the field; the PNG is read from the pad only here and when it is sent.
 * `needed` says when a signature is asked for at all (a decision signs only a sanction); without
 * it, always.
 */
export function withSignature(
  schema: ContractSchema,
  pad: RefObject<SignatureFieldHandle | null>,
  needed: (values: Record<string, unknown>) => boolean = () => true,
): ContractSchema {
  return {
    safeParse: (value: unknown) => {
      const v = value as Record<string, unknown>;
      if (!needed(v)) {
        const { signature: _drawn, ...rest } = v;
        return schema.safeParse(rest);
      }
      const png = v.signature ? (pad.current?.toPng() ?? null) : null;
      const r = schema.safeParse({ ...v, signature: png ?? "" });
      if (r.success || png) return r;
      const others = (r.error?.issues ?? []).filter((i) => i.path[0] !== "signature");
      return { success: false, error: { issues: [...others, { path: ["signature"], message: "Sign in the box", code: "custom" }] } };
    },
  };
}

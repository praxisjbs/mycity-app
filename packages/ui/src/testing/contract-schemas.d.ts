/**
 * Types for importing the contract's CommonJS schema files directly (tests and the
 * gallery), until packages/contract/contract.gen.ts carries the generated types.
 */
declare module "@mycity/contract/schemas/*.js" {
  import type { ZodTypeAny } from "zod";
  const schemas: Record<string, ZodTypeAny>;
  export default schemas;
}

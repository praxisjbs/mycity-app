/**
 * Lint for the app: the shared frontend rules from @mycity/ui (packages/ui/eslint.shared.js),
 * zero warnings. They hold the gates a linter can check on its own: no Zod of
 * the app's own, no native dialogs (16), no native date input or bare
 * toLocaleDateString (15), no raw file input outside the upload component (18),
 * Radix, Vaul, Sonner, Lucide and react-hook-form only inside @mycity/ui (F7),
 * and in src/ no inline style, raw colour or arbitrary value (F4, gate 13), with
 * no exemptions: PR 3 converged every screen onto the token scale, and a
 * runtime value belongs in a shared component where a class reads it.
 */
import { frontendConfig } from "@mycity/ui/eslint";

export default frontendConfig({ kind: "app" });

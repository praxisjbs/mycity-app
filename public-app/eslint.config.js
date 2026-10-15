/**
 * Lint for the public site: the shared frontend rules from @mycity/ui (packages/ui/eslint.shared.js),
 * zero warnings. They hold the gates a linter can check on its own: no Zod of
 * the app's own, no native dialogs (16), no native date input or bare
 * toLocaleDateString (15), no raw file input outside the upload component (18),
 * Radix, Vaul, Sonner, Lucide and react-hook-form only inside @mycity/ui (F7),
 * and in src/ no inline style, raw colour or arbitrary value (F4, gate 13).
 */
import { createRequire } from "node:module";
import { frontendConfig } from "@mycity/ui/eslint";

/**
 * Files from #18 written before F4, which still carry arbitrary values or an
 * inline style. ONE list for both apps and gate 13 (scripts/check/palette.js):
 * scripts/check/lib/styling-exemptions.json. Each file leaves it when its screen
 * is converged onto the token scale and @mycity/ui components; nothing is ever
 * added, and the gate fails an entry that no longer needs it.
 */
const STYLE_LEGACY = createRequire(import.meta.url)("../scripts/check/lib/styling-exemptions.json")["public-app"];

export default frontendConfig({
  kind: "app",
  fileInputAllowed: ["src/components/form/Upload.tsx"],
  styleLegacy: STYLE_LEGACY,
});

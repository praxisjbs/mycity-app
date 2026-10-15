/**
 * Lint for the public site: the shared frontend rules from @mycity/ui (packages/ui/eslint.shared.js),
 * zero warnings. They hold the gates a linter can check on its own: no Zod of
 * the app's own, no native dialogs (16), no native date input or bare
 * toLocaleDateString (15), no raw file input outside the upload component (18),
 * Radix, Vaul, Sonner, Lucide and react-hook-form only inside @mycity/ui (F7),
 * and in src/ no inline style, raw colour or arbitrary value (F4, gate 13).
 */
import { frontendConfig } from "@mycity/ui/eslint";

/**
 * Files from #18 written before F4, which still carry arbitrary values or an
 * inline style. Each leaves this list when its screen is converged onto the
 * token scale and @mycity/ui components; nothing is ever added to it.
 */
const STYLE_LEGACY = [
  "src/components/Layout.tsx",
  "src/components/Planned.tsx",
  "src/components/SignaturePad.tsx",
  "src/components/StagingBar.tsx",
  "src/components/form/Upload.tsx",
  "src/components/form/fields.tsx",
  "src/components/ui.tsx",
  "src/pages/Apply.tsx",
  "src/pages/Assessment.tsx",
  "src/pages/Careers.tsx",
  "src/pages/SignOffer.tsx",
  "src/pages/Vacancy.tsx",
  "src/pages/Verify.tsx",
];


export default frontendConfig({
  kind: "app",
  fileInputAllowed: ["src/components/form/Upload.tsx"],
  styleLegacy: STYLE_LEGACY,
});

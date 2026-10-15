/**
 * Lint for the app: the shared frontend rules from @mycity/ui (packages/ui/eslint.shared.js),
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
  "src/auth/Login.tsx",
  "src/components/form/DateField.tsx",
  "src/components/form/LoginField.tsx",
  "src/components/form/MoneyField.tsx",
  "src/components/form/PersonPicker.tsx",
  "src/components/form/Search.tsx",
  "src/components/form/Upload.tsx",
  "src/components/form/fields.tsx",
  "src/components/ui/Board.tsx",
  "src/components/ui/Calendar.tsx",
  "src/components/ui/Info.tsx",
  "src/components/ui/Menu.tsx",
  "src/components/ui/Modal.tsx",
  "src/components/ui/Money.tsx",
  "src/components/ui/Paper.tsx",
  "src/components/ui/Profile.tsx",
  "src/components/ui/Reader.tsx",
  "src/components/ui/StagingBar.tsx",
  "src/components/ui/Table.tsx",
  "src/components/ui/Toast.tsx",
  "src/components/ui/charts.tsx",
  "src/components/ui/data.tsx",
  "src/components/ui/layout.tsx",
  "src/features/assistant/index.tsx",
  "src/features/attendance/ClockButton.tsx",
  "src/features/attendance/Devices.tsx",
  "src/features/attendance/EssAttendance.tsx",
  "src/features/attendance/PeopleAttendance.tsx",
  "src/features/attendance/Worksites.tsx",
  "src/features/community/Chat.tsx",
  "src/features/community/Posts.tsx",
  "src/features/community/index.tsx",
  "src/features/ess/Documents.tsx",
  "src/features/ess/Leave.tsx",
  "src/features/ess/Payslips.tsx",
  "src/features/ess/Performance.tsx",
  "src/features/ess/Profile.tsx",
  "src/features/ess/Queries.tsx",
  "src/features/ess/Security.tsx",
  "src/features/expenses/index.tsx",
  "src/features/home/KpiDetail.tsx",
  "src/features/home/blocks.tsx",
  "src/features/home/index.tsx",
  "src/features/knowledge/index.tsx",
  "src/features/mailbox/Composer.tsx",
  "src/features/mailbox/index.tsx",
  "src/features/organogram/OrgTree.tsx",
  "src/features/partnerships/index.tsx",
  "src/features/payroll/index.tsx",
  "src/features/people/EmployeeDetails.tsx",
  "src/features/people/Employees.tsx",
  "src/features/people/Leave.tsx",
  "src/features/performance/index.tsx",
  "src/features/queries/index.tsx",
  "src/features/recruitment/index.tsx",
  "src/features/settings/Policy.tsx",
  "src/features/settings/Roles.tsx",
  "src/features/settings/index.tsx",
  "src/features/shared/Letter.tsx",
  "src/features/shared/sections.tsx",
  "src/features/workspace/index.tsx",
  "src/shell/Bell.tsx",
  "src/shell/CommandPalette.tsx",
  "src/shell/Nav.tsx",
  "src/shell/Planned.tsx",
  "src/shell/Shell.tsx",
  "src/shell/UpdatePrompt.tsx",
];


export default frontendConfig({
  kind: "app",
  fileInputAllowed: ["src/components/form/Upload.tsx"],
  styleLegacy: STYLE_LEGACY,
});

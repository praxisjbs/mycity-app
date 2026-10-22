/**
 * Entry of the mock API: registers every module's routes, then answers
 * requests. Imported only when VITE_API_MODE=mock (api/client.ts).
 */
import "./modules/identity";
import "./modules/security";
import "./modules/worksites";
import "./modules/maps";
import "./modules/devices";
import "./modules/attendance";
import "./modules/home";
import "./modules/organisation";
import "./modules/payslips";
import "./modules/ess";
import "./modules/workspace";
import "./modules/community";
import "./modules/mailbox";
import "./modules/shared";
import "./modules/performance";
import "./modules/reviews";
import "./modules/queries";
import "./modules/recruitment";
import "./modules/payroll";
import "./modules/partnerships";
import "./modules/expenses";
import "./modules/knowledge";
import "./modules/policies";
import "./modules/settings";
import "./modules/system_health";
import "./modules/integrations";
import "./modules/ai_control";
import "./modules/imports";
import "./modules/workflow";
import { dispatch } from "./core";

export const mockTransport = dispatch;

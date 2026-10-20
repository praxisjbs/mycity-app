import type { ModuleScreenProps } from "@/shell/screens";
import { MyAttendancePage, MyDevicesPage } from "@/features/attendance/EssAttendance";
import { PolicyUpdatesPage } from "@/features/attendance/PolicyUpdates";
import { WorkLocationRequestsPage } from "@/features/attendance/WorkLocationRequests";
import { OrgTree } from "@/features/organogram/OrgTree";
import { MyDocumentsPage } from "./Documents";
import { MyLeavePage } from "./Leave";
import { MyPayslipsPage } from "./Payslips";
import { MyPerformancePage } from "./Performance";
import { MyProfilePage } from "./Profile";
import { MyQueriesPage } from "./Queries";
import { MySecurityPage } from "./Security";

export default function Ess({ tab }: ModuleScreenProps) {
  switch (tab) {
    case "my-profile": return <MyProfilePage />;
    case "my-attendance": return <MyAttendancePage />;
    case "work-location-requests": return <WorkLocationRequestsPage />;
    case "my-devices": return <MyDevicesPage />;
    case "policy-updates": return <PolicyUpdatesPage />;
    case "my-performance": return <MyPerformancePage />;
    case "my-payslips": return <MyPayslipsPage />;
    case "my-leave": return <MyLeavePage />;
    case "my-queries": return <MyQueriesPage />;
    case "my-documents": return <MyDocumentsPage />;
    case "org-chart": return <OrgTree mode="viewer" />;
    case "my-security": return <MySecurityPage />;
    default: return null;
  }
}

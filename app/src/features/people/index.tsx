import type { ModuleScreenProps } from "@/shell/screens";
import { PeopleAttendance } from "@/features/attendance/PeopleAttendance";
import { Devices } from "@/features/attendance/Devices";
import { Worksites } from "@/features/attendance/Worksites";
import { OrgTree } from "@/features/organogram/OrgTree";
import { Employee360 } from "./Employee360";
import { Employees } from "./Employees";
import { PeopleLeave } from "./Leave";
import { Departments } from "./Departments";

export default function People({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "employees":
      return id ? <Employee360 id={id} /> : <Employees />;
    case "organogram":
      return <OrgTree mode="builder" openId={id} />;
    case "attendance":
      return <PeopleAttendance />;
    case "leave":
      return <PeopleLeave />;
    case "devices":
      return <Devices />;
    case "worksites":
      return <Worksites />;
    case "departments":
      return <Departments />;
    default:
      return null;
  }
}

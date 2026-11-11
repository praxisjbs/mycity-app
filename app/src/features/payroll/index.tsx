import type { ModuleScreenProps } from "@/shell/screens";
import Configurations from "./Configurations";
import Deductions from "./Deductions";
import PayRuns from "./PayRuns";
import PaySlips from "./PaySlips";

/**
 * Payroll (docs/guides/payroll.md §2, §10): four tabs, each its own screen. `id` opens a record where a link names
 * one (the bell, ⌘K, Praxis AI): a run on Payroll Runs, a payslip on Payslips (src/shared/route-map.js).
 */
export default function Payroll({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "payslips":
      return <PaySlips id={id} />;
    case "deductions":
      return <Deductions />;
    case "configurations":
      return <Configurations />;
    default:
      return <PayRuns id={id} />;
  }
}

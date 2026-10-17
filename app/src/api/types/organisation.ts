/**
 * Organisation is on the contract (packages/contract/schemas/organisation.js): the staff
 * register, the employee 360, departments, vacant seats and the reporting tree are typed
 * by the generated `Endpoints` (api/endpoints.ts). These are the contract's types under
 * the names the screens use, so nothing in this module is INTERIM any more.
 */
export type {
  Department,
  Employee360,
  EmployeeCreate,
  EmployeeHistoryEntry,
  EmployeeListQuery,
  EmployeeRow,
  EmployeeUpdate,
  EmployeesSummary,
  EmployeeStatus,
  EmploymentType,
  Gender,
  LoginState,
  ManagerRef,
  OrgChartTree,
  OrgNode,
  OrgSeat,
  WorkPattern,
} from "@mycity/contract/contract.gen.ts";

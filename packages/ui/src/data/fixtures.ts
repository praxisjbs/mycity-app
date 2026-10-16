/**
 * Sample rows for the Data group's gallery pages: one small staff list with the
 * shapes a real one has (a name, a department, a status, an amount, a date, an
 * empty value). Not exported from the package; a screen's rows come from the API.
 */
import type { PageMeta } from "./createApi";
import type { StatusValue } from "../display/Pill";

export interface SampleRow {
  employee_id: string;
  display_name: string;
  department: string;
  job_title: string;
  status: StatusValue;
  owed: string;
  joined_on: string;
  note: string | null;
}

export const SAMPLE_ROWS: SampleRow[] = [
  { employee_id: "e1", display_name: "Adaeze Okonkwo", department: "Finance", job_title: "Financial Controller", status: { tone: "ok", text: "Active" }, owed: "412500.00", joined_on: "2024-03-11", note: "Acting head" },
  { employee_id: "e2", display_name: "Chidi Eze", department: "People", job_title: "People Partner", status: { tone: "ok", text: "Active" }, owed: "268000.00", joined_on: "2025-01-06", note: null },
  { employee_id: "e3", display_name: "Ngozi Bello", department: "Operations", job_title: "Operations Lead", status: { tone: "warn", text: "On Leave" }, owed: "0.00", joined_on: "2023-09-18", note: null },
  { employee_id: "e4", display_name: "Tunde Balogun", department: "Technology", job_title: "Platform Engineer", status: { tone: "ok", text: "Active" }, owed: "154750.00", joined_on: "2025-07-02", note: "Remote" },
  { employee_id: "e5", display_name: "Fatima Yusuf", department: "Partnerships", job_title: "Partnerships Manager", status: { tone: "err", text: "Suspended" }, owed: "0.00", joined_on: "2022-11-29", note: null },
];

/** A page of a list far bigger than one page, so the pager shows a real total. */
export const SAMPLE_PAGE: PageMeta = { number: 1, size: 25, total: 312, pages: 13, has_next: true };

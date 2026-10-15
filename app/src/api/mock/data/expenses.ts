import { at, sid } from "../core";

/** Demonstration expense requests. One chain for every request (HANDOFF ruling 5). */
export const CHAIN = ["Requester", "Line manager", "Operations", "Requisition", "CEO", "Disbursed"] as const;

export interface MockRequest {
  request_id: string;
  number: string;
  title: string;
  requester: string;
  category: string;
  department: string;
  amount: string;
  stage: "draft" | "line_manager" | "operations" | "requisition" | "ceo" | "approved" | "disbursed" | "rejected" | "returned";
  submitted_at: string;
  project: string | null;
}

type R = [string, string, string, string, MockRequest["stage"], number, string | null];
const ROWS: R[] = [
  ["Ember to Remember, stage hire", "adedotun", "Events", "820000.00", "operations", 0, "Ember to Remember"],
  ["Enugu city launch, transport", "tolu", "Transport", "345000.00", "ceo", 1, "Enugu launch"],
  ["Studio equipment repair", "emeka", "Equipment", "128500.00", "operations", 1, null],
  ["Partner dinner, ProvidusBank", "ngozi", "Hospitality", "412000.00", "ceo", 2, null],
  ["Lagos activation transport", "bashir", "Transport", "185000.00", "line_manager", 0, "Ember to Remember"],
  ["Content shoot props", "kemi", "Production", "64000.00", "disbursed", 9, "Enugu launch"],
  ["Laptop charger replacement", "obinna", "Equipment", "38500.00", "disbursed", 12, null],
  ["Data bundles, field team", "grace", "Communication", "45000.00", "requisition", 3, null],
  ["Courier, Enugu documents", "tolu", "Office", "24500.00", "approved", 4, "Enugu launch"],
  ["Kano scoping trip, flights", "ngozi", "Travel", "290000.00", "rejected", 6, null],
  ["Team lunch, Q3 close", "cynthia", "Hospitality", "96000.00", "disbursed", 14, null],
  ["Printer toner", "damilola", "Office", "52000.00", "line_manager", 1, null],
  ["Generator diesel, October", "musa", "Facilities", "210000.00", "disbursed", 8, null],
];

export const REQUESTS: MockRequest[] = ROWS.map((r, i) => ({
  request_id: sid(`exp:${i}`),
  number: `EXP-${String(122 - i).padStart(4, "0")}`,
  title: r[0],
  requester: r[1],
  category: r[2],
  department: "",
  amount: r[3],
  stage: r[4],
  submitted_at: at(r[5], `0${8 + (i % 2)}:${String(10 + i * 3).padStart(2, "0")}`),
  project: r[6],
}));

export const STAGE_PILL: Record<MockRequest["stage"], { tone: "ok" | "warn" | "err" | "info" | "neutral"; text: string }> = {
  draft: { tone: "neutral", text: "Draft" },
  line_manager: { tone: "warn", text: "Line manager" },
  operations: { tone: "warn", text: "Operations" },
  requisition: { tone: "info", text: "Requisition" },
  ceo: { tone: "info", text: "With CEO" },
  approved: { tone: "info", text: "Awaiting disbursement" },
  disbursed: { tone: "ok", text: "Disbursed" },
  rejected: { tone: "err", text: "Rejected" },
  returned: { tone: "warn", text: "Returned" },
};

/**
 * Expenses' demonstration data for the in-browser mock (F13), modelled on what
 * seeds/staging/80_expenses.js loads on staging: the twelve suggested categories, this year's
 * budgets for three departments, two Workspace projects with budgets, and requests walked to
 * every stage. modules/expenses.ts walks them through the same moves the services make.
 */

/** The suggested categories (docs/guides/expenses.md §6.7), as Add Suggested Categories adds them. */
export const CATEGORY_NAMES: Array<[string, "operating" | "capital"]> = [
  ["Advertising and Media", "operating"],
  ["Branded Items and Printing", "operating"],
  ["Content and Production", "operating"],
  ["Events and Activations", "operating"],
  ["Travel and Transport", "operating"],
  ["Influencers and PR", "operating"],
  ["Accommodation and Meals", "operating"],
  ["Prizes and Giveaways", "operating"],
  ["Data Airtime and Subscriptions", "operating"],
  ["Legal and Professional Services", "operating"],
  ["Office and Admin", "operating"],
  ["Equipment", "capital"],
];

/** Workspace's mock projects, in its order (modules/workspace.ts PROJECTS: project:0, project:1, project:2). */
export const PROJECT_NAMES = ["Enugu Launch", "Q4 Campaigns", "Abuja Hub Opening"];

export interface SeedRequest {
  purpose: string;
  by: string;
  department: string;
  category: string;
  project: number | null;
  payee: "staff" | "vendor" | "partner" | "task_team";
  name: string | null;
  bank: string | null;
  account: string | null;
  lines: Array<[string, string, string]>;
  ago: number;
  walk: "draft" | "with_manager" | "with_operations" | "approved" | "in_requisition" | "authorised" | "paid" | "sent_back" | "rejected";
  reference?: string | null;
  reason?: string;
  invoice?: boolean;
}

const V = (name: string, bank: string, account: string) => ({ payee: "vendor" as const, name, bank, account });

export const SEED = {
  budgets: [
    ["Marketing & Sales", [["Events and Activations", "1000000.00"], ["Advertising and Media", "1500000.00"], ["Branded Items and Printing", "900000.00"]]],
    ["Content", [["Content and Production", "1200000.00"], ["Travel and Transport", "450000.00"], ["Data Airtime and Subscriptions", "100000.00"]]],
    ["Operations & People", [["Office and Admin", "600000.00"], ["Accommodation and Meals", "300000.00"], ["Equipment", "800000.00"]]],
  ] as Array<[string, Array<[string, string]>]>,
  projectBudgets: ["1800000.00", "2500000.00", null] as Array<string | null>,
  requests: [
    { purpose: "Ember to Remember, stage and sound", by: "adedotun", department: "Marketing & Sales", category: "Events and Activations", project: 1, ...V("Stagecraft Nigeria Ltd", "GTBank", "0123456781"), lines: [["Stage hire, two days", "1", "450000.00"], ["Sound and lights", "1", "150000.00"]], ago: 12, walk: "paid", reference: "GT2610150012", invoice: true },
    { purpose: "Ikeja activation, Dedicated Task Team", by: "grace", department: "Marketing & Sales", category: "Events and Activations", project: 1, payee: "task_team", name: "Ikeja Activation DTT", bank: "Opay", account: "8012345678", lines: [["Ushers, 10 for 2 days", "20", "15000.00"], ["Supervisors, 2 for 2 days", "4", "25000.00"]], ago: 10, walk: "paid", reference: null, invoice: true },
    { purpose: "Enugu launch flyers and roll-up banners", by: "kemi", department: "Content", category: "Branded Items and Printing", project: 0, ...V("Print Hub Enugu", "Zenith Bank", "2012345678"), lines: [["A5 flyers", "5000", "45.00"], ["Roll-up banners", "4", "35000.00"]], ago: 9, walk: "authorised", invoice: true },
    { purpose: "Enugu launch, team transport", by: "chidera", department: "Content", category: "Travel and Transport", project: 0, ...V("GUO Transport", "First Bank", "3012345678"), lines: [["Lagos to Enugu, return", "6", "32000.00"]], ago: 7, walk: "in_requisition", invoice: true },
    { purpose: "Field team data bundles, November", by: "kemi", department: "Content", category: "Data Airtime and Subscriptions", project: null, payee: "staff", name: null, bank: null, account: null, lines: [["Data bundle, 20GB", "6", "8000.00"]], ago: 6, walk: "in_requisition" },
    { purpose: "Printer toner and paper", by: "chidera", department: "Operations & People", category: "Office and Admin", project: null, ...V("Chuks Stores", "Access Bank", "0412345678"), lines: [["Toner cartridge", "2", "38000.00"], ["A4 paper, box", "3", "12500.00"]], ago: 5, walk: "approved", invoice: true },
    { purpose: "Radio slots, November campaign", by: "adedotun", department: "Marketing & Sales", category: "Advertising and Media", project: 1, ...V("Wazobia FM", "UBA", "1012345678"), lines: [["30-second slot", "12", "45000.00"]], ago: 4, walk: "approved", invoice: true },
    { purpose: "Partner lunch, ProvidusBank", by: "grace", department: "Operations & People", category: "Accommodation and Meals", project: null, payee: "staff", name: null, bank: null, account: null, lines: [["Lunch for six", "1", "96000.00"]], ago: 3, walk: "with_operations" },
    { purpose: "Content shoot props", by: "emeka", department: "Content", category: "Content and Production", project: 0, ...V("Props Lagos", "Wema Bank", "5012345678"), lines: [["Set props", "1", "64000.00"], ["Backdrop paper", "3", "12000.00"]], ago: 2, walk: "with_manager", invoice: true },
    { purpose: "Prizes for the Ikeja walk", by: "adedotun", department: "Marketing & Sales", category: "Prizes and Giveaways", project: 1, ...V("Slot Systems", "GTBank", "0612345678"), lines: [["Phone prize", "2", "120000.00"], ["Branded caps", "50", "2500.00"]], ago: 1, walk: "with_manager", invoice: true },
    { purpose: "Office chairs", by: "kemi", department: "Operations & People", category: "Equipment", project: null, ...V("Office Mart", "Stanbic IBTC", "7012345678"), lines: [["Swivel chair", "4", "85000.00"]], ago: 8, walk: "sent_back", reason: "Send the invoice with the delivery cost." },
    { purpose: "Influencer post, unplanned", by: "grace", department: "Marketing & Sales", category: "Influencers and PR", project: null, payee: "partner", name: "Lagos Lifestyle Media", bank: "Wema Bank", account: "9012345678", lines: [["Sponsored post", "1", "350000.00"]], ago: 11, walk: "rejected", reason: "Not in this quarter's plan." },
    { purpose: "Courier, Abuja documents", by: "kemi", department: "Content", category: "Office and Admin", project: null, ...V("GIG Logistics", "Zenith Bank", "2112345678"), lines: [["Courier, Lagos to Abuja", "1", "12500.00"]], ago: 0, walk: "draft" },
  ] as SeedRequest[],
};

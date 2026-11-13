/**
 * Sample figures for the Charts group's gallery pages: a fortnight of
 * attendance, a year of claims, a month of days, departments' budgets and a
 * salary structure. Invented, not exported from the package; a screen's
 * figures come from the API.
 */
export const WORKING_DAYS = ["1", "2", "3", "4", "5", "6", "8", "9", "10", "11", "12", "13", "15", "16"];
export const PRESENT = [44, 46, 45, 47, 46, 23, 45, 44, 46, 47, 45, 22, 46, 47];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
export const CLAIMS = [14, 22, 9, 18, 26, 21];

/** A month of days, labelled day first without the year, and a figure for each. */
export const MONTH_OF_DAYS = Array.from({ length: 31 }, (_, i) => ({ label: `${String(i + 1).padStart(2, "0")}/10`, value: 600 + ((i * 137) % 900) }));

export const DEPARTMENTS = [
  { label: "Finance", value: 12 },
  { label: "People", value: 8 },
  { label: "Operations", value: 21 },
  { label: "Technology", value: 14 },
  { label: "Partnerships", value: 6 },
];

/** The parts of a department's budget, bottom to top: an overspend is a part of its own, never a negative one. */
export const BUDGET_PARTS = ["Spent", "Committed", "Remaining", "Over Budget"];

/** Departments' budgets in naira, each the total of its parts in BUDGET_PARTS' order; Technology has gone over. */
export const BUDGETS = [
  { label: "Finance", value: 2500000, parts: [1250000, 400000, 850000, 0] },
  { label: "People", value: 1800000, parts: [900000, 300000, 600000, 0] },
  { label: "Operations", value: 3000000, parts: [2100000, 650000, 250000, 0] },
  { label: "Technology", value: 2000000, parts: [1400000, 300000, 0, 300000] },
];

export const GRADES = [
  { label: "Grade 1", sub: "18 people", from: 2, to: 14, middle: 8, value: "₦120K to ₦820K" },
  { label: "Grade 2", sub: "11 people", from: 11, to: 30, middle: 20, value: "₦640K to ₦1.7M" },
  { label: "Grade 3", sub: "7 people", from: 26, to: 52, middle: 39, value: "₦1.5M to ₦2.9M" },
  { label: "Grade 4", sub: "3 people", from: 48, to: 78, middle: 63, value: "₦2.7M to ₦4.4M" },
];

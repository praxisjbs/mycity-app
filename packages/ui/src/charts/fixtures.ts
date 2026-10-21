/**
 * Sample figures for the Charts group's gallery pages: a fortnight of
 * attendance, a year of claims, a month of days and a salary structure. Not
 * exported from the package; a screen's figures come from the API.
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

export const GRADES = [
  { label: "Grade 1", sub: "18 people", from: 2, to: 14, middle: 8, value: "₦120K to ₦820K" },
  { label: "Grade 2", sub: "11 people", from: 11, to: 30, middle: 20, value: "₦640K to ₦1.7M" },
  { label: "Grade 3", sub: "7 people", from: 26, to: 52, middle: 39, value: "₦1.5M to ₦2.9M" },
  { label: "Grade 4", sub: "3 people", from: 48, to: 78, middle: 63, value: "₦2.7M to ₦4.4M" },
];

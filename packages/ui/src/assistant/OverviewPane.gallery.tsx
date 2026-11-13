import type { GalleryEntry } from "../testing/gallery";
import { BUDGET_PARTS, BUDGETS } from "../charts/fixtures";
import { OverviewPane } from "./OverviewPane";

const figures = [
  { key: "late", label: "Late Arrivals", value: 7, unit: "count" },
  { key: "minutes", label: "Minutes Late", value: 143, unit: "minutes" },
  { key: "people", label: "People Late", value: 4, unit: "count" },
];
const byDepartment = { label: "By Department", values: [5, 1, 1] };
const labels = ["Operations", "Finance", "People"];

/** Departments' budgets as the server draws them: Allocated, Spent and Remaining in naira, each part a series. */
const budgetFigures = [
  { key: "allocated", label: "Allocated", value: "9000000.00", unit: "ngn" },
  { key: "spent", label: "Spent", value: "5650000.00", unit: "ngn" },
  { key: "remaining", label: "Remaining", value: "1400000.00", unit: "ngn" },
];
const byDepartmentParts = BUDGET_PARTS.map((label, k) => ({ label, values: BUDGETS.map((b) => b.parts[k] ?? 0) }));

export default {
  component: "OverviewPane",
  states: {
    "Bar Chart": () => <OverviewPane overview={{ title: "Seven late arrivals this month, most in Operations.", figures, chart: { kind: "bar", title: "Late arrivals by department", labels, series: [byDepartment] } }} />,
    "Stacked Bar": () => (
      <OverviewPane overview={{ title: null, figures: budgetFigures, chart: { kind: "stacked_bar", title: "Budget by department", labels: BUDGETS.map((b) => b.label), series: byDepartmentParts } }} />
    ),
    Donut: () => <OverviewPane overview={{ title: null, figures: figures.slice(0, 2), chart: { kind: "donut", title: "Who was late", labels, series: [byDepartment] } }} />,
    Line: () => (
      <OverviewPane
        overview={{
          title: "Lateness fell through the week.",
          figures: [],
          chart: { kind: "line", title: "Late arrivals by day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], series: [{ label: "By Day", values: [3, 2, 1, 1, 0] }] },
        }}
      />
    ),
    "No Figures Yet": () => <OverviewPane overview={null} />,
  },
} satisfies GalleryEntry;

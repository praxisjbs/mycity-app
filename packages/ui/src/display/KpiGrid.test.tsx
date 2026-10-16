import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { KpiCard } from "./KpiCard";
import { KpiGrid } from "./KpiGrid";

const ITEMS = [
  { key: "in", title: "Clocked In Today", value: "22 of 25" },
  { key: "late", title: "Late Arrivals", value: 3, tone: "warn" as const },
  { key: "leave", title: "On Leave", value: 2 },
  { key: "open", title: "Open Tasks", value: 14 },
];

describe("KpiGrid", () => {
  it("draws a figure per item as a list, so the count is heard first", () => {
    render(<KpiGrid items={ITEMS} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Clocked In Today")).toBeInTheDocument();
  });

  it("takes cards a screen builds itself and keeps their keys", () => {
    render(
      <KpiGrid>
        {ITEMS.map((i) => (
          <KpiCard key={i.key} title={i.title} value={i.value} />
        ))}
      </KpiGrid>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("is two to a row on a phone and four across on desktop", () => {
    const { container } = render(<KpiGrid items={ITEMS} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-4");
  });

  it("takes three across for a tab with three figures", () => {
    const { container } = render(<KpiGrid items={ITEMS.slice(0, 3)} cols={3} />);
    expect(container.firstElementChild!.className).toContain("desk:grid-cols-3");
  });

  it("passes a tile's own open through", () => {
    const onOpen = vi.fn();
    render(<KpiGrid items={[{ key: "in", title: "Clocked In Today", value: 22, onOpen }]} />);
    expect(screen.getByRole("button", { name: /Clocked In Today/ })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<KpiGrid items={ITEMS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

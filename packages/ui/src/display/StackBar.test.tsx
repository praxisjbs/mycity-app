import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { StackBar } from "./StackBar";

const PARTS = [
  { key: "production", label: "Production", value: 1900, figure: "1.9 GB" },
  { key: "database", label: "Database", value: 1600, figure: "1.6 GB" },
  { key: "cache", label: "Cache", value: 9800, figure: "9.6 GB", series: "muted" as const },
];

describe("StackBar", () => {
  it("reads every part by name and figure, then what is left", () => {
    render(<StackBar label="Memory" total={18432} parts={PARTS} rest={{ label: "Free", figure: "3.5 GB" }} />);
    const key = screen.getByRole("list", { name: "Memory" });
    const items = within(key).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Production1.9 GB", "Database1.6 GB", "Cache9.6 GB", "Free3.5 GB"]);
  });

  it("draws each part as its share of the whole, in the next series unless it names one", () => {
    const { container } = render(<StackBar label="Memory" total={18432} parts={PARTS} />);
    const bars = container.querySelectorAll("[aria-hidden='true'] > span");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveClass("bg-chart-1");
    expect(bars[1]).toHaveClass("bg-chart-2");
    expect(bars[2]).toHaveClass("bg-input");
    expect((bars[0] as HTMLElement).style.getPropertyValue("--fill")).toBe(`${(1900 * 100) / 18432}%`);
  });

  it("leaves a part of nothing off the bar but keeps it in the key", () => {
    const { container } = render(<StackBar label="Disk" total={100} parts={[{ key: "logs", label: "Logs", value: 0, figure: "0 MB" }]} />);
    expect(container.querySelectorAll("[aria-hidden='true'] > span")).toHaveLength(0);
    expect(screen.getByText("Logs")).toBeInTheDocument();
  });

  it("keeps the key for screen readers when it is not drawn", () => {
    render(<StackBar label="Processor" total={100} parts={PARTS.slice(0, 1)} legend={false} />);
    expect(screen.getByRole("list", { name: "Processor" })).toHaveClass("sr-only");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<StackBar label="Memory" total={18432} parts={PARTS} rest={{ label: "Free", figure: "3.5 GB" }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

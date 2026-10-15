import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Money } from "./Money";

describe("Money", () => {
  it("formats the wire string with kobo and tabular figures", () => {
    render(<Money value="1250000.00" />);
    const el = screen.getByText("₦1,250,000.00");
    expect(el.className).toContain("tabular-nums");
    expect(el).not.toHaveAttribute("data-negative");
  });

  it("marks a negative with a minus, colour and a word", () => {
    render(<Money value="-45000.5" negLabel="refund" />);
    const el = screen.getByText((_, node) => node?.getAttribute("data-money") === "" && node.textContent === "−₦45,000.50(refund)");
    expect(el).toHaveAttribute("data-negative", "true");
    expect(el.className).toContain("text-destructive");
    expect(screen.getByText("(refund)")).toBeInTheDocument();
  });

  it("shortens for KPI tiles and drops kobo when asked", () => {
    const { rerender } = render(<Money value="1250000.00" short />);
    expect(screen.getByText("₦1.2M")).toBeInTheDocument();
    rerender(<Money value="1250000.00" kobo={false} />);
    expect(screen.getByText("₦1,250,000")).toBeInTheDocument();
  });

  it("shows EmptyValue for an amount that is not set", () => {
    render(<Money value={null} />);
    expect(screen.getByRole("img", { name: "No amount" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        <Money value="1250000.00" /> <Money value="-200.00" /> <Money value="" />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

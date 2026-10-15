import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Skeleton, Spinner } from "./Skeleton";

describe("Skeleton", () => {
  it("draws lines as one labelled status region (the merged Loading)", () => {
    const { container } = render(<Skeleton lines={6} />);
    const region = screen.getByRole("status", { name: "Loading" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(6);
  });

  it("draws one decorative shape sized by its class", () => {
    const { container } = render(<Skeleton shape="circle" className="size-10" />);
    const el = container.firstElementChild!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("size-10");
    expect(el.className).not.toContain("size-8");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Skeleton lines={3} label="Loading payslips" />
        <Skeleton shape="block" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Spinner", () => {
  it("says what is loading", () => {
    render(<Spinner label="Loading payslips" size="m" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading payslips");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Spinner />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

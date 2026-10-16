import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { StagingBar } from "./StagingBar";

describe("StagingBar", () => {
  it("is a status region that says Staging, with the long and the short line", () => {
    render(<StagingBar message="For training and testing." short="Mail here is real" />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("Staging");
    expect(bar).toHaveTextContent("For training and testing.");
    expect(bar).toHaveTextContent("Mail here is real");
  });

  it("is fixed by default, sticky or inline when asked", () => {
    const { rerender } = render(<StagingBar message="Test copy" short="Test copy" />);
    expect(screen.getByRole("status")).toHaveClass("fixed");
    rerender(<StagingBar message="Test copy" short="Test copy" placement="sticky" />);
    expect(screen.getByRole("status")).toHaveClass("sticky");
    rerender(<StagingBar message="Test copy" short="Test copy" placement="inline" />);
    expect(screen.getByRole("status")).not.toHaveClass("fixed");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<StagingBar placement="inline" message="For training and testing." short="Mail here is real" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

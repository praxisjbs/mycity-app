import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ProgressLine } from "./ProgressLine";

describe("ProgressLine", () => {
  it("says what is being read and which read of the five it is", () => {
    render(<ProgressLine words="leave requests" step={{ n: 2, of: 5 }} />);
    expect(screen.getByRole("status").textContent).toBe("Reading leave requests · 2 of 5");
  });

  it("says Reading Your Records before the first read is known", () => {
    render(<ProgressLine />);
    expect(screen.getByRole("status").textContent).toBe("Reading Your Records");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ProgressLine words="employees" step={{ n: 1, of: 5 }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

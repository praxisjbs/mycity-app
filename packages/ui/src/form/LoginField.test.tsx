import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { LoginField } from "./LoginField";

const base = { id: "email", label: "Work Email", type: "email", autoComplete: "username", onChange: vi.fn(), onBlur: vi.fn(), buzz: 0 };

describe("LoginField", () => {
  it("labels the control and links its message", () => {
    render(<LoginField {...base} value="ada" error="Needs an @" good={false} />);
    const input = screen.getByLabelText("Work Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Needs an @");
  });

  it("shows no message when right", () => {
    render(<LoginField {...base} value="ada@mycity.app" error="" good />);
    expect(screen.getByLabelText("Work Email")).not.toHaveAttribute("aria-invalid");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<LoginField {...base} value="" error="" good={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

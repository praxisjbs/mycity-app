import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { Pill } from "./Pill";
import { BackButton, ProfileHeader } from "./ProfileHeader";

describe("ProfileHeader", () => {
  it("draws the name as the record's own heading, with its role", () => {
    render(<ProfileHeader name="Adaeze Okonkwo" role="Financial Controller" level={1} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Adaeze Okonkwo" });
    expect(heading).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("Financial Controller")).toBeInTheDocument();
  });

  it("is an h2 inside a page that already has its own heading", () => {
    render(<ProfileHeader name="Adaeze Okonkwo" />);
    expect(screen.getByRole("heading", { level: 2, name: "Adaeze Okonkwo" })).toBeInTheDocument();
  });

  it("draws decorative initials, since the name is right beside them", () => {
    render(<ProfileHeader name="Adaeze Okonkwo" />);
    const mark = screen.getByText("AO");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("marks a partner in the brand yellow rather than City Green", () => {
    const { rerender } = render(<ProfileHeader name="Lagos Water Board" brand />);
    expect(screen.getByText("LB").className).toContain("bg-primary");
    rerender(<ProfileHeader name="Adaeze Okonkwo" />);
    expect(screen.getByText("AO").className).toContain("bg-secondary");
  });

  it("takes a picture instead of the initials", () => {
    render(<ProfileHeader name="Adaeze Okonkwo" avatar={<img src="/p.jpg" alt="" />} />);
    expect(screen.queryByText("AO")).toBeNull();
  });

  it("carries its chips and its actions", () => {
    render(
      <ProfileHeader
        name="Adaeze Okonkwo"
        chips={<Pill tone="ok">Active</Pill>}
        actions={<Button icon="mail">Send Letter</Button>}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Letter" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ProfileHeader name="Adaeze Okonkwo" role="Financial Controller" level={1} chips={<Pill tone="ok">Active</Pill>} actions={<Button icon="mail">Send Letter</Button>} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("BackButton", () => {
  it("goes back where it says it goes", async () => {
    const onBack = vi.fn();
    render(<BackButton label="Back to Employees" onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to Employees" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("is a 44 px target on a phone", () => {
    render(<BackButton label="Back to Employees" onBack={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("phone:min-h-tap");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<BackButton label="Back to Employees" onBack={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { SectionHead } from "./SectionHead";

describe("SectionHead", () => {
  it("centres a kicker, the heading and its line, rising into view", () => {
    const { container } = render(<SectionHead kicker="How We Hire" title="Four Steps, Every Time" text="The same fair process for every role and every candidate." id="hire-title" />);
    const h2 = screen.getByRole("heading", { level: 2, name: "Four Steps, Every Time" });
    expect(h2).toHaveAttribute("id", "hire-title");
    expect(h2).toHaveAttribute("data-ui", "title");
    expect(screen.getByText("How We Hire")).toHaveClass("ps-kicker");
    expect(screen.getByText("The same fair process for every role and every candidate.")).toHaveClass("ps-sub");
    expect(container.firstElementChild).toHaveClass("ps-head-c");
    expect(container.firstElementChild).toHaveAttribute("data-reveal", "up");
  });

  it("splits an eyebrow and an accented heading from the action at the right", () => {
    const { container } = render(<SectionHead align="split" eyebrow="Careers" title="Closing Soon" accent="Soon" action={<Button variant="line">See All Roles</Button>} />);
    expect(container.firstElementChild).toHaveClass("ps-head-split");
    expect(screen.getByRole("heading", { level: 2 }).querySelector("em")).toHaveTextContent("Soon");
    expect(screen.getByText("Careers")).toHaveClass("ps-eyebrow");
    expect(screen.getByRole("button", { name: "See All Roles" }).parentElement).toBe(container.firstElementChild);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <SectionHead kicker="What We Build" title="One App, Every City" text="Places, events, businesses and government services, in every Nigerian city." />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

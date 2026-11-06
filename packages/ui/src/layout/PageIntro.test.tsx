import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { PageIntro } from "./PageIntro";

describe("PageIntro", () => {
  it("opens the page: the eyebrow, the headline as the page title with its accent word, the lede and a hairline", () => {
    const { container } = render(<PageIntro eyebrow="Careers at MyCityApp" title="Open Roles" accent="Roles" text="12 roles across 7 teams." />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Open Roles" });
    expect(h1).toHaveAttribute("data-ui", "page-title");
    expect(h1.querySelector("em")).toHaveTextContent("Roles");
    expect(screen.getByText("Careers at MyCityApp")).toHaveClass("ps-eyebrow");
    expect(screen.getByText("12 roles across 7 teams.")).toHaveAttribute("data-ui", "page-subtitle");
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("keeps the title whole when the accent is not in it, and draws the part at its right", () => {
    render(<PageIntro title="Open Roles" accent="Jobs" aside={<span>Search Roles</span>} />);
    expect(screen.getByRole("heading", { level: 1 }).querySelector("em")).toBeNull();
    expect(screen.getByText("Search Roles")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <PageIntro eyebrow="Careers at MyCityApp" title="Open Roles" accent="Roles" />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SiteNavigate } from "../shell/site-link";
import { RoleListTop, RoleRow } from "./RoleRow";

const facts = [
  { icon: "pin" as const, text: "Lekki Phase 1, Lagos" },
  { icon: "building" as const, text: "Hybrid, 2 days in office" },
  { icon: "brief" as const, text: "Full Time" },
];

describe("RoleRow", () => {
  it("is one link named by the title, described by the team, the facts and the closing date", async () => {
    const navigate = vi.fn();
    render(
      <SiteNavigate.Provider value={navigate}>
        <RoleRow href="/jobs/head-sales-revenue-lagos" team="Marketing & Sales" title="Head, Sales & Revenue" facts={facts} closes="18/11/2026" />
      </SiteNavigate.Provider>,
    );
    const link = screen.getByRole("link", { name: "Head, Sales & Revenue" });
    expect(link).toHaveAttribute("href", "/jobs/head-sales-revenue-lagos");
    expect(link).toHaveAccessibleDescription("Marketing & Sales. Lekki Phase 1, Lagos. Hybrid, 2 days in office. Full Time. Closes 18/11/2026");
    expect(screen.getByText("Marketing & Sales", { selector: ".ps-role-team" })).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("18/11/2026").tagName).toBe("B");
    await userEvent.click(link);
    expect(navigate).toHaveBeenCalledWith("/jobs/head-sales-revenue-lagos");
  });

  it("heads the list with how many it shows of how many, and its order", () => {
    render(<RoleListTop shown={4} total={12} order="Closing soonest first" />);
    expect(screen.getByText("4").tagName).toBe("B");
    expect(screen.getByText(/of 12/)).toBeInTheDocument();
    expect(screen.getByText("Closing soonest first")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <RoleListTop shown={1} total={12} order="Closing soonest first" />
        <RoleRow href="/jobs/city-editor-abuja" team="Content" title="City Editor, Abuja" facts={[{ icon: "pin", text: "Wuse, Abuja" }]} closes="25/11/2026" />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

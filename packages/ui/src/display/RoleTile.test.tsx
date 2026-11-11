import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { SiteNavigate } from "../shell/site-link";
import { RoleTile, RoleTiles } from "./RoleTile";

const draw = (navigate = vi.fn()) =>
  render(
    <SiteNavigate.Provider value={navigate}>
      <RoleTiles label="Closing Soon">
        <RoleTile href="/jobs/operations-intern-lagos" team="Operations & People" title="Operations Intern" line="Lekki Phase 1, Lagos. Closes 11/11/2026." />
        <RoleTile href="/jobs/head-sales-revenue-lagos" team="Marketing & Sales" title="Head, Sales & Revenue" line="Lekki Phase 1, Lagos. Closes 18/11/2026." />
      </RoleTiles>
    </SiteNavigate.Provider>,
  );

describe("RoleTile", () => {
  it("is a list of links, each named by its title, rising in turn", async () => {
    const navigate = vi.fn();
    draw(navigate);
    const list = screen.getByRole("list", { name: "Closing Soon" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]!.getAttribute("style")).toContain("180ms");
    const link = screen.getByRole("link", { name: "Operations Intern" });
    expect(link).toHaveAccessibleDescription("Operations & People. Lekki Phase 1, Lagos. Closes 11/11/2026.");
    await userEvent.click(link);
    expect(navigate).toHaveBeenCalledWith("/jobs/operations-intern-lagos");
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    expect(await axe(container)).toHaveNoViolations();
  });
});

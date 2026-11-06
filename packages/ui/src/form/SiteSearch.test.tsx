import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { SiteSearch } from "./SiteSearch";

function Hero({ onSubmit }: { onSubmit: (q: string) => void }) {
  const [q, setQ] = useState("");
  return <SiteSearch label="Search Roles" placeholder="Role or City" value={q} onChange={setQ} onSubmit={() => onSubmit(q)} />;
}

describe("SiteSearch", () => {
  it("is a search form: the box named by its label, Enter and the button both submit what was typed", async () => {
    const onSubmit = vi.fn();
    render(<Hero onSubmit={onSubmit} />);
    expect(screen.getByRole("search")).toHaveClass("ps-search-hero");
    const box = screen.getByRole("searchbox", { name: "Search Roles" });
    await userEvent.type(box, "Lagos{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith("Lagos");
    await userEvent.click(screen.getByRole("button", { name: "Search Roles" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("draws the intro's box with no button, following each key", async () => {
    const onChange = vi.fn();
    render(<SiteSearch tone="intro" label="Search Roles" value="" onChange={onChange} />);
    expect(screen.getByRole("search")).toHaveClass("ps-search-intro");
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SiteSearch label="Search Roles" action="Search Roles" value="" onChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

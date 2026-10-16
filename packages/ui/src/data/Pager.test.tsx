import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Pager } from "./Pager";
import type { PageMeta } from "./createApi";

const page = (over: Partial<PageMeta> = {}): PageMeta => ({ number: 1, size: 25, total: 312, pages: 13, has_next: true, ...over });

describe("Pager", () => {
  it("shows the server's true total, never 'showing 25'", () => {
    render(<Pager page={page()} onPage={vi.fn()} noun="employee" />);
    expect(screen.getByText("1 to 25 of 312 employees")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 13")).toBeInTheDocument();
  });

  it("counts the last page's real range", () => {
    render(<Pager page={page({ number: 13, has_next: false })} onPage={vi.fn()} noun="employee" />);
    expect(screen.getByText("301 to 312 of 312 employees")).toBeInTheDocument();
  });

  it("a single page says only the count, with no buttons", () => {
    render(<Pager page={page({ total: 7, pages: 1, has_next: false })} onPage={vi.fn()} noun="request" />);
    expect(screen.getByText("7 requests")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the singular for one row and the given plural", () => {
    const { rerender } = render(<Pager page={page({ total: 1, pages: 1, has_next: false })} onPage={vi.fn()} noun="query" nounPlural="queries" />);
    expect(screen.getByText("1 query")).toBeInTheDocument();
    rerender(<Pager page={page({ total: 4, pages: 1, has_next: false })} onPage={vi.fn()} noun="query" nounPlural="queries" />);
    expect(screen.getByText("4 queries")).toBeInTheDocument();
  });

  it("says nothing at all for an empty list, and 0 of the noun when the server says so", () => {
    const { container, rerender } = render(<Pager page={undefined} onPage={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    rerender(<Pager page={page({ total: 0, pages: 0, has_next: false })} onPage={vi.fn()} noun="expense" />);
    expect(screen.getByText("0 expenses")).toBeInTheDocument();
  });

  it("asks for the next and the previous page", async () => {
    const onPage = vi.fn();
    render(<Pager page={page({ number: 4 })} onPage={onPage} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenLastCalledWith(5);
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenLastCalledWith(3);
  });

  it("the first page cannot go back and the last cannot go on", () => {
    const { rerender } = render(<Pager page={page()} onPage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    rerender(<Pager page={page({ number: 13, has_next: false })} onPage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("the count is a live region, so Next is heard", () => {
    render(<Pager page={page()} onPage={vi.fn()} noun="employee" />);
    expect(screen.getByText("1 to 25 of 312 employees")).toHaveAttribute("aria-live", "polite");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Pager page={page({ number: 4 })} onPage={vi.fn()} noun="employee" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

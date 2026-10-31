import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { GuideBody, type GuideBlock } from "./GuideBody";
import { GUIDE_BLOCKS, GUIDE_PICTURE } from "./fixtures";

const blocks = GUIDE_BLOCKS as GuideBlock[];

describe("GuideBody", () => {
  it("numbers the steps and gives each an id to come back to", () => {
    const { container } = render(<GuideBody blocks={blocks} anchor="people-add-employee" />);
    expect(container.querySelector("#people-add-employee-step-2")).toHaveTextContent("Press Add Employee at the top right.");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });

  it("follows a screen link in the app, with the step it came from", async () => {
    const onLink = vi.fn();
    render(<GuideBody blocks={blocks} anchor="people-add-employee" onLink={onLink} />);
    const a = screen.getByRole("link", { name: "People · Employees" });
    expect(a).toHaveAttribute("href", "/people?tab=employees");
    await userEvent.click(a);
    expect(onLink).toHaveBeenCalledWith("/people?tab=employees", { anchor: "people-add-employee", step: 1 });
  });

  it("opens a page outside in a new tab and says so", () => {
    const outside = [{ kind: "paragraph", spans: [{ text: "MyCity", bold: false, italic: false, code: false, href: "https://mycityapp.io" }] }] as GuideBlock[];
    render(<GuideBody blocks={outside} anchor="a" onLink={vi.fn()} />);
    const a = screen.getByRole("link", { name: /MyCity/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a).toHaveAccessibleName(/^MyCity ?\(opens in a new tab\)$/);
  });

  it("shows a picture with its marks listed under it, and enlarges it", async () => {
    const onZoom = vi.fn();
    render(<GuideBody blocks={blocks} anchor="a" picture={() => GUIDE_PICTURE} onZoom={onZoom} />);
    expect(screen.getByRole("img", { name: "The Employees list with Add Employee at the top right" })).toBeInTheDocument();
    expect(screen.getByText("The search box")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Enlarge/ }));
    expect(onZoom).toHaveBeenCalledWith("people-add");
  });

  it("keeps a picture's place, with its text, when there is no file", () => {
    render(<GuideBody blocks={blocks} anchor="a" />);
    expect(screen.getByRole("img", { name: "The Employees list with Add Employee at the top right" })).toBeInTheDocument();
  });

  it("fetches a picture that needs the session", async () => {
    const fetchImage = vi.fn(async () => new Blob(["x"], { type: "image/png" }));
    const made = vi.fn(() => "blob:guide");
    const urls = URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
    const before = { create: urls.createObjectURL, revoke: urls.revokeObjectURL };
    urls.createObjectURL = made;
    urls.revokeObjectURL = vi.fn();
    try {
      const { container } = render(<GuideBody blocks={blocks} anchor="a" picture={() => ({ desktop: "/api/v1/user-guide/images/x.png", legend: [] })} fetchImage={fetchImage} />);
      await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:guide"));
      expect(fetchImage).toHaveBeenCalledWith("/api/v1/user-guide/images/x.png");
    } finally {
      urls.createObjectURL = before.create;
      urls.revokeObjectURL = before.revoke;
    }
  });

  it("marks the step the reader came back to", () => {
    const { container } = render(<GuideBody blocks={blocks} anchor="a" highlight={3} />);
    expect(container.querySelector("#a-step-3")).toHaveAttribute("data-current", "true");
    expect(container.querySelector("#a-step-1")).not.toHaveAttribute("data-current");
  });

  it("says a tip is a tip and draws a table with its header", () => {
    render(<GuideBody blocks={blocks} anchor="a" />);
    expect(screen.getByText("Tip:")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "What to enter" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<GuideBody blocks={blocks} anchor="a" picture={() => GUIDE_PICTURE} onZoom={vi.fn()} highlight={2} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

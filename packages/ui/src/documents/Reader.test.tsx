import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ArticleBody, Reader } from "./Reader";

const GROUPS = [
  { label: "Getting Started", items: [{ key: "a1", title: "Your first week" }, { key: "a2", title: "Clocking in" }] },
  { label: "Pay", items: [{ key: "a3", title: "When you are paid" }] },
];

const reader = (selected: string | null, onSelect = vi.fn()) =>
  render(
    <Reader groups={GROUPS} selected={selected} onSelect={onSelect}>
      <ArticleBody title="Your first week" meta={<span>Updated 13/10/2026</span>}>
        <p>Open the app and clock in.</p>
      </ArticleBody>
    </Reader>,
  );

describe("Reader", () => {
  it("is a named navigation landmark beside an article", () => {
    const { container } = reader("a1");
    expect(screen.getByRole("navigation", { name: "Articles" })).toBeInTheDocument();
    expect(container.querySelector("article")).not.toBeNull();
  });

  it("says which article is in view", () => {
    reader("a2");
    expect(screen.getByRole("button", { name: "Clocking in" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Your first week" })).not.toHaveAttribute("aria-current");
  });

  it("chooses an article", async () => {
    const onSelect = vi.fn();
    reader("a1", onSelect);
    await userEvent.click(screen.getByRole("button", { name: "When you are paid" }));
    expect(onSelect).toHaveBeenCalledWith("a3");
  });

  it("gives each article a 44 px target on a phone", () => {
    reader("a1");
    screen.getAllByRole("button").forEach((b) => expect(b.className).toContain("phone:min-h-tap"));
  });

  it("draws the article's own heading and its line of detail", () => {
    reader("a1");
    expect(screen.getByRole("heading", { name: "Your first week" })).toBeInTheDocument();
    expect(screen.getByText("Updated 13/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Open the app and clock in.")).toBeInTheDocument();
  });

  it("marks both the list and the article as content", () => {
    const { container } = reader("a1");
    expect(screen.getByRole("navigation")).toHaveAttribute("data-copy", "content");
    expect(container.querySelector("article > [data-copy=content]")).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = reader("a1");
    expect(await axe(container)).toHaveNoViolations();
  });
});

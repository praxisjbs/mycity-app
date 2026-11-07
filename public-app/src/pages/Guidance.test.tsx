// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Guidance } from "./Guidance";

/** The three pages a person is sent to, opened from the header without a link of their own. */
const draw = (of: "apply" | "assess" | "sign") =>
  render(
    <RouterProvider>
      <Guidance of={of} />
    </RouterProvider>,
  );

afterEach(() => window.history.replaceState({}, "", "/"));

describe("Guidance", () => {
  it.each([
    ["apply", "Apply", "Start From a Role", "See Open Roles", "/jobs"],
    ["assess", "Assessment", "Use Your Email Link", "See Open Roles", "/jobs"],
    ["sign", "Sign Offer", "Use Your Offer Email", "Verify a Document", "/verify"],
  ] as const)("%s: one heading, one line and one button that leads on", async (of, page, title, action, to) => {
    draw(of);
    const aside = screen.getByRole("complementary", { name: page });
    expect(within(aside).getAllByText(/\.$/)).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    const main = screen.getByRole("main");
    fireEvent.click(within(main).getByRole("button", { name: action }));
    await waitFor(() => expect(window.location.pathname).toBe(to));
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("assess");
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ErrorBoundary } from "./ErrorBoundary";

// React reports a caught render error to window as well; the boundary is what is under test.
beforeAll(() => window.addEventListener("error", (e) => e.preventDefault()));

let broken = true;
function Screen() {
  if (broken) throw new Error("boom");
  return <p>Team Roster</p>;
}

describe("ErrorBoundary", () => {
  it("shows ErrorState in place of a crashed screen, and Try Again renders it again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const onError = vi.fn();
    broken = true;
    render(
      <div>
        <nav>Rail</nav>
        <ErrorBoundary onError={onError}>
          <Screen />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This screen hit a problem");
    expect(screen.getByText("Rail")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }), expect.anything());
    broken = false;
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByText("Team Roster")).toBeInTheDocument();
  });

  it("takes a fallback, and resets when a reset key changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken = true;
    const { rerender } = render(
      <ErrorBoundary resetKeys={["home"]} fallback={(e) => <p>Failed: {e.message}</p>}>
        <Screen />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Failed: boom")).toBeInTheDocument();
    broken = false;
    rerender(
      <ErrorBoundary resetKeys={["people"]} fallback={(e) => <p>Failed: {e.message}</p>}>
        <Screen />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Team Roster")).toBeInTheDocument();
  });

  it("has no accessibility violations in its fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken = true;
    const { container } = render(
      <ErrorBoundary>
        <Screen />
      </ErrorBoundary>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

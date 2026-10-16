import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { NotificationRow } from "./NotificationRow";

describe("NotificationRow", () => {
  it("says unread in words as well as by the dot, with the line, the time and Open", () => {
    render(<NotificationRow title="New application" body="Adaeze Okonkwo applied for Content Producer." when="07:20" unread action={<Button size="sm">Open</Button>} />);
    const row = screen.getByRole("article");
    expect(row).toHaveTextContent("New application Unread");
    expect(row).toHaveTextContent("Adaeze Okonkwo applied for Content Producer.");
    expect(row).toHaveTextContent("07:20");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("read, says nothing more", () => {
    render(<NotificationRow title="Payroll preview ready" when="12/10/2026" />);
    expect(screen.getByRole("article")).not.toHaveTextContent("Unread");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <NotificationRow title="Expense request waiting on you" body="₦185,000.00" when="08:41" tone="warn" icon="check" unread />
        <NotificationRow title="You were recognised" when="Yesterday" tone="ok" icon="thumb" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

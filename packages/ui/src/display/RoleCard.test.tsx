import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { RoleCard, ShareCard } from "./RoleCard";

const items = [
  { label: "Employment", value: "Full Time" },
  { label: "Working Days", value: "Monday to Saturday" },
  { label: "Reports To", value: "Chief Executive Officer" },
];

const draw = () =>
  render(
    <main>
      <RoleCard title="The Role" items={items} closing="Closes 18/11/2026" action={<Button variant="primary" block>Apply for This Role</Button>} note="12 people have applied" />
      <ShareCard title="Know Someone for This?" text="Send them this role. Their application comes straight to us." action={<Button variant="line">Copy Role Link</Button>} />
    </main>,
  );

describe("RoleCard", () => {
  it("names its facts as rows, then the closing date, the action and the note on its tint", () => {
    draw();
    const card = screen.getByRole("region", { name: "The Role" });
    expect(within(card).getByText("Working Days").tagName).toBe("DT");
    expect(within(card).getByText("Monday to Saturday")).toHaveAttribute("data-copy", "content");
    const act = within(card).getByRole("button", { name: "Apply for This Role" }).parentElement!;
    expect(act).toHaveClass("ps-card-act");
    expect(within(act).getByText("Closes 18/11/2026")).toHaveClass("ps-closing");
    expect(within(act).getByText("12 people have applied").tagName).toBe("P");
  });

  it("passes the role on from its share card", () => {
    draw();
    const share = screen.getByRole("region", { name: "Know Someone for This?" });
    expect(share).toHaveClass("ps-share");
    expect(within(share).getByRole("button", { name: "Copy Role Link" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    expect(await axe(container)).toHaveNoViolations();
  });
});

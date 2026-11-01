import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ActionCard, instantOf, verbOf, type CardField, type CardRecord } from "./ActionCard";

const fields: CardField[] = [
  { name: "leave_request_ids", label: "Requests", kind: "list", required: true, options: null, long: false },
  { name: "reason", label: "Reason", kind: "text", required: false, options: null, long: true },
];
const records: CardRecord[] = [
  { type: "leave_request", id: "l1", label: "Ayo Bello, Annual Leave, 3 days", link: "/people?tab=leave&id=l1" },
  { type: "leave_request", id: "l2", label: "Kemi Ade, Annual Leave, 2 days", link: "/people?tab=leave&id=l2" },
];
const schema = { safeParse: (v: unknown) => ({ success: true, data: v }) };

describe("ActionCard", () => {
  it("names the action, lists the values as a person reads them and the records it touches, and the verb carries the count and waits with Cancel", async () => {
    const onConfirm = vi.fn(() => new Promise<void>((r) => setTimeout(r, 30)));
    const onCancel = vi.fn();
    const onOpen = vi.fn();
    render(<ActionCard label="Approve Leave" fields={fields} values={{ leave_request_ids: ["l1", "l2"], reason: "Enjoy" }} problems={{}} records={records} status="shown" confirm="fresh_sign_in" onConfirm={onConfirm} onCancel={onCancel} onOpen={onOpen} />);
    const card = screen.getByRole("group", { name: "Approve Leave" });
    expect(within(card).getByText("Ayo Bello, Annual Leave, 3 days, Kemi Ade, Annual Leave, 2 days")).toHaveAttribute("data-copy", "content");
    expect(within(card).getByText("Enjoy")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Kemi Ade, Annual Leave, 2 days" }));
    expect(onOpen).toHaveBeenCalledWith("/people?tab=leave&id=l2");
    const verb = within(card).getByRole("button", { name: "Approve Leave ×2" });
    await userEvent.click(verb);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(verb).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(verb).not.toHaveAttribute("aria-busy", "true"));
  });

  it("a suggested card reads as a question with Not Now; a decision names the verb", async () => {
    const onCancel = vi.fn();
    render(<ActionCard label="Send Message" fields={[{ name: "body", label: "Message", kind: "text", required: true, options: null, long: true }]} values={{ body: "Your leave is approved." }} problems={{}} records={[]} status="shown" confirm="press" suggested onConfirm={() => undefined} onCancel={onCancel} />);
    expect(screen.getByRole("group", { name: "Send Message?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not Now" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(verbOf("Decide Requests", [{ name: "decision", label: "Decision", kind: "choice", required: true, options: ["approve", "reject", "request_changes"], long: false }], { decision: "request_changes" }, 3)).toBe("Request Changes ×3");
    expect(instantOf("2026-11-19", "10:00")).toBe("2026-11-19T10:00:00+01:00");
  });

  it("shows a problem on its field, and Edit saves the fields through the form system", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ActionCard label="Reject Leave" fields={fields} values={{ leave_request_ids: ["l1"] }} problems={{ reason: ["Say why"] }} records={[records[0]!]} status="shown" confirm="fresh_sign_in" schema={schema} onConfirm={() => undefined} onSave={onSave} />);
    expect(screen.getByText("Say why")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const reason = screen.getByRole("textbox", { name: "Reason" });
    await userEvent.type(reason, "The team is short");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reason: "The team is short", leave_request_ids: ["l1"] })));
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
  });

  it("once pressed, the result line sits under it with no buttons; expired offers Draw It Again; a refusal is an alert with its screen", async () => {
    const onRedraw = vi.fn();
    const onPress = vi.fn();
    const { rerender } = render(<ActionCard label="Create Task" fields={[]} values={{}} problems={{}} records={[]} status="done" confirm="press" result={{ status: "done", lines: [{ type: "task", id: "t1", label: "T-12 Send the report", ok: true, message: "created", link: null }], message: null, error_code: null }} onConfirm={() => undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Done");
    expect(screen.queryByRole("button", { name: "Create Task" })).toBeNull();
    rerender(<ActionCard label="Create Task" fields={[]} values={{}} problems={{}} records={[]} status="expired" confirm="press" onRedraw={onRedraw} />);
    await userEvent.click(screen.getByRole("button", { name: "Draw It Again" }));
    expect(onRedraw).toHaveBeenCalledTimes(1);
    rerender(<ActionCard label="Send Mail" fields={[]} values={{}} problems={{}} records={[]} status="shown" confirm="press" onConfirm={() => undefined} problem="Connect your mailbox first" problemAction={{ label: "Open Mailbox", onPress }} />);
    expect(screen.getByRole("alert").textContent).toContain("Connect your mailbox first");
    await userEvent.click(screen.getByRole("button", { name: "Open Mailbox" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ActionCard label="Approve Leave" fields={fields} values={{ leave_request_ids: ["l1", "l2"] }} problems={{}} records={records} status="shown" confirm="fresh_sign_in" schema={schema} onConfirm={() => undefined} onCancel={() => undefined} onSave={() => undefined} onOpen={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

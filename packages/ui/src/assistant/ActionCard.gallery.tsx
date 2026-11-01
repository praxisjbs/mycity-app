import type { ReactNode } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { ActionCard, type CardField, type CardRecord } from "./ActionCard";

const schema = { safeParse: (v: unknown) => ({ success: true, data: v }) };

const leaveFields: CardField[] = [
  { name: "leave_request_ids", label: "Requests", kind: "list", required: true, options: null, long: false },
  { name: "reason", label: "Reason", kind: "text", required: false, options: null, long: true },
];
const leaveRecords: CardRecord[] = [
  { type: "leave_request", id: "l1", label: "Ayo Bello, Annual Leave, 3 days", link: "/people?tab=leave&id=l1" },
  { type: "leave_request", id: "l2", label: "Kemi Ade, Annual Leave, 2 days", link: "/people?tab=leave&id=l2" },
  { type: "leave_request", id: "l3", label: "Emeka Obi, Annual Leave, 1 day", link: "/people?tab=leave&id=l3" },
  { type: "leave_request", id: "l4", label: "Hauwa Bello, Annual Leave, 2 days", link: "/people?tab=leave&id=l4" },
];
const taskFields: CardField[] = [
  { name: "title", label: "Title", kind: "text", required: true, options: null, long: false },
  { name: "description", label: "Notes", kind: "text", required: false, options: null, long: true },
  { name: "priority", label: "Priority", kind: "choice", required: false, options: ["low", "normal", "high"], long: false },
  { name: "due_on", label: "Due Day", kind: "date", required: false, options: null, long: false },
  { name: "primary_assignee_id", label: "For", kind: "id", required: false, options: null, long: false },
];
const mailFields: CardField[] = [
  { name: "to_addresses", label: "To", kind: "list", required: true, options: null, long: false },
  { name: "subject", label: "Subject", kind: "text", required: true, options: null, long: false },
  { name: "body", label: "Message", kind: "text", required: true, options: null, long: true },
];
const noop = () => undefined;
const frame = (children: ReactNode) => <div className="max-w-xl">{children}</div>;

export default {
  component: "ActionCard",
  states: {
    "Approve Four": () => frame(<ActionCard label="Approve Leave" fields={leaveFields} values={{ leave_request_ids: ["l1", "l2", "l3", "l4"] }} problems={{}} records={leaveRecords} status="shown" confirm="fresh_sign_in" schema={schema} onConfirm={noop} onCancel={noop} onSave={noop} onOpen={noop} />),
    "A Task": () => frame(<ActionCard label="Create Task" fields={taskFields} values={{ title: "Send the weekly report", priority: "high", due_on: "2026-11-06" }} problems={{}} records={[]} status="shown" confirm="press" schema={schema} onConfirm={noop} onCancel={noop} onSave={noop} />),
    "A Problem": () => frame(<ActionCard label="Reject Leave" fields={leaveFields} values={{ leave_request_ids: ["l1"] }} problems={{ reason: ["Say why"] }} records={[leaveRecords[0]!]} status="shown" confirm="fresh_sign_in" schema={schema} onConfirm={noop} onCancel={noop} onSave={noop} onOpen={noop} />),
    Suggested: () => frame(<ActionCard label="Send Message" fields={[{ name: "employee_id", label: "To", kind: "id", required: true, options: null, long: false }, { name: "body", label: "Message", kind: "text", required: true, options: null, long: true }]} values={{ employee_id: "e1", body: "Your leave is approved. Enjoy the break." }} problems={{}} records={[{ type: "employee", id: "e1", label: "Ada Obi", link: "/people?tab=employees&id=e1" }]} status="shown" confirm="press" suggested onConfirm={noop} onCancel={noop} onOpen={noop} />),
    "A Mail": () => frame(<ActionCard label="Send Mail" fields={mailFields} values={{ to_addresses: ["ada@partner.test"], subject: "Venue visit on Thursday", body: "Dear Ada,\n\nThis confirms our visit on Thursday at 10:00.\n\nWe look forward to seeing you." }} problems={{}} records={[]} status="shown" confirm="press" schema={schema} onConfirm={noop} onCancel={noop} onSave={noop} />),
    Done: () => frame(<ActionCard label="Approve Leave" fields={leaveFields} values={{ leave_request_ids: ["l1", "l2"] }} problems={{}} records={leaveRecords.slice(0, 2)} status="done" confirm="fresh_sign_in" result={{ status: "done", lines: [{ type: "leave_request", id: "l1", label: "Ayo Bello, Annual Leave, 3 days", ok: true, message: "approved", link: "/people?tab=leave&id=l1" }, { type: "leave_request", id: "l2", label: "Kemi Ade, Annual Leave, 2 days", ok: false, message: "This request was already decided", link: "/people?tab=leave&id=l2" }], message: null, error_code: null }} onOpen={noop} />),
    Expired: () => frame(<ActionCard label="Create Task" fields={taskFields} values={{ title: "Send the weekly report" }} problems={{}} records={[]} status="expired" confirm="press" onRedraw={noop} />),
    Refused: () => frame(<ActionCard label="Send Mail" fields={mailFields} values={{ to_addresses: ["ada@partner.test"], subject: "Thursday", body: "See you on Thursday at 10." }} problems={{}} records={[]} status="shown" confirm="press" onConfirm={noop} onCancel={noop} problem="Connect your mailbox first" problemAction={{ label: "Open Mailbox", onPress: noop }} />),
  },
} satisfies GalleryEntry;

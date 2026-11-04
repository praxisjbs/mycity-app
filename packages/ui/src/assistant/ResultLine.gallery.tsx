import type { GalleryEntry } from "../testing/gallery";
import { ResultLine } from "./ResultLine";

const lines = [
  { type: "leave_request", id: "l1", label: "Ayo Bello, Annual Leave, 3 days", ok: true, message: "approved", link: "/people?tab=leave&id=l1" },
  { type: "leave_request", id: "l2", label: "Kemi Ade, Annual Leave, 2 days", ok: true, message: "approved", link: "/people?tab=leave&id=l2" },
  { type: "leave_request", id: "l3", label: "Emeka Obi, Annual Leave, 1 day", ok: false, message: "This request was already decided", link: "/people?tab=leave&id=l3" },
];

export default {
  component: "ResultLine",
  states: {
    Done: () => <ResultLine result={{ status: "done", lines, message: null, error_code: null }} onOpen={() => undefined} />,
    "One Record": () => <ResultLine result={{ status: "done", lines: [{ type: "task", id: "t1", label: "T-12 Send the weekly report", ok: true, message: "created", link: "/workspace?tab=tasks&id=t1" }], message: null, error_code: null }} onOpen={() => undefined} />,
    Failed: () => <ResultLine result={{ status: "failed", lines: [], message: "The mailbox is not connected", error_code: "NO_MAILBOX" }} />,
  },
} satisfies GalleryEntry;

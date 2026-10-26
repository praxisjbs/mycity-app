// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Chips } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { mockSession } from "@/api/mock/core";
import { RouterProvider } from "@/lib/router";
import { RecordMarks, useOpenWhereNews, useViewNews, withNews } from "./marks";

/**
 * Where it waits inside a tab (docs/guides/notifications.md §6), against the in-browser mock:
 * Amara's leave request is Pending on People · Leave, with an unread notice about it.
 */
type Status = "all" | "submitted" | "approved";
const CHIPS: Array<[Status, string]> = [
  ["all", "All"],
  ["submitted", "Pending"],
  ["approved", "Approved"],
];

function LeaveChips({ start }: { start: Status }) {
  const news = useViewNews();
  const [status, setStatus] = useState<Status>(start);
  useOpenWhereNews({ value: status, onChange: setStatus, values: CHIPS.map(([v]) => v), all: "all" });
  return <Chips label="Status" value={status} onChange={setStatus} options={withNews(news, CHIPS, { all: "all" })} />;
}

function Screen({ count, start }: { count: number; start: Status }) {
  return (
    <RouterProvider>
      <RecordMarks module="people" tab="leave" count={count}>
        <LeaveChips start={start} />
      </RecordMarks>
    </RouterProvider>
  );
}

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("where it waits inside a tab", () => {
  beforeAll(() => {
    mockSession.set("cynthia");
    installMatchMedia();
    setViewport(1440);
  });
  afterEach(cleanup);

  it("each chip carries the unread notices about the records it shows, and All the whole of them", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(<Screen count={1} start="all" />);
    expect(await screen.findByRole("button", { name: "Pending 1 unread" })).toBeTruthy();
    expect(pressed("All 1 unread")).toBe("true");
    expect(screen.getByRole("button", { name: "Approved" })).toBeTruthy();
  });

  it("opens on the chip holding the news when the one it opened on holds none", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(<Screen count={1} start="approved" />);
    await waitFor(() => expect(pressed("Pending 1 unread")).toBe("true"));
    expect(pressed("Approved")).toBe("false");
  });

  it("asks nothing and moves nothing while the tab counts nothing", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(<Screen count={0} start="approved" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(pressed("Approved")).toBe("true");
    expect(screen.getByRole("button", { name: "Pending" })).toBeTruthy();
  });
});

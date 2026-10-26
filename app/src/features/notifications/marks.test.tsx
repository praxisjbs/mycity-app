// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataView, type DataViewColumn } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { mockSession, sid } from "@/api/mock/core";
import { RouterProvider } from "@/lib/router";
import { RecordMarks } from "./marks";

/**
 * Where something new waits inside a module (docs/guides/notifications.md §6), against the
 * in-browser mock: Amara's leave request and Chidera's record each have an unread notice.
 */
interface Row {
  id: string;
  name: string;
}
const COLUMNS: DataViewColumn<Row>[] = [{ key: "name", label: "Name", render: (r) => r.name }];
const AMARA = sid("leave:1");
const HAUWA = sid("leave:0");
const CHIDERA = sid("employee:chidera");

function Screen({ module, tab, count, rows }: { module: string; tab: string; count: number; rows: Row[] }) {
  return (
    <RouterProvider>
      <RecordMarks module={module} tab={tab} count={count}>
        <DataView rows={rows} columns={COLUMNS} rowKey={(r) => r.id} caption="Records" onRowClick={() => undefined} />
      </RecordMarks>
    </RouterProvider>
  );
}

const unread = (module: string, tab: string, ids: string[]) => api.call("GET /api/v1/notifications/unread-records", { query: { module, tab, ids: ids.join(",") } });

describe("record marks", () => {
  beforeAll(() => {
    mockSession.set("cynthia");
    installMatchMedia();
    setViewport(1440);
  });
  afterEach(cleanup);

  it("asks nothing while the tab counts nothing", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(<Screen module="people" tab="leave" count={0} rows={[{ id: AMARA, name: "Amara Okafor" }]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("cell", { name: "Amara Okafor" })).toBeTruthy();
    expect(document.querySelector("[data-unread]")).toBeNull();
  });

  it("marks the rows with something unread on this screen, and reads one when it is opened", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(
      <Screen
        module="people"
        tab="leave"
        count={1}
        rows={[
          { id: AMARA, name: "Amara Okafor" },
          { id: HAUWA, name: "Hauwa Bello" },
        ]}
      />,
    );
    const row = await screen.findByRole("cell", { name: /^Unread,\s*Amara Okafor$/ });
    expect(screen.getByRole("cell", { name: "Hauwa Bello" })).toBeTruthy();
    await userEvent.click(row);
    // The dot goes at once, and the server has read it.
    expect(screen.queryByRole("cell", { name: /^Unread,\s*Amara Okafor$/ })).toBeNull();
    await waitFor(async () => expect(await unread("people", "leave", [AMARA])).toEqual({ ids: [] }));
  });

  it("reads a record opened by its address", async () => {
    expect(await unread("people", "employees", [CHIDERA])).toEqual({ ids: [CHIDERA] });
    window.history.replaceState(null, "", `/people?tab=employees&id=${CHIDERA}`);
    render(<Screen module="people" tab="employees" count={1} rows={[]} />);
    await waitFor(async () => expect(await unread("people", "employees", [CHIDERA])).toEqual({ ids: [] }));
    expect((await api.call("GET /api/v1/notifications/badges")).tabs.people).toBeUndefined();
  });
});

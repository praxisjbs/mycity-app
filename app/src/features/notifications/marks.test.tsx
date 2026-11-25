// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataView, type DataViewColumn } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { mockSession, sid } from "@/api/mock/core";
import { RouterProvider } from "@/lib/router";
import { RecordMarks } from "./marks";

/** Every unread-records request the mock answers, by its ids, so a test can count them. */
const asked = vi.hoisted(() => [] as string[][]);
vi.mock("@/api/mock", async (load) => {
  const real = await load<typeof import("@/api/mock")>();
  return {
    ...real,
    mockTransport: (req: Parameters<typeof real.mockTransport>[0]) => {
      if (req.path === "/api/v1/notifications/unread-records") asked.push(String(req.query.ids).split(","));
      return real.mockTransport(req);
    },
  };
});

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
  beforeAll(async () => {
    mockSession.set("cynthia");
    installMatchMedia();
    setViewport(1440);
    // Load the mock once before any test counts its requests.
    await api.call("GET /api/v1/notifications/badges");
  });
  afterEach(cleanup);

  it("asks nothing while the tab counts nothing", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    render(<Screen module="people" tab="leave" count={0} rows={[{ id: AMARA, name: "Amara Okafor" }]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("cell", { name: "Amara Okafor" })).toBeTruthy();
    expect(document.querySelector("[data-unread]")).toBeNull();
  });

  it("asks once for every list on the screen, not once per list", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    asked.length = 0;
    const lists = [
      [{ id: AMARA, name: "Amara Okafor" }],
      [{ id: HAUWA, name: "Hauwa Bello" }],
      [{ id: sid("leave:other"), name: "Tunde Bakare" }],
    ];
    render(
      <RouterProvider>
        <RecordMarks module="people" tab="leave" count={1}>
          {lists.map((rows, i) => (
            <DataView key={i} rows={rows} columns={COLUMNS} rowKey={(r) => r.id} caption={`Objective ${i + 1}`} onRowClick={() => undefined} />
          ))}
        </RecordMarks>
      </RouterProvider>,
    );
    // Each list marks its own rows from the screen's one answer.
    expect(await screen.findByRole("cell", { name: /^Unread,\s*Amara Okafor$/ })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Hauwa Bello" })).toBeTruthy();
    expect(asked).toHaveLength(1);
    expect([...asked[0]].sort()).toEqual([AMARA, HAUWA, sid("leave:other")].sort());
  });

  it("asks in pages of 25 ids when the screen's lists show more", async () => {
    window.history.replaceState(null, "", "/people?tab=leave");
    asked.length = 0;
    const many = Array.from({ length: 30 }, (_, i) => ({ id: sid(`goal:${i}`), name: `Key Result ${i + 1}` }));
    render(
      <RouterProvider>
        <RecordMarks module="people" tab="leave" count={1}>
          <DataView rows={many.slice(0, 20)} columns={COLUMNS} rowKey={(r) => r.id} caption="Grow Revenue" onRowClick={() => undefined} />
          <DataView rows={[...many.slice(20), { id: AMARA, name: "Amara Okafor" }]} columns={COLUMNS} rowKey={(r) => r.id} caption="Hire Well" onRowClick={() => undefined} />
        </RecordMarks>
      </RouterProvider>,
    );
    expect(await screen.findByRole("cell", { name: /^Unread,\s*Amara Okafor$/ })).toBeTruthy();
    expect(asked).toHaveLength(2);
    expect(asked.every((ids) => ids.length <= 25)).toBe(true);
    expect(new Set(asked.flat()).size).toBe(31);
    expect(asked.flat()).toHaveLength(31);
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

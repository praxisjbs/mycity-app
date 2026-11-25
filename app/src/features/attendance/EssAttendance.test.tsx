// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AttendanceDay } from "@mycity/contract/contract.gen.ts";
import { installMatchMedia } from "@mycity/ui/testing";
import { DAY_COLUMNS, PEOPLE_DAY_COLUMNS } from "./EssAttendance";

/**
 * My Days' Hours (docs/guides/attendance.md §10.1; QA BG-015): after a System Clock-Out a day's hours
 * count only to the shift's end, so the figure says so behind a help term, in the person's words on
 * My Attendance and in People's on All Days. A day the person clocked out of themselves carries none.
 */
installMatchMedia();
afterEach(cleanup);

const day = (automatic: boolean) => ({ worked_minutes: 456, clock_out_automatic: automatic }) as AttendanceDay;
const hoursCell = (columns: typeof DAY_COLUMNS, d: AttendanceDay) => render(<>{columns.find((c) => c.label === "Hours")!.render(d)}</>);

describe("a day's Hours", () => {
  it("after a System Clock-Out, says behind help that it counts to the shift's end", () => {
    hoursCell(DAY_COLUMNS, day(true));
    expect(screen.getByText("7h 36m")).toBeTruthy();
    expect(screen.getByText("Counted to the shift's end. Give your real time if you left later.")).toBeTruthy();
  });

  it("speaks of the person on People's All Days", () => {
    hoursCell(PEOPLE_DAY_COLUMNS, day(true));
    expect(screen.getByText("Counted to the shift's end. The person can give their real time if they left later.")).toBeTruthy();
  });

  it("carries no help on a day the person clocked out of", () => {
    const { container } = hoursCell(DAY_COLUMNS, day(false));
    expect(container.textContent).toBe("7h 36m");
  });
});

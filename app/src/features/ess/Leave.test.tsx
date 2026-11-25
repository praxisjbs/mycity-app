// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LeaveRequest } from "@mycity/contract/contract.gen.ts";
import { approverOf } from "./Leave";

/**
 * My Requests' Approver (docs/guides/ess.md §10): the person a request waits on by name, else the
 * stage; People for leave they recorded; nobody for a cancelled request, whose state reads once, in
 * Status (QA BG-059: it read Withdrawn beside a Cancelled pill).
 */
const request = (over: Partial<LeaveRequest>) => ({ status: "submitted", approver_name: null, waiting_on: null, recorded: false, ...over }) as LeaveRequest;

describe("My Requests' Approver", () => {
  it("names who a waiting request waits on, else its stage", () => {
    expect(approverOf(request({ approver_name: "Kemi Alade", waiting_on: "Line Manager" }))).toBe("Kemi Alade");
    expect(approverOf(request({ waiting_on: "Admin Override" }))).toBe("Admin Override");
  });

  it("says People for recorded leave and Decided for a settled request", () => {
    expect(approverOf(request({ status: "approved", recorded: true }))).toBe("People");
    expect(approverOf(request({ status: "rejected" }))).toBe("Decided");
  });

  it("leaves a cancelled request's Approver empty: its Status says it", () => {
    expect(approverOf(request({ status: "cancelled" }))).toBeNull();
    expect(approverOf(request({ status: "cancelled", recorded: true }))).toBeNull();
  });
});

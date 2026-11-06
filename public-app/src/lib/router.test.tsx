// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parse, sectionOf } from "./router";

/** The site's addresses (MILESTONES §6) and the header link each belongs to. */
describe("router", () => {
  it.each([
    ["/", { page: "home" }, null],
    ["/jobs", { page: "careers" }, "Careers"],
    ["/jobs/head-sales-revenue-lagos", { page: "vacancy", slug: "head-sales-revenue-lagos" }, "Vacancy"],
    ["/jobs/", { page: "guide", of: "vacancy" }, "Vacancy"],
    ["/vacancy", { page: "guide", of: "vacancy" }, "Vacancy"],
    ["/apply", { page: "guide", of: "apply" }, "Apply"],
    ["/apply/k7Qm2TxV9pLa", { page: "apply", token: "k7Qm2TxV9pLa" }, "Apply"],
    ["/assess", { page: "guide", of: "assess" }, "Assessment"],
    ["/assess/Px2mL9vQe4Ty", { page: "assess", token: "Px2mL9vQe4Ty" }, "Assessment"],
    ["/sign", { page: "guide", of: "sign" }, "Sign Offer"],
    ["/sign/Rt8wN2kPz5Gb", { page: "sign", token: "Rt8wN2kPz5Gb" }, "Sign Offer"],
    ["/verify", { page: "verify", number: null }, "Verify Document"],
    ["/verify/OFF-0016", { page: "verify", number: "OFF-0016" }, "Verify Document"],
    ["/verify/t/Qd5mW8rTx3Kp", { page: "verify-qr", token: "Qd5mW8rTx3Kp" }, "Verify Document"],
    ["/proposal/abc", { page: "proposal", token: "abc" }, null],
    ["/nowhere/at/all", { page: "not-found" }, null],
  ] as const)("%s", (path, route, section) => {
    expect(parse(path)).toEqual(route);
    expect(sectionOf(parse(path))).toBe(section);
  });
});

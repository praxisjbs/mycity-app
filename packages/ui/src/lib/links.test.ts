import { describe, expect, it } from "vitest";
import { findLinks, firstLink, hostOf, normaliseLink } from "./links";

/** The same cases as the server's rule (tests/unit/foundation/web-fetch.test.js), so both find the same first link. */
describe("links", () => {
  const found = (text: string) => findLinks(text).map((l) => [l.text, l.href]);

  it("finds http, https, www and bare domains on a known ending, in order", () => {
    expect(found("see https://nfelia.com/about, then www.mycityapp.io or jumia.com.ng")).toEqual([
      ["https://nfelia.com/about", "https://nfelia.com/about"],
      ["www.mycityapp.io", "https://www.mycityapp.io/"],
      ["jumia.com.ng", "https://jumia.com.ng/"],
    ]);
  });

  it("leaves out email addresses, file names, sentence punctuation and stray brackets", () => {
    expect(found("mail ada@nfelia.com about report.pdf, e.g. node.js 3.14")).toEqual([]);
    expect(found("Visit nfelia.com.")).toEqual([["nfelia.com", "https://nfelia.com/"]]);
    expect(found("(see https://x.com/a_(b))")).toEqual([["https://x.com/a_(b)", "https://x.com/a_(b)"]]);
  });

  it("gives a card only to the first link, on 80 or 443 with no credentials", () => {
    expect(firstLink("http://intranet.local:8080/x then https://nfelia.com")).toBeNull();
    expect(firstLink("Look: Nfelia.com/About#top")).toBe("https://nfelia.com/About");
    expect(normaliseLink("https://user:pw@nfelia.com")).toBeNull();
    expect(normaliseLink("ftp://nfelia.com")).toBeNull();
    expect(normaliseLink("localhost")).toBeNull();
  });

  it("names a link's host without www", () => {
    expect(hostOf("https://www.nfelia.com/shop")).toBe("nfelia.com");
  });
});

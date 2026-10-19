"use strict";
/**
 * Reading the public web for link cards (src/services/web; docs/guides/community.md §6):
 * what counts as a link, the address guard, the limits, and what a page's card holds.
 * A local server stands in for the web; the guard is told to let the loopback through
 * only where a test says so.
 */
const http = require("node:http");
const zlib = require("node:zlib");
const links = require("../../../src/services/web/links");
const publicFetch = require("../../../src/services/web/public-fetch");
const pageCard = require("../../../src/services/web/page-card");

const { PublicFetchError, isPublicAddress, createFetcher } = publicFetch;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

describe("links: what counts as a link", () => {
  const found = (text) => links.findLinks(text).map((l) => [l.text, l.href]);

  test("http, https, www and bare domains on a known ending, in order", () => {
    expect(found("see https://nfelia.com/about, then www.mycityapp.io or jumia.com.ng")).toEqual([
      ["https://nfelia.com/about", "https://nfelia.com/about"],
      ["www.mycityapp.io", "https://www.mycityapp.io/"],
      ["jumia.com.ng", "https://jumia.com.ng/"],
    ]);
  });

  test("an email address, a file name and an abbreviation are not links", () => {
    expect(found("mail ada@nfelia.com about report.pdf, e.g. node.js 3.14")).toEqual([]);
  });

  test("the punctuation that ends a sentence and a bracket the link did not open are left out", () => {
    expect(found("Visit nfelia.com.")).toEqual([["nfelia.com", "https://nfelia.com/"]]);
    expect(found("(see https://x.com/a_(b))")).toEqual([["https://x.com/a_(b)", "https://x.com/a_(b)"]]);
    expect(found("Read https://nfelia.com/a?b=1!")).toEqual([["https://nfelia.com/a?b=1", "https://nfelia.com/a?b=1"]]);
  });

  test("another scheme is never a link", () => {
    expect(found("javascript:alert(1) and mailto:a@b.com and ftp://x.com")).toEqual([]);
  });

  test("any http link is clickable, but only the first, on 80 or 443 with no credentials, gets a card", () => {
    expect(found("http://intranet.local:8080/x")).toEqual([["http://intranet.local:8080/x", "http://intranet.local:8080/x"]]);
    expect(links.firstLink("http://intranet.local:8080/x then https://nfelia.com")).toBeNull();
    expect(links.firstLink("Look: Nfelia.com/About#top")).toBe("https://nfelia.com/About");
    expect(links.normalise("https://user:pw@nfelia.com")).toBeNull();
    expect(links.normalise("localhost")).toBeNull();
    expect(links.normalise(`https://x.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("isPublicAddress", () => {
  test.each([
    "127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "192.0.2.10", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "2002:a00:1::1", "ff02::1",
    "not-an-address", "",
  ])("%s is not on the public internet", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  test.each(["8.8.8.8", "102.89.1.1", "2001:4860:4860::8888", "[2606:4700::1111]"])("%s is", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

/** A local stand-in for the web, its routes keyed by path. */
function serve(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url.split("?")[0]];
    if (!handler) {
      res.writeHead(404).end("missing");
      return;
    }
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** A fetcher that resolves every name to the loopback and lets the loopback through. */
const loopback = (port, extra = {}) =>
  createFetcher({
    isAllowed: (ip) => ip === "127.0.0.1",
    ports: [port],
    lookup: (host, opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    ...extra,
  });

describe("publicFetch: the guard", () => {
  test("an address on a private network is refused before anything is sent", async () => {
    await expect(publicFetch.get("http://127.0.0.1/admin", { maxBytes: 100 })).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(publicFetch.get("http://[::1]/", { maxBytes: 100 })).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(publicFetch.get("http://2130706433/", { maxBytes: 100 })).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  test("a name that resolves to a private address is refused, even beside a public one", async () => {
    const f = (addresses) => createFetcher({ lookup: (host, opts, cb) => cb(null, addresses) });
    await expect(f([{ address: "10.0.0.5", family: 4 }]).get("http://inside.example/", { maxBytes: 100 })).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS",
    });
    await expect(
      f([
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]).get("http://mixed.example/", { maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  test("another port, another scheme or a password in the address is refused", async () => {
    for (const address of ["http://example.com:8080/", "ftp://example.com/", "https://u:p@example.com/", "not a url"]) {
      await expect(publicFetch.get(address, { maxBytes: 100 })).rejects.toBeInstanceOf(PublicFetchError);
    }
    await expect(publicFetch.get("http://example.com:8080/", { maxBytes: 100 })).rejects.toMatchObject({ code: "BAD_ADDRESS" });
  });
});

describe("publicFetch: against a local server", () => {
  let web;
  let fetcher;
  const big = Buffer.alloc(5000, "a");
  beforeAll(async () => {
    web = await serve({
      "/page": (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><head><title>Hi</title></head><body>${req.headers["user-agent"]}</body></html>`);
      },
      "/gzip": (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
        res.end(zlib.gzipSync("<title>Squeezed</title>"));
      },
      "/big": (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(big);
      },
      "/hop": (req, res) => res.writeHead(302, { Location: "/page" }).end(),
      "/loop": (req, res) => res.writeHead(301, { Location: "/loop" }).end(),
      "/inside": (req, res) => res.writeHead(302, { Location: "http://10.0.0.9/" }).end(),
      "/away": (req, res) => res.writeHead(302, { Location: "file:///etc/passwd" }).end(),
      "/slow": () => undefined,
    });
    fetcher = loopback(web.port);
  });
  afterAll(() => new Promise((r) => web.server.close(r)));

  const at = (path) => `http://card.test:${web.port}${path}`;

  test("reads a page, saying who is asking", async () => {
    const page = await fetcher.get(at("/page"), { accept: "text/html", maxBytes: 10_000 });
    expect(page.status).toBe(200);
    expect(page.type).toBe("text/html");
    expect(page.body.toString()).toContain("MyCityLinkPreview");
  });

  test("decompresses what the server compressed", async () => {
    const page = await fetcher.get(at("/gzip"), { maxBytes: 10_000 });
    expect(page.body.toString()).toBe("<title>Squeezed</title>");
  });

  test("follows a redirect, and gives up after four", async () => {
    const page = await fetcher.get(at("/hop"), { maxBytes: 10_000 });
    expect(page.url).toBe(at("/page"));
    await expect(fetcher.get(at("/loop"), { maxBytes: 10_000 })).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  test("checks every redirect as it checked the first", async () => {
    await expect(fetcher.get(at("/inside"), { maxBytes: 10_000 })).rejects.toMatchObject({ code: "BAD_ADDRESS" });
    const open = loopback(web.port, { ports: [web.port, 80] });
    await expect(open.get(at("/inside"), { maxBytes: 10_000 })).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(fetcher.get(at("/away"), { maxBytes: 10_000 })).rejects.toMatchObject({ code: "BAD_ADDRESS" });
  });

  test("refuses a body over its limit, or cuts it there when asked", async () => {
    await expect(fetcher.get(at("/big"), { maxBytes: 1000 })).rejects.toMatchObject({ code: "TOO_LARGE" });
    const cut = await fetcher.get(at("/big"), { maxBytes: 1000, truncate: true });
    expect(cut.body.length).toBe(1000);
    expect(cut.truncated).toBe(true);
  });

  test("stops waiting at its time limit", async () => {
    await expect(fetcher.get(at("/slow"), { maxBytes: 1000, timeoutMs: 150 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("an answer that is not a success is an error", async () => {
    await expect(fetcher.get(at("/nowhere"), { maxBytes: 1000 })).rejects.toMatchObject({ code: "HTTP_404" });
  });
});

describe("pageCard", () => {
  test("Open Graph first, then Twitter, then the page's own title; the head only", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title> Nfelia &amp; Co </title>
      <meta name="twitter:title" content="From Twitter"><meta property="og:title" content="Nfelia: Fashion">
      <meta name="description" content="Shop the latest"><meta property="og:image" content="/img/banner.jpg">
      </head><body><meta property="og:site_name" content="Ignored"></body></html>`;
    expect(pageCard.parseCard(html, "https://www.nfelia.com/shop")).toEqual({
      title: "Nfelia: Fashion",
      description: "Shop the latest",
      site_name: "nfelia.com",
      image_url: "https://www.nfelia.com/img/banner.jpg",
    });
    expect(pageCard.parseCard("<title>Only &quot;this&quot;</title>", "https://x.com/").title).toBe('Only "this"');
  });

  test("a long title is cut, and a picture that is not on the web is dropped", () => {
    const html = `<head><meta property="og:title" content="${"word ".repeat(80)}"><meta property="og:image" content="javascript:x"></head>`;
    const card = pageCard.parseCard(html, "https://x.com/");
    expect(card.title.length).toBeLessThanOrEqual(pageCard.LIMITS.title);
    expect(card.image_url).toBeNull();
  });

  test("decodes a page in its own charset", () => {
    expect(pageCard.decodeHtml(Buffer.from([0x63, 0x61, 0x66, 0xe9]), "text/html; charset=iso-8859-1")).toBe("café");
    expect(pageCard.decodeHtml(Buffer.from('<meta charset="iso-8859-1">caf\xe9', "latin1"))).toContain("café");
    expect(pageCard.decodeHtml(Buffer.from("<title>café</title>"), "text/html")).toContain("café");
  });

  describe("fetched from a page", () => {
    let web;
    let fetcher;
    beforeAll(async () => {
      web = await serve({
        "/": (req, res) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end('<head><meta property="og:title" content="Nfelia"><meta property="og:image" content="/pic.png"></head>');
        },
        "/pic.png": (req, res) => res.writeHead(200, { "Content-Type": "image/png" }).end(PNG),
        "/plain": (req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end("<p>No title here</p>"),
        "/file.pdf": (req, res) => res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4"),
        "/huge-pic": (req, res) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end('<head><title>Big picture</title><meta property="og:image" content="/huge.png"></head>');
        },
        "/huge.png": (req, res) => res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(pageCard.IMAGE_MAX_BYTES + 10)),
      });
      fetcher = loopback(web.port);
    });
    afterAll(() => new Promise((r) => web.server.close(r)));
    const at = (path) => `http://card.test:${web.port}${path}`;

    test("a page with a title and a picture is a ready card", async () => {
      const card = await pageCard.fetchCard(at("/"), { fetcher });
      expect(card).toMatchObject({ status: "ready", title: "Nfelia", site_name: "card.test", description: null });
      expect(card.image.name).toBe("preview.png");
      expect(card.image.buffer.equals(PNG)).toBe(true);
    });

    test("a page with no title is empty, a file is not a page, an unreachable one failed", async () => {
      expect(await pageCard.fetchCard(at("/plain"), { fetcher })).toEqual({ status: "empty" });
      expect(await pageCard.fetchCard(at("/file.pdf"), { fetcher })).toEqual({ status: "failed", reason: "NOT_A_PAGE" });
      expect(await pageCard.fetchCard(at("/gone"), { fetcher })).toEqual({ status: "failed", reason: "HTTP_404" });
      expect(await pageCard.fetchCard("http://10.0.0.1/")).toEqual({ status: "failed", reason: "PRIVATE_ADDRESS" });
    });

    test("a picture over 5 MB leaves the card without one", async () => {
      const card = await pageCard.fetchCard(at("/huge-pic"), { fetcher });
      expect(card).toMatchObject({ status: "ready", title: "Big picture", image: null });
    });
  });
});

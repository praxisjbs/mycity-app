"use strict";
/**
 * The one way the server reads from the open web: a GET to a public address, within limits
 * (docs/guides/community.md §6, link cards). A person types the address, so a request must
 * never become a way into the server's own network (server-side request forgery):
 *
 *  - http and https only, ports 80 and 443 only, no user name or password in the address;
 *  - every address the host name resolves to is checked, and the socket connects to the
 *    checked address itself, so no second look-up can swap in another one: loopback,
 *    private, link-local, shared (carrier-grade NAT), multicast, documentation, benchmarking
 *    and the other reserved ranges are refused, IPv4 and IPv6, IPv4 carried in IPv6 too;
 *  - redirects are followed here, at most 4, each one checked as the first was;
 *  - a body is read to `maxBytes` once decompressed (cut there with `truncate`, else
 *    refused), and the whole chain of requests ends after `timeoutMs`;
 *  - it sends the request line and a few plain headers: no cookie, no credential, a user
 *    agent that says who is asking.
 *
 *   const page = await publicFetch.get("https://nfelia.com/", { accept: "text/html", maxBytes: 1_048_576, truncate: true });
 *   // { url (after redirects), status, type ("text/html"), contentType, body: Buffer, truncated }
 *
 * A refusal or a failure is a PublicFetchError whose `code` is BAD_ADDRESS, PRIVATE_ADDRESS,
 * TOO_MANY_REDIRECTS, TIMEOUT, TOO_LARGE, HTTP_<status> or NETWORK. Tests build their own
 * fetcher with createFetcher({ isAllowed, ports }) to reach a server on the loopback.
 */
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const net = require("node:net");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream");

const USER_AGENT = "Mozilla/5.0 (compatible; MyCityLinkPreview/1.0; +https://mycityapp.io)";
const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 8000;

class PublicFetchError extends Error {
  /** @param {string} code @param {string} [message] */
  constructor(code, message) {
    super(message || code);
    this.name = "PublicFetchError";
    this.code = code;
  }
}

/** Ranges that are not the public internet (IANA special-purpose registries). */
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  BLOCKED.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
])
  BLOCKED.addSubnet(address, prefix, "ipv6");

/**
 * The address to request, or null when it may not be: not http or https, a user name or
 * password in it, or a port not in `ports`. The fragment never travels.
 */
function target(address, ports) {
  let u;
  try {
    u = new URL(String(address));
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!ports.includes(port)) return null;
  u.hash = "";
  return u.toString();
}

/** An IPv6 address in its one written form (lower case, zeros compressed), via the URL parser. */
function canonicalV6(ip) {
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/**
 * True for an address on the public internet; false for anything reserved, or not an
 * address. An IPv4 address written inside IPv6 (::ffff:10.0.0.1) is refused outright: the
 * block list cannot hold that range without catching every IPv4 address with it.
 */
function isPublicAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, "ipv4");
  if (family !== 6) return false;
  const v6 = canonicalV6(ip);
  if (!v6 || /^::ffff:/.test(v6)) return false;
  return !BLOCKED.check(v6, "ipv6");
}

/**
 * A dns.lookup for http.request that answers only when every address of the name is allowed,
 * so the socket connects to an address that was checked.
 */
function checkedLookup(isAllowed, lookup) {
  return (hostname, options, callback) => {
    const opts = typeof options === "function" ? {} : options || {};
    const done = typeof options === "function" ? options : callback;
    lookup(hostname, { all: true, verbatim: true, family: opts.family || 0 }, (err, found) => {
      if (err) return done(new PublicFetchError("NETWORK", `${hostname} did not resolve`));
      const list = (Array.isArray(found) ? found : [{ address: found, family: net.isIP(found) }]).filter(Boolean);
      if (!list.length) return done(new PublicFetchError("NETWORK", `${hostname} did not resolve`));
      if (list.some((a) => !isAllowed(a.address)))
        return done(new PublicFetchError("PRIVATE_ADDRESS", `${hostname} is not on the public internet`));
      if (opts.all) return done(null, list);
      return done(null, list[0].address, list[0].family);
    });
  };
}

/** The response's body, decompressed, to `maxBytes`. */
function readBody(res, { maxBytes, truncate }) {
  const encoding = String(res.headers["content-encoding"] || "identity").trim().toLowerCase();
  const decoders = {
    gzip: zlib.createGunzip,
    "x-gzip": zlib.createGunzip,
    deflate: zlib.createInflate,
    br: zlib.createBrotliDecompress,
  };
  return new Promise((resolve, reject) => {
    let stream = res;
    if (decoders[encoding]) {
      stream = decoders[encoding]();
      pipeline(res, stream, () => undefined);
    } else if (encoding !== "identity") {
      res.destroy();
      reject(new PublicFetchError("NETWORK", `unknown content encoding ${encoding}`));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      res.destroy();
      if (stream !== res) stream.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) {
        chunks.push(chunk);
        return;
      }
      if (!truncate) return finish(new PublicFetchError("TOO_LARGE", `more than ${maxBytes} bytes`));
      chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
      return finish(null, { body: Buffer.concat(chunks), truncated: true });
    });
    stream.on("end", () => finish(null, { body: Buffer.concat(chunks), truncated: false }));
    stream.on("error", (err) =>
      finish(err instanceof PublicFetchError ? err : new PublicFetchError("NETWORK", err.message)),
    );
    res.on("error", (err) =>
      finish(err instanceof PublicFetchError ? err : new PublicFetchError("NETWORK", err.message)),
    );
  });
}

/**
 * A fetcher. `isAllowed` decides which addresses may be reached (isPublicAddress unless a
 * test says otherwise), `ports` which ports (80 and 443); `lookup` is dns.lookup unless a
 * test resolves names itself.
 * @param {{isAllowed?: (address: string) => boolean, ports?: number[], lookup?: typeof dns.lookup}} [deps]
 */
function createFetcher({ isAllowed = isPublicAddress, ports = [80, 443], lookup = dns.lookup } = {}) {
  const resolver = checkedLookup(isAllowed, lookup);

  /** One request, no redirects followed. Resolves the response, its body unread. */
  function request(address, { accept, signal }) {
    const u = new URL(address);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isAllowed(host))
      return Promise.reject(new PublicFetchError("PRIVATE_ADDRESS", `${host} is not on the public internet`));
    const lib = u.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(u, {
        method: "GET",
        agent: false,
        lookup: resolver,
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Language": "en",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });
      req.on("response", resolve);
      req.on("error", (err) => {
        if (err instanceof PublicFetchError) return reject(err);
        if (err.name === "AbortError" || (signal && signal.aborted))
          return reject(new PublicFetchError("TIMEOUT", `${u.host} took too long`));
        return reject(new PublicFetchError("NETWORK", err.message));
      });
      req.end();
    });
  }

  /**
   * GET a public address, following its redirects.
   * @param {string} address
   * @param {{accept?: string, maxBytes: number, truncate?: boolean, timeoutMs?: number}} opts
   */
  async function get(address, { accept = "*/*", maxBytes, truncate = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("publicFetch.get: maxBytes is required");
    let current = target(address, ports);
    if (!current) throw new PublicFetchError("BAD_ADDRESS", "Not an address on the public web");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const res = await request(current, { accept, signal: controller.signal });
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          let next = null;
          try {
            next = target(new URL(String(res.headers.location), current).toString(), ports);
          } catch {
            next = null;
          }
          if (!next) throw new PublicFetchError("BAD_ADDRESS", "A redirect left the public web");
          current = next;
          continue;
        }
        if (status < 200 || status > 299) {
          res.destroy();
          throw new PublicFetchError(`HTTP_${status}`, `The page answered ${status}`);
        }
        const declared = Number(res.headers["content-length"]);
        if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          throw new PublicFetchError("TOO_LARGE", `more than ${maxBytes} bytes`);
        }
        const contentType = String(res.headers["content-type"] || "");
        const { body, truncated } = await readBody(res, { maxBytes, truncate });
        return {
          url: current,
          status,
          type: contentType.split(";")[0].trim().toLowerCase(),
          contentType,
          body,
          truncated,
        };
      }
      throw new PublicFetchError("TOO_MANY_REDIRECTS", `more than ${MAX_REDIRECTS} redirects`);
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof PublicFetchError && err.code !== "NETWORK"))
        throw new PublicFetchError("TIMEOUT", "The page took too long");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return { get };
}

const standard = createFetcher();

module.exports = {
  PublicFetchError,
  USER_AGENT,
  MAX_REDIRECTS,
  isPublicAddress,
  createFetcher,
  get: standard.get,
};

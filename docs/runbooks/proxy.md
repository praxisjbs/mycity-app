# Runbook · Reverse proxy settings

The four virtual hosts are configured in the **hosting panel's** web server settings, not from
files in this repository (decided 12 October 2026). This page is the
list of what those settings must contain. The proxy is deliberately thin: TLS, forwarding,
WebSocket upgrade and the body limit. Everything else (which paths a host answers, the frontend
builds, caching, protected files) is in the API, where it is tested and versioned with the code.

Apply the same settings on staging and production. Check them after any panel change, and before
the first production deploy, with the checks in §5.

---

## 1 · Hosts and upstreams

| Host | Upstream (every path) |
|---|---|
| `hub.mycityapp.io` | `127.0.0.1:7000` |
| `go.mycityapp.io` | `127.0.0.1:7000` |
| `hub.staging.mycityapp.io` | `127.0.0.1:7100` |
| `go.staging.mycityapp.io` | `127.0.0.1:7100` |

TLS on all four (Let's Encrypt), HTTP redirected to HTTPS, HSTS on.

The proxy serves no files and allow-lists no paths. The API process serves both frontend builds
(`app/dist` on `hub.`, `public-app/dist` on `go.`, SPA fallback, cache headers) and refuses a path on
the wrong host itself (`src/http/static.js`, SYSTEM_ARCHITECTURE §3). So the proxy forwards **every**
path on each host to that environment's upstream, and nothing else.

## 2 · What the proxy must do

- **WebSocket upgrade** on `/socket.io/` (`Upgrade`, `Connection: upgrade`), read timeout ≥ 60 s.
- **Keep-alive to the upstream** shorter than 65 s (Node's keep-alive is 65 s), so the proxy never
  reuses a socket Node has just closed.
- **No static root, no `try_files`, no SPA fallback, no caching** at the proxy. Node sets
  `Cache-Control` per file (hashed assets a year, everything else revalidated), and a proxy cache
  would serve an old `index.html` after a release.

## 3 · Uploads

- **Request body limit 30 MB** on all four hosts (`client_max_body_size 30m` in nginx terms). The
  app's own cap is 25 MB (`middleware/upload.js`); the proxy must be larger, or uploads fail live
  with a 413 that never happens locally.
- Protected files (documents, payslips, CVs) are streamed by Node after its permission check. The
  media directory is never a proxy root and must not be reachable by URL.

## 4 · Headers

- Pass `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Request-Id` (if present) to the upstream.
- Do not add CORS headers at the proxy; the app sets them per surface.
- `X-Robots-Tag` and `X-Mycity-Environment` are set by the app, not the proxy.

## 5 · Checks after any change

Run from any machine. Expected results on the right. Every 404 below comes from the API (a JSON
body with `"code": "NOT_FOUND"`), which proves the proxy forwarded the request and Node refused it.

```
curl -sI https://hub.mycityapp.io/api/health               200
curl -s  https://hub.mycityapp.io/api/public/v1/jobs        404 JSON
curl -s  https://go.mycityapp.io/api/v1/auth/me             404 JSON
curl -s  https://go.mycityapp.io/socket.io/                 404 JSON
curl -sI https://hub.mycityapp.io/some/deep/link            200, text/html (index.html), Cache-Control: no-cache
curl -sI https://hub.mycityapp.io/assets/<a built file>     200, Cache-Control: public, max-age=31536000, immutable
curl -sI https://go.mycityapp.io/sw.js                      404 (the public site has no service worker)
curl -s  https://hub.mycityapp.io/api/health/ready          "static": { "staff": true, "public": true }
```

Repeat for the two staging hosts. Then upload a 24 MB file through the staff app on staging: it
must succeed.

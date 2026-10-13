# Runbook · Reverse proxy settings

The four virtual hosts are configured in the **hosting panel's** web server settings, not from
files in this repository (decided 12 October 2026; `ops/nginx/` was removed). This page is the
list of what those settings must contain. The proxy is part of the security design
(SYSTEM_ARCHITECTURE §3, BACKEND_STRUCTURE §5.4), so a host missing one of these is a defect,
not a preference.

Apply the same settings on staging and production. Check them after any panel change, and before
the first production deploy, with the checks in §5.

---

## 1 · Hosts and upstreams

| Host | Static root | API upstream |
|---|---|---|
| `hub.mycityapp.io` | `/srv/mycity/prod/current/app/dist` | `127.0.0.1:7000` |
| `go.mycityapp.io` | `/srv/mycity/prod/current/public-app/dist` | `127.0.0.1:7000` |
| `hub.staging.mycityapp.io` | `/srv/mycity/stg/current/app/dist` | `127.0.0.1:7100` |
| `go.staging.mycityapp.io` | `/srv/mycity/stg/current/public-app/dist` | `127.0.0.1:7100` |

TLS on all four (Let's Encrypt), HTTP redirected to HTTPS, HSTS on.

## 2 · Path allow-list per host

The staff and public surfaces are separated by what each host will proxy at all.

**`hub.` hosts**

| Path | Action |
|---|---|
| `/api/v1/` | Proxy to the upstream |
| `/socket.io/` | Proxy with WebSocket upgrade (`Upgrade`, `Connection: upgrade`), read timeout ≥ 60 s |
| `/api/health` | Proxy |
| `/api/public/` | **404 at the proxy.** Never reaches Node |
| `/media/public/` | Static, allow-listed brand files only |
| everything else | Static from the root, unknown paths fall back to `index.html` (SPA) |

**`go.` hosts**

| Path | Action |
|---|---|
| `/api/public/` | Proxy to the upstream |
| `/api/v1/`, `/socket.io/` | **404 at the proxy.** Never reaches Node |
| `/media/public/` | Static, allow-listed brand files only |
| everything else | Static from the root, SPA fallback. No service worker |

## 3 · Uploads and protected files

- **Request body limit 30 MB** on all four hosts (`client_max_body_size 30m` in nginx terms). The
  app's own cap is 25 MB (`middleware/upload.js`); the proxy must be larger, or uploads fail live
  with a 413 that never happens locally.
- **Protected media through an internal redirect.** Node checks who is asking, then answers with
  an internal-redirect header naming the file; the proxy streams it. The media directory itself
  is never directly reachable:

  ```
  location /_protected/ {
      internal;
      alias /srv/mycity/<prod|stg>/media/;
  }
  ```

  A request for `/_protected/...` or `/media/vault/...` from a browser must be refused.
- **Confirm the panel's web server supports an internal redirect header.** nginx uses
  `X-Accel-Redirect`. If the panel runs a different server, record its equivalent here and in
  BACKEND_STRUCTURE §5.4 before M1 file work starts. Without one, Node streams the file itself:
  it still works, with more load on the API process.

## 4 · Headers

- Pass `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Request-Id` (if present) to the upstream.
- Do not add CORS headers at the proxy; the app sets them per surface.
- `X-Robots-Tag` and `X-Mycity-Environment` are set by the app, not the proxy.

## 5 · Checks after any change

Run from any machine. Expected results on the right.

```
curl -sI https://hub.mycityapp.io/api/health               200
curl -sI https://hub.mycityapp.io/api/public/v1/jobs        404 (from the proxy)
curl -sI https://go.mycityapp.io/api/v1/auth/me             404 (from the proxy)
curl -sI https://go.mycityapp.io/socket.io/                 404 (from the proxy)
curl -sI https://hub.mycityapp.io/_protected/anything       404
curl -sI https://hub.mycityapp.io/some/deep/link            200 (index.html)
```

Repeat for the two staging hosts. Then upload a 24 MB file through the staff app on staging: it
must succeed.

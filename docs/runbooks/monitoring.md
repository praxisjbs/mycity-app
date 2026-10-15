# Runbook · Monitoring

What tells us the system is healthy, and where to look (SYSTEM_ARCHITECTURE §11). One server, two
environments; every check below exists for both, on the environment's own host and port.

---

## 1 · Health endpoints

| Endpoint | Answers | Use |
|---|---|---|
| `GET /api/health` | `200` whenever the API process is up, with the build | Is it running at all |
| `GET /api/health/ready` | `200` with `"status": "ready"` or `"degraded"`, `503` `"unavailable"` when Postgres is down; every check below and the build | Is it fit to serve; deploys and verify-staging gate on it |

Neither needs a token and neither returns anything sensitive. From anywhere:

```
curl -s https://hub.mycityapp.io/api/health/ready | jq '{status, build: .build.sha, checks: (.checks | map_values(.status))}'
```

On the server, without the proxy: `curl -s localhost:7000/api/health/ready` (production) or
`localhost:7100` (staging).

What each check means when it is not `up`:

| Check | Not up means | Look at |
|---|---|---|
| `postgres` | the database does not answer (the only fatal check: 503) | `systemctl status postgresql` |
| `redis` | sessions, jobs and realtime are down | `systemctl status redis-server` |
| `worker` | no worker heartbeat in 90 s: mail, PDFs, notifications wait | `systemctl status mycity-worker-<env>` |
| `modules` | a module failed to load and is not mounted (`skipped` lists it) | `journalctl -u mycity-api-<env>` |
| `migrations` | no ledger or no migrations applied yet | `deploy-gate` log, `docs/runbooks/deploy.md` |
| `numbering` | a document type has no numbering scheme | the module's migration |
| `outbox` | events are piling up (the worker is behind or down) | the worker |
| `storage` | the media folder is missing or not writable | `/srv/mycity/<env>/media` |
| `chromium`, `ffmpeg`, `clamd` | PDFs, voice and video, or upload scanning are unavailable | `ops/provision/provision.sh` installs them; `systemctl status clamav-daemon` |
| `mail` | SMTP is not configured or refuses | `SMTP_*` in the `.env` |
| `static` | a frontend build is missing from the release | the release; `deploy.md` |
| `ai` | which AI vendor answers (Gemini or the stub), from settings only | AI settings |

## 2 · Errors that alert

Every 5xx and every worker failure is written to the `error_event` table and, when
`ALERT_WEBHOOK_URL` is set in the `.env`, posted to it as `{"text": "..."}` (a Slack-style incoming
webhook). 4xx and validation errors are recorded and counted, never alerted. The same fault is
alerted once per five minutes, at most 20 alerts a minute, so the channel stays worth reading.

Set `ALERT_WEBHOOK_URL` in both `.env` files (`sudoedit /srv/mycity/<env>/shared/.env`), then
restart that environment's units. Without it, errors are still recorded and logged.

The latest faults, grouped (once migration 0030 exists):

```
sudo -u postgres psql -d mycity_prod -c "SELECT fingerprint, severity, count(*), max(occurred_at) FROM error_event GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 20"
```

## 3 · Logs

Each unit logs JSON to journald, one line per event, with the request id; personal data is scrubbed
before it is written.

```
journalctl -u mycity-api-prod -f                      # follow
journalctl -u mycity-worker-prod --since "1 hour ago"
journalctl -u mycity-api-prod | grep '"request_id":"<id>"'   # one request, from the id on an error
```

journald keeps at most 2 GB (provisioning sets this). Deploys log to `~mycity-deploy/deploy-gate.log`.

## 4 · Metrics

With `METRICS_TOKEN` set, `GET /api/metrics` returns Prometheus text (request durations, counters,
the outbox backlog); without the token, or with a wrong one, it answers 404. Values are per
process. Provisioning generates a token in each `.env`.

```
curl -s -H "Authorization: Bearer <METRICS_TOKEN>" localhost:7000/api/metrics | head
```

## 5 · Outside checks

The uptime probe (`ops/monitoring/uptime-probe.js`) is M11 and not built. Until then, point any
external uptime monitor at `https://hub.mycityapp.io/api/health/ready` and
`https://go.mycityapp.io/api/health`, alerting on anything but 200.

Also worth a look each week, on the server:

| What | Command | Act when |
|---|---|---|
| Disk | `df -h /` | above 80% (old releases and dumps are pruned; media and logs grow) |
| Certificates | `sudo certbot certificates` | any expiry under 20 days (renewal should have run) |
| Renewal timer | `systemctl list-timers certbot.timer` | it is missing |
| Firewall | `sudo ufw status` | anything open beyond SSH, 80 and 443 |
| Services | `systemctl --failed` | any unit listed |

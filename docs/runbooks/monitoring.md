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

Every 5xx, every job that has used up its retries and every outbox event that has used up its
attempts is written to the `error_event` table and, when `ALERT_WEBHOOK_URL` is set in the `.env`,
posted to it as `{"text": "..."}` (a Slack-style incoming webhook). A validation failure (422) is
recorded with severity `notice`, so form problems can be counted, and never alerts; other 4xx
answers are only logged. The same fault is alerted once per five minutes, at most 20 alerts a
minute, so the channel stays worth reading.

The same webhook carries the backup, restore drill and uptime alerts (§5), so one channel is
the one place to watch. Set `ALERT_WEBHOOK_URL` in both `.env` files (`sudoedit /srv/mycity/<env>/shared/.env`), then
restart that environment's units. Without it, errors are still recorded and logged.

The latest faults, grouped (once migration 0030 exists):

```
sudo -u postgres psql -d mycity_prod -c "SELECT fingerprint, severity, count(*), max(occurred_at) FROM error_event GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 20"
```

## 3 · Logs

Each unit logs JSON to journald, one line per event, with the request id and user id. Sensitive
fields are replaced with `[REDACTED]` by name before a line is written (passwords, tokens, secrets,
bank details, BVN, NIN, salary and MFA fields; `src/config/logger.js` has the list), and a database
error's `detail` is never logged because it quotes the row. A value under any other name is logged
as it is, so never log a whole request body.

```
journalctl -u mycity-api-prod -f                      # follow
journalctl -u mycity-worker-prod --since "1 hour ago"
journalctl -u mycity-api-prod | grep '"request_id":"<id>"'   # one request, from the id on an error
```

journald keeps at most 2 GB (provisioning sets this). Deploys log to `~mycity-deploy/deploy-gate.log`.

## 4 · Metrics

With `METRICS_TOKEN` set, `GET /api/metrics` returns Prometheus text: request durations by route,
sign-in failures by reason, the outbox backlog and failed outbox events, process uptime and heap.
Without the token, or with a wrong one, it answers 404. Values are per
process. Provisioning generates a token in each `.env`.

```
curl -s -H "Authorization: Bearer <METRICS_TOKEN>" localhost:7000/api/metrics | head
```

## 5 · Outside checks

`ops/monitoring/uptime-probe.js` checks production the way a person reaches it: over HTTPS,
through DNS, the firewall, nginx and TLS. `.github/workflows/uptime.yml` runs it from GitHub every
10 minutes; it needs the repository secret `ALERT_WEBHOOK_URL` (`docs/runbooks/github-settings.md`).

| Host | Down when | Listed, not alerted |
|---|---|---|
| `hub.mycityapp.io` | `/api/health/ready` is not 200 with `ok: true`, after three tries 15 s apart | degraded checks (mail, clamd...) |
| `go.mycityapp.io` | `/api/health` is not 200 | |
| both | `X-Mycity-Environment` is not `production` (a DNS or proxy mistake pointing at staging); no answer; TLS refused | |
| both | the certificate has under 14 days left (renewal runs at 30): alerted once a day | |

It alerts when a host goes down, every hour while it stays down, and once when it recovers. Run it
yourself from any machine with Node 20:

```
node ops/monitoring/uptime-probe.js                  # production
node ops/monitoring/uptime-probe.js --with-staging   # and staging
```

GitHub may start a scheduled run some minutes late. For a faster first line, point a free
external uptime service at `https://hub.mycityapp.io/api/health/ready` as well; the probe still
gives the environment and certificate checks it does not.

The server alerts on its own too: the nightly backup and the weekly restore drill post to
production's `ALERT_WEBHOOK_URL` when they fail (`docs/runbooks/backup-restore.md`).

Also worth a look each week, on the server:

| What | Command | Act when |
|---|---|---|
| Disk | `df -h /` | above 80% (old releases and dumps are pruned; media and logs grow) |
| Certificates | `sudo certbot certificates` | any expiry under 20 days (renewal should have run) |
| Renewal timer | `systemctl list-timers certbot.timer` | it is missing |
| Firewall | `sudo ufw status` | anything open beyond SSH, 80 and 443 |
| Services | `systemctl --failed` | any unit listed (a failed `mycity-backup` or `mycity-restore-drill` too) |
| Backups | `systemctl list-timers 'mycity-*'`; `sudo jq '{ok, finished_at}' /srv/mycity/backups/last-run.json` | a timer missing, or the last run not ok |

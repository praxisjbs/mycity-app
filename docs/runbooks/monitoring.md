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
| `mail` | SMTP is not configured or refuses. When up it shows `sent_last_hour` of `per_hour`: at the limit, system mail waits for a slot (it is not lost) | Settings · Integrations, System Sender (else `SMTP_*` and `MAIL_SEND_PER_HOUR` in the `.env`); `docs/runbooks/dns-and-mail.md` §4 |
| `mail_server` | The staff mail server's newest check failed: not found, no answer, or its TLS or certificate refused. Read from the stored state, never a live call | Settings · Integrations, Staff Mail Server: Test and its Checks; `docs/runbooks/dns-and-mail.md` §4 |
| `maps` | Geoapify's newest test or call failed (key refused, over the day's quota), or its saved key cannot be read. Not set up when there is no key: address fields then take a typed address | Settings · Integrations, Geoapify: Test, Use and Checks |
| `static` | a frontend build is missing from the release | the release; `deploy.md` |
| `ai` | which AI vendor answers (Gemini or the stub), from settings only; degraded while Gemini's newest test or call failed (key refused, over quota, no model it needs on the key) | AI settings; Settings · Integrations, Gemini: Test, its Models and Checks |
| `groq`, `openai`, `anthropic`, `deepseek` | That provider's newest test or call failed, or its saved key cannot be read. Not set up when there is no key. A failing Groq sends voice notes to Gemini, then to the browser's captions | Settings · Integrations, the provider: Test, Models and Checks (`docs/guides/integrations.md` §6.11, §6.14) |
| `exchange_rates` | The newest rate fetch failed, or the newest table is more than 36 hours old: naira prices use the last rate | Settings · Integrations, Exchange Rates: Sync Rates and its Checks; the `exchange-rates` job on Background Jobs |
| `web_push` | The newest test or push failed (the pair does not sign, a push service refused) | Settings · Integrations, Web Push; `docs/runbooks/push-notifications.md` |

## 2 · Errors that alert

Every 5xx, every job that has used up its retries and every outbox event that has used up its
attempts is written to the `error_event` table and sent to the alert channels. A validation
failure (422) is recorded with severity `notice`, so form problems can be counted, and never
alerts; other 4xx answers are only logged. The same fault is alerted once per five minutes, at most
20 alerts a minute, so the channel stays worth reading. The nightly backup, the restore drill and
the uptime probe (§5) alert through the same channels, so there is one place to watch.

**The channels** (`src/shared/observability/alert.js`), either or both:

| Setting | What it holds |
|---|---|
| `ALERT_WHATSAPP_URLS` | One WhatsApp link per person, separated by spaces. Each is a gateway's send link with `{text}` where the message goes. The team uses this one |
| `ALERT_WEBHOOK_URL` | A Slack or Google Chat incoming webhook, if the team ever moves to one |

WhatsApp has no webhook for groups, so each person gets the alerts in their own WhatsApp, from the
gateway's number. A message is cut to 900 characters, and at most 5 go to a person in 10 minutes
from one process, so a burst of faults cannot get the free gateway to block the number. The links
carry API keys: they are secrets, and nothing ever prints them.

**Set up WhatsApp, once per person** (GE, TB, whoever should be woken), with CallMeBot (free, for
personal use):

1. Check the bot's current number on callmebot.com (WhatsApp section; it changes), save it as a
   contact, and send it on WhatsApp: `I allow callmebot to send me messages`.
2. It replies with an API key. (If it says it is full, or nothing comes within 2 minutes and again
   after 24 hours, use TextMeBot instead, about USD 1 a month per person: its link is
   `https://api.textmebot.com/send.php?recipient=+234...&apikey=<key>&text={text}`.)
3. Your link, with your number in international form and no spaces:
   `https://api.callmebot.com/whatsapp.php?phone=+2348031234567&apikey=<key>&text={text}`
4. Test it from your own computer (PowerShell), with `hello` in place of `{text}`:
   `Invoke-RestMethod "https://api.callmebot.com/whatsapp.php?phone=+2348031234567&apikey=<key>&text=hello"`

**Put the links where they are read:**

- On the server, `sudoedit /srv/mycity/prod/shared/.env` and set
  `ALERT_WHATSAPP_URLS=<GE's link> <TB's link>` (one line, a space between links, no quotes). The
  `.env` files written before this setting existed have no such line: add it. Staging too if you
  want its errors (`/srv/mycity/stg/shared/.env`). The backup and the drill read the file each run;
  the API and the worker read it when they start, so restart them once the app is running:
  `sudo systemctl restart mycity-api-prod mycity-worker-prod`.
- In GitHub, the repository secret `ALERT_WHATSAPP_URLS` with the same value, for the uptime probe
  (`docs/runbooks/github-settings.md`).

Test from the server, without breaking anything:

```
sudo node /srv/mycity/bin/mycity-alert --settings=/srv/mycity/prod/shared/.env "MyCity alert test"
```

It prints `alert sent to 2 channel(s)` (one per link) and the message arrives. Without any channel
set, errors are still recorded and logged.

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
10 minutes; it alerts through the repository secret `ALERT_WHATSAPP_URLS` (§2,
`docs/runbooks/github-settings.md`).

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
production's alert channels (§2) when they fail (`docs/runbooks/backup-restore.md`).

**Praxis AI's nightly attack run** (`.github/workflows/ai-nightly.yml`, 02:17 Lagos) asks the attack
questions of `scripts/ai/attack-assistant.js` of the real model on staging, as a real person of each
role, through `deploy-gate attack` (`docs/guides/praxis-ai.md` §6.17). A leak fails the run loudly,
with each leak in the job summary, and is an urgent notice in the hub to whoever may change AI
Control; AI Control · Spend shows the last run either way (Passed, Leaked, Could Not Run). A run
that could not run (no provider set up on staging, nobody holding a role) is a warning, not a
failure. Run it by hand on the server as the staging user from the current release:
`node --env-file=/srv/mycity/stg/shared/.env scripts/ai/attack-assistant.js` (refused on production).

Also worth a look each week, on the server:

| What | Command | Act when |
|---|---|---|
| Disk | `df -h /` | above 80% (old releases and dumps are pruned; media and logs grow) |
| Certificates | `sudo certbot certificates` | any expiry under 20 days (renewal should have run) |
| Renewal timer | `systemctl list-timers certbot.timer` | it is missing |
| Firewall | `sudo ufw status` | anything open beyond SSH, 80 and 443 |
| Services | `systemctl --failed` | any unit listed (a failed `mycity-backup` or `mycity-restore-drill` too) |
| Backups | `systemctl list-timers 'mycity-*'`; `sudo jq '{ok, finished_at}' /srv/mycity/backups/last-run.json` | a timer missing, or the last run not ok |

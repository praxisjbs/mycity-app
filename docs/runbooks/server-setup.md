# Runbook · Server setup

One server carries production and staging (SYSTEM_ARCHITECTURE §1): **108.181.196.53**, Ubuntu
24.04, 18 GB RAM, 240 GB SSD. `ops/provision/provision.sh` takes it from a fresh install to a
server ready for its first deploy. It is safe to run again, and running it again is how a later
change to `ops/` reaches the server.

---

## 1 · DNS

Four A records, all to the same address. The script gets each host's certificate only once its
record resolves to this server, so do this first; a host that is not ready is listed at the end
of the run and picked up on the next one.

| Name | Type | Value |
|---|---|---|
| `hub.mycityapp.io` | A | `108.181.196.53` |
| `go.mycityapp.io` | A | `108.181.196.53` |
| `hub.staging.mycityapp.io` | A | `108.181.196.53` |
| `go.staging.mycityapp.io` | A | `108.181.196.53` |

Check from any machine: `nslookup hub.staging.mycityapp.io` gives the address above.

## 2 · Run it

As a user with sudo, on the server:

```
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/tomblakeasaah196/mycity-app.git ~/mycity-app
cd ~/mycity-app
sudo LE_EMAIL=<the address Let's Encrypt writes to> bash ops/provision/provision.sh
```

If the repository is private, clone with a GitHub token (`https://<token>@github.com/...`) or
copy the checkout up with `scp`; the script only needs the files.

It prints twelve steps and ends with **Still to do**, the list of what it could not finish (DNS
not ready, mail not filled in, no deploy keys yet). Fix those and run the same command again.

| Setting | When |
|---|---|
| `LE_EMAIL` | Always. Without it TLS is skipped |
| `MYCITY_PUBLIC_IP` | Only if the address it detects is wrong (it is printed in step 12) |
| `STAGING_DEPLOY_KEY`, `PROD_DEPLOY_KEY` | When `release.yml` is set up: the public halves of the two keys CI deploys with. Both, or neither |

## 3 · What it does

| Step | Result |
|---|---|
| Base | Updates, `ufw`, `fail2ban`, unattended security upgrades, 4 GB swap if none, journald capped at 2 GB |
| Node | Node 20 (at least 20.19, `package.json` engines) from NodeSource |
| Packages | PostgreSQL 16 + pgvector, Redis 7, ffmpeg, ClamAV (signatures fetched first), nginx, certbot, fonts; Geist from `assets/fonts` when it is there |
| Chrome | `google-chrome-stable` for PDFs (`CHROMIUM_PATH`). Ubuntu's own Chromium is a snap, which cannot run as a service user under `/srv` |
| Users | `mycity-prod`, `mycity-stg` run the services and cannot read each other's files; `mycity-deploy` is CI's only login |
| Files | `/srv/mycity/<prod\|stg>/{releases, shared/.env, media}`, `/srv/mycity/bin`, `/srv/mycity/backups/<env>` (BACKEND_STRUCTURE §1). The environment folder belongs to `mycity-deploy` (it switches `current`); `shared/` stays root's |
| PostgreSQL | `mycity_prod` owned by `mycity_prod_app`, `mycity_stg` by `mycity_stg_app`; only that role may connect; pgcrypto, citext, pg_trgm, unaccent and vector created by the superuser (pgvector is not a trusted extension, so the app role could not); memory sized from the RAM |
| Redis | Local only, password, `noeviction` (BullMQ loses jobs otherwise), append-only file; db 0 production, db 1 staging |
| `.env` | `/srv/mycity/<env>/shared/.env` from `ops/systemd/<env>.env.template`, secrets generated on the server. **Written once, never overwritten** |
| systemd | The four units, enabled. Each is skipped until its environment has a release, so nothing crash-loops before the first deploy |
| Deploy | `sudo` for `mycity-deploy` limited to restarting the four units and running Node as an environment's user; `authorized_keys` with forced commands when the keys are given; `deploy-gate` installed into `/srv/mycity/bin` |
| Backups | `mycity-backup` and `mycity-restore-drill` installed into `/srv/mycity/bin`; their timers started (nightly 02:30, Sundays 04:00, Lagos); `/etc/mycity/backup.env` written once for the offsite copy (`docs/runbooks/backup-restore.md`) |
| Firewall | SSH (whatever port `sshd` uses), 80 and 443 only |
| nginx | `ops/nginx/` installed, the default site removed, a certificate per host whose DNS is ready, renewals reload nginx |

## 4 · After the first run

1. **Set mail and the keys on Settings · Integrations**, on each environment, once the app is up
   (`docs/guides/integrations.md`; `docs/runbooks/dns-and-mail.md` §4 has the values): the System
   Sender, the Staff Mail Server when its hosts differ from the defaults, Geoapify's key, Gemini's
   (none uses the stub), Groq's (voice notes, Free plan), Exchange Rates' (the daily rates) and, when
   they are used, OpenAI's, Anthropic's and DeepSeek's, each with its plan and its share of the daily
   limit (staging and production share the keys, `docs/guides/integrations.md` §1.2 decision 5). Until a sender is set, system mail is held, not lost. The `.env`
   lines (`SMTP_*`, `MAIL_SEND_PER_HOUR`, `GEOAPIFY_API_KEY`, `GEMINI_API_KEY`) still work as the
   fallback, and a server starts without them.
2. **Copy `/root/mycity-secrets/` somewhere safe**, off the server. It holds the database
   passwords and the two `ENCRYPTION_KEY`s; a lost encryption key loses every value encrypted
   with it (mailbox passwords, integration secrets).
3. If it says a reboot is wanted: `sudo reboot`. Everything comes back on its own.
4. **Set up the offsite backup copy**: `docs/runbooks/backup-restore.md` §2.
5. Check: `systemctl status postgresql redis-server clamav-daemon nginx` all active;
   `systemctl list-timers 'mycity-*'` lists the backup, the drill and the two health watches;
   `sudo ufw status` shows only SSH, 80 and 443; `curl -sI http://hub.staging.mycityapp.io`
   gives a 301 to https.

The deploy keys and the first release: `docs/runbooks/deploy.md`. Until the first release the
units stay skipped and the hosts answer 502 over https.

## 5 · Changing the server later

Change the file under `ops/`, merge it, pull on the server and run the script again. Do not edit
`/etc/nginx`, the units or `/etc/redis/mycity.conf` by hand: the next run puts the repository's
version back. The two `.env` files are the exception: they are only ever edited on the server.

# Runbook · Deploy

How code reaches staging and production (SYSTEM_ARCHITECTURE §9). Merging to `main` is the only
way in: `.github/workflows/release.yml` builds, deploys to staging, verifies, seals, and then waits
for a person before production. Nobody deploys by hand, and CI has no shell on the server: every
connection is forced into `scripts/deploy/deploy-gate`.

---

## 1 · One-time setup

Do this once, after the server is provisioned (`docs/runbooks/server-setup.md`).

**1. Two deploy keys**, made on any machine. They have no passphrase because CI uses them.

```
ssh-keygen -t ed25519 -N "" -C "mycity staging deploy" -f mycity-staging-deploy
ssh-keygen -t ed25519 -N "" -C "mycity production deploy" -f mycity-prod-deploy
```

**2. Their public halves on the server.** Copy the two `.pub` files and the latest `ops/` and
`scripts/` up (the script installs `scripts/deploy/deploy-gate`, the backup tools and the alert sender from there), then
run the provisioning script again with them. It writes `~mycity-deploy/.ssh/authorized_keys` from
`ops/ssh/authorized_keys.template`, forcing each key into deploy-gate with its own `--key=`:

```
sudo STAGING_DEPLOY_KEY="$(cat mycity-staging-deploy.pub)" \
     PROD_DEPLOY_KEY="$(cat mycity-prod-deploy.pub)" \
     LE_EMAIL=mycityapp09@gmail.com bash ~/ops/provision/provision.sh
```

That run also installs `deploy-gate`, `mycity-backup`, `mycity-restore-drill` and `mycity-alert` into
`/srv/mycity/bin` and starts the backup timers.

**3. GitHub** (repository Settings; TB or GE):

| Where                    | Name                     | Value                                                                        |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------- |
| Environment `staging`    | secret `STAGING_SSH_KEY` | the whole private file `mycity-staging-deploy`                               |
| Environment `staging`    | deployment branches      | `main` only                                                                  |
| Environment `production` | secret `PROD_SSH_KEY`    | the whole private file `mycity-prod-deploy`                                  |
| Environment `production` | required reviewers       | GE and TB; **prevent self-review** on                                        |
| Environment `production` | deployment branches      | `main` only                                                                  |
| Repository variables     | `DEPLOY_HOST`            | `108.181.196.53`                                                             |
| Repository variables     | `DEPLOY_KNOWN_HOSTS`     | the output of `ssh-keyscan -t ed25519 108.181.196.53`                        |
| Repository secret        | `ALERT_WHATSAPP_URLS`    | the WhatsApp alert links (`monitoring.md` §2), for the uptime probe (`uptime.yml`); not needed to deploy |

**4. Delete the two private files** from wherever they were made. GitHub has the only copies; a
lost key is replaced by making a new pair and repeating steps 2 and 3.

Staging must answer over HTTPS (DNS and certificates done) and both `.env` files must have mail
settings before the first release can pass: the migrations run with the server's full
configuration, which refuses to start without SMTP.

## 2 · What a release does

| Job               | What happens                                                                                                                                                                                                                                                                                                                                                       | Stops when                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build             | `npm ci`, both frontends built, `release-manifest.js` packs the release with `RELEASE`, `BUILD.env` and `SHA256SUMS`                                                                                                                                                                                                                                               | anything fails to build                                                                                                                                                             |
| Deploy to staging | `deploy-gate stage <sha>`, tarball over SSH: checked against `SHA256SUMS`, `npm ci --omit=dev`, every dependency confirmed installed, `pg_dump` of `mycity_stg`, migrations (refused before anything applies when the database says it is another environment; the first marks it staging), `current` switched, units restarted, readiness must report this sha                                                                                                                   | the tarball is from another commit or altered; install fails; a migration fails (code not switched); the new build does not come up (staging switched back to the previous release) |
| Verify staging    | `verify-staging.js` over HTTPS: readiness on this sha, no module skipped, migrations at head, both frontends, each host refusing the other's API, staging markers, HTTPS redirect and HSTS. Then `deploy-gate seal` writes `STAGING_VERIFIED` (the tree's hash)                                                                                                    | any check fails: no seal, so nothing can be promoted                                                                                                                                |
| Production        | **started by hand by an approver** (GE, TB or `praxisjbs`; see below). Then `deploy-gate promote`: seal present, under 7 days old, staging still on this sha, tree hash unchanged, not 21 December to 5 January; `pg_dump` of `mycity_prod`; the sealed tree hard-linked into production; migrations (the same environment check; the first marks it production); switch; restart; readiness on this sha; tag `release-<date>-<sha>` | any of those checks; a production build that does not come up is switched back to the previous release                                                                              |

Before releasing: open `https://hub.staging.mycityapp.io`, check the top bar shows the release's
short sha, and walk the demo script for what this release touches (SYSTEM_ARCHITECTURE §9.8).

**Staging's demonstration data** (SYSTEM_ARCHITECTURE §5) is loaded by hand, once the first release
is live, from the server:

```
cd /srv/mycity/stg/current
sudo -u mycity-stg /usr/bin/node --env-file=/srv/mycity/stg/shared/.env scripts/db/seed.js --staging
```

It is the deploy's own way of running a script: the release, the environment's user, its `.env`.
Running it again adds nothing. It refuses unless the database is `mycity_stg` and says it is
staging (`system_marker`, written by the first deploy's migrations), so it cannot reach production,
which is never seeded. To see whether it has run: `sudo -u postgres psql -d mycity_stg -c "SELECT
count(*) FROM okr_key_result"` is 0 before it.

**To release** (interim while the repository is private, SYSTEM_ARCHITECTURE §9.3): the automatic
run stops after the seal, and its summary shows the sealed sha. GitHub → Actions → **Release** →
Run workflow, branch `main`, paste that full 40-character sha. The `approver` job refuses anyone
but GE (`@swizfcodes`), TB (`@tomblakeasaah196`) or the `praxisjbs` account, a run from another
branch, and a short sha;
`deploy-gate promote` refuses a sha staging does not run or never sealed. Say in the team chat
what was checked, since GitHub has no approval comment to hold it.

## 3 · On the server

| Path                                              | What                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `/srv/mycity/<stg\|prod>/releases/<sha>`          | a release; the last 5 are kept per environment                   |
| `/srv/mycity/<env>/current`                       | the running release (a link)                                     |
| `/srv/mycity/stg/releases/<sha>/STAGING_VERIFIED` | the seal                                                         |
| `/srv/mycity/backups/<env>/predeploy-*.dump`      | the dump taken before each deploy's migrations; the last 10 kept |
| `~mycity-deploy/deploy-gate.log`                  | every command deploy-gate ran and what it refused                |

`/srv/mycity/<env>` belongs to `mycity-deploy` (it switches `current`); `shared/.env` stays
root's, readable only by the environment's group. Each release is readable by everyone who can
reach it, and only that environment's group can reach it; production reads the staging-verified
files through hard links.

Where things stand, from the server: `sudo -u mycity-deploy env SSH_ORIGINAL_COMMAND=status /srv/mycity/bin/deploy-gate --key=staging`.

## 4 · How it was tested

In a cloud container laid out like the server (the provisioning script's users, groups, modes and
sudoers rule; real Postgres and Redis; services started as `mycity-stg` and `mycity-prod`), with a
real release built from the repository: stage, seal and promote end to end; a tampered tarball, a
tarball for another commit, a promote after staging moved on, a tree changed after sealing, the
freeze window, a rollback, and a release that does not boot (switched back automatically). Two
faults found that way are fixed: the environment folder must belong to `mycity-deploy`, and npm can
crash yet exit 0, so the install is checked. `tests/unit/foundation/deploy.test.js` keeps the
refusals, the manifest and verify-staging's judgement under test.

Not yet run: a release from GitHub Actions to the real server (needs DNS, mail settings and §1).

## 5 · The server's deploy-gate is out of date

A release never carries `scripts/deploy`, so no deploy can replace `/srv/mycity/bin/deploy-gate`.
That is the point of it: the gate is the one command CI may run on the server, and a release that
could rewrite it could drop the checksum, the seal and the freeze with it. The cost is that a change
to the gate in the repository reaches the server only when a person installs it.

So every deploy asks first. Before `stage` and before `promote`, `release.yml` runs `status`, which
prints the gate's own `sha256`, and `scripts/deploy/check-gate.js` compares it with the copy in the
commit being deployed. A gate older than that line prints no fingerprint and counts as out of date.
On a mismatch the job fails before anything on the server is touched, and its summary lists the
steps below with that commit's exact download link and the hash to expect.

On the server, as `administrator`:

```sh
# 1. This commit's gate (a GitHub token with read access to the repository's contents)
curl -fsSL -H "Authorization: Bearer <your-token>" \
  -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/praxisjbs/mycity-app/contents/scripts/deploy/deploy-gate?ref=<sha>" \
  -o ~/deploy-gate
#    or, from a computer with the repository at that commit:
#    scp scripts/deploy/deploy-gate administrator@108.181.196.53:~/deploy-gate

# 2. It must print the hash the job summary gives
sha256sum ~/deploy-gate

# 3. Install it
sudo install -m 755 -o root -g root ~/deploy-gate /srv/mycity/bin/deploy-gate
rm ~/deploy-gate
```

Then re-run the failed job (Actions, the run, *Re-run failed jobs*). Re-running
`ops/provision/provision.sh` from a full checkout installs it too.

The gate serves both environments, so one install covers staging and production. Whatever the
new gate adds that the old one skipped (the staff roster step, for one) happens on the re-run.

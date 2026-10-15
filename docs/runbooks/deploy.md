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

**2. Their public halves on the server.** Copy the two `.pub` files and the latest `ops/` up, then
run the provisioning script again with them. It writes `~mycity-deploy/.ssh/authorized_keys` from
`ops/ssh/authorized_keys.template`, forcing each key into deploy-gate with its own `--key=`:

```
sudo STAGING_DEPLOY_KEY="$(cat mycity-staging-deploy.pub)" \
     PROD_DEPLOY_KEY="$(cat mycity-prod-deploy.pub)" \
     LE_EMAIL=mycityapp09@gmail.com bash ~/ops/provision/provision.sh
```

That run also installs `deploy-gate` into `/srv/mycity/bin`.

**3. GitHub** (repository Settings; TB or GE):

| Where | Name | Value |
|---|---|---|
| Environment `staging` | secret `STAGING_SSH_KEY` | the whole private file `mycity-staging-deploy` |
| Environment `staging` | deployment branches | `main` only |
| Environment `production` | secret `PROD_SSH_KEY` | the whole private file `mycity-prod-deploy` |
| Environment `production` | required reviewers | GE and TB; **prevent self-review** on |
| Environment `production` | deployment branches | `main` only |
| Repository variables | `DEPLOY_HOST` | `108.181.196.53` |
| Repository variables | `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan -t ed25519 108.181.196.53` |

**4. Delete the two private files** from wherever they were made. GitHub has the only copies; a
lost key is replaced by making a new pair and repeating steps 2 and 3.

Staging must answer over HTTPS (DNS and certificates done) and both `.env` files must have mail
settings before the first release can pass: the migrations run with the server's full
configuration, which refuses to start without SMTP.

## 2 · What a release does

| Job | What happens | Stops when |
|---|---|---|
| Build | `npm ci`, both frontends built, `release-manifest.js` packs the release with `RELEASE`, `BUILD.env` and `SHA256SUMS` | anything fails to build |
| Deploy to staging | `deploy-gate stage <sha>`, tarball over SSH: checked against `SHA256SUMS`, `npm ci --omit=dev`, every dependency confirmed installed, `pg_dump` of `mycity_stg`, migrations, `current` switched, units restarted, readiness must report this sha | the tarball is from another commit or altered; install fails; a migration fails (code not switched); the new build does not come up (staging switched back to the previous release) |
| Verify staging | `verify-staging.js` over HTTPS: readiness on this sha, no module skipped, migrations at head, both frontends, each host refusing the other's API, staging markers, HTTPS redirect and HSTS. Then `deploy-gate seal` writes `STAGING_VERIFIED` (the tree's hash) | any check fails: no seal, so nothing can be promoted |
| Production | **waits for an approver** (GE or TB, not the person who merged). Then `deploy-gate promote`: seal present, under 7 days old, staging still on this sha, tree hash unchanged, not 21 December to 5 January; `pg_dump` of `mycity_prod`; the sealed tree hard-linked into production; migrations; switch; restart; readiness on this sha; tag `release-<date>-<sha>` | any of those checks; a production build that does not come up is switched back to the previous release |

Before approving: open `https://hub.staging.mycityapp.io`, check the top bar shows the release's
short sha, walk the demo script for what this release touches, and approve with a comment naming
what was checked (SYSTEM_ARCHITECTURE §9.8).

## 3 · On the server

| Path | What |
|---|---|
| `/srv/mycity/<stg\|prod>/releases/<sha>` | a release; the last 5 are kept per environment |
| `/srv/mycity/<env>/current` | the running release (a link) |
| `/srv/mycity/stg/releases/<sha>/STAGING_VERIFIED` | the seal |
| `/srv/mycity/backups/<env>/predeploy-*.dump` | the dump taken before each deploy's migrations; the last 10 kept |
| `~mycity-deploy/deploy-gate.log` | every command deploy-gate ran and what it refused |

`/srv/mycity/<env>` belongs to `mycity-deploy` (it switches `current`); `shared/.env` stays
root's, readable only by the environment's group. Each release is readable by everyone who can
reach it, and only that environment's group can reach it; production reads the staging-verified
files through hard links.

Where things stand, from the server: `sudo -u mycity-deploy env SSH_ORIGINAL_COMMAND=status
/srv/mycity/bin/deploy-gate --key=staging`.

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

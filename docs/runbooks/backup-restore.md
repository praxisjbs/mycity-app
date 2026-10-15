# Runbook · Backup and restore

What is backed up, how to restore it, and how to prove a restore works (SYSTEM_ARCHITECTURE §11,
MILESTONES §16: restore rehearsed before M11).

---

## 1 · What exists today

| What | When | Where | Kept |
|---|---|---|---|
| Pre-deploy dump of the environment's database | every staging deploy and every production promote, before migrations (`deploy-gate`) | `/srv/mycity/backups/<env>/predeploy-<time>-<sha>.dump` | last 10 per environment |
| Secrets (database passwords, encryption keys) | once, at provisioning | `/root/mycity-secrets/` | copy kept off the server by the operator |

**Not built yet:** the nightly dump of both databases (14 kept), the nightly copy of the media
folders, and the restore drill (`scripts/db/backup.sh`, `scripts/db/restore-drill.js`, both still
empty). Until they exist, take a manual backup (§2) before anything risky, and copy one off the
server each week.

Everything lives on one server, so a backup only counts once a copy is somewhere else.

## 2 · Take a backup by hand

On the server. The database, as the deploy user, which can read the `.env`:

```
sudo -u mycity-deploy bash -c 'set -a; . <(grep "^DB_" /srv/mycity/prod/shared/.env); \
  PGPASSWORD=$DB_PASSWORD pg_dump --format=custom --no-owner -h $DB_HOST -U $DB_USER \
  -f /srv/mycity/backups/prod/manual-$(date -u +%Y%m%dT%H%M%SZ).dump $DB_NAME'
```

The media (documents, photos, generated PDFs):

```
sudo tar czf ~/media-prod-$(date -u +%Y%m%d).tgz -C /srv/mycity/prod media
```

Copy both off the server, from your own computer:

```
ssh administrator@108.181.196.53 "sudo cp /srv/mycity/backups/prod/manual-*.dump ~/ && sudo chown administrator: ~/manual-*.dump"
scp administrator@108.181.196.53:~/manual-*.dump administrator@108.181.196.53:~/media-prod-*.tgz .
```

Then remove the copies from the home folder on the server. Staging is the same with `stg`.

## 3 · Prove a dump restores (the drill)

Restore into a scratch database, look at it, drop it. Production is not touched.

```
DUMP=/srv/mycity/backups/prod/<the dump>.dump
sudo -u postgres createdb mycity_restore_check
for x in pgcrypto citext pg_trgm unaccent vector; do
  sudo -u postgres psql -q -d mycity_restore_check -c "CREATE EXTENSION IF NOT EXISTS $x"
done
sudo cat "$DUMP" | sudo -u postgres pg_restore --no-owner -d mycity_restore_check
sudo -u postgres psql -d mycity_restore_check -c "SELECT name, applied_at FROM schema_migration ORDER BY applied_at DESC LIMIT 3"
sudo -u postgres psql -d mycity_restore_check -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 2 DESC LIMIT 10"
sudo -u postgres dropdb mycity_restore_check
```

It passes when the migration head and the row counts of the largest tables match the same
queries run against production (`-d mycity_prod`). Record the date and the
result in `docs/PROGRESS.md` (M0 item, then M11).

## 4 · Restore for real

The database of one environment, from a dump (anything written after the dump is lost; tell MyCity
first):

1. `sudo systemctl stop mycity-api-prod mycity-worker-prod`
2. Restore as in `docs/runbooks/rollback.md` §2 (`pg_restore --clean --if-exists --no-owner`).
3. `sudo systemctl start mycity-api-prod mycity-worker-prod`; check `/api/health/ready`.

The media, from a copy:

```
sudo tar xzf media-prod-<date>.tgz -C /srv/mycity/prod
sudo chown -R mycity-prod:mycity-prod /srv/mycity/prod/media
```

A whole new server: provision it (`docs/runbooks/server-setup.md`), put the old `.env` files and
`/root/mycity-secrets/` back **before** the first deploy (the encryption keys must match the data),
restore the databases and the media, then deploy (`docs/runbooks/deploy.md`).

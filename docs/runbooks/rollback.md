# Runbook · Rollback

Production goes back to a release that is still on the server (the last five are kept), after the
same approval as a release (SYSTEM_ARCHITECTURE §9.7). Staging is never rolled back: merge a fix,
or a revert, and it deploys.

---

## 1 · Code

1. Find the sha to go back to: the previous `release-*` tag in GitHub, or `status` on the server
   (`docs/runbooks/deploy.md` §3).
2. GitHub → Actions → **Rollback** → Run workflow, paste the full 40-character sha.
3. An approver approves the `production` environment, as for a release.
4. `scripts/deploy/rollback.sh` asks deploy-gate to switch `prod/current` and restart; readiness
   must report the old sha, or it switches back.

## 2 · The database, only if the release being left migrated

Code goes back; the schema does not. Migrations are written expand then contract, so the previous
code normally runs on the newer schema and nothing else is needed. If it cannot:

1. Stop production writes: `sudo systemctl stop mycity-api-prod mycity-worker-prod`.
2. Restore the dump taken just before that release's migrations (newest in
   `/srv/mycity/backups/prod/`, named with the release's sha):
   ```
   sudo -u mycity-deploy bash -c 'set -a; . <(grep "^DB_" /srv/mycity/prod/shared/.env); \
     PGPASSWORD=$DB_PASSWORD pg_restore --clean --if-exists --no-owner \
     -h $DB_HOST -U $DB_USER -d $DB_NAME /srv/mycity/backups/prod/predeploy-<time>-<sha>.dump'
   ```
3. `sudo systemctl start mycity-api-prod mycity-worker-prod`, then check `/api/health/ready`.

Anything written between that release and the restore is lost, so say so to MyCity before step 2.

## 3 · Hotfix

No separate lane: the fix is a PR, CI, merge, staging, seal and approval like any release. It is
faster only because the approvers act at once.

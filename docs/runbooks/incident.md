# Runbook · Incident

Something is wrong in production. Work down this page; most problems are found in the first two
steps. Monitoring and what each check means: `docs/runbooks/monitoring.md`.

---

## 1 · The first five minutes

1. **Is it up?** `curl -s https://hub.mycityapp.io/api/health/ready | jq '{status, checks: (.checks | map_values(.status))}'`
   - no answer or 502: the API process is down, go to §2 "502".
   - `unavailable` (503): Postgres is down, §2 "Database".
   - `degraded`: read which check is not `up`, then §2.
2. **What changed?** The last release (`deploy-gate` log, GitHub Actions), a setting, an `.env`
   edit, a certificate renewal. If a release went out just before, roll it back first and
   investigate after (`docs/runbooks/rollback.md`).
3. **Tell MyCity** in one line what is affected and that it is being worked on.

On the server, the state of everything at once:

```
systemctl --no-pager status mycity-api-prod mycity-worker-prod postgresql redis-server nginx clamav-daemon | grep -E "●|Active"
```

## 2 · By symptom

| Symptom | Likely cause | Do |
|---|---|---|
| **502** from nginx | API unit stopped or crashing | `journalctl -u mycity-api-prod -n 100`; the last lines say why. Config error after an `.env` edit: fix the `.env`, `sudo systemctl restart mycity-api-prod`. Crash after a release: roll back |
| **Database** (503) | Postgres stopped, disk full | `sudo systemctl status postgresql`; `df -h /`; `sudo systemctl start postgresql` |
| Signed-in users thrown out, jobs stuck | Redis down | `sudo systemctl restart redis-server`, then both mycity units |
| Mail, PDFs, notifications not happening | worker down or behind | `journalctl -u mycity-worker-prod -n 100`; `sudo systemctl restart mycity-worker-prod` |
| Mail arrives hours late | the hourly limit reached (a batch of payslips or invitations): the rest wait their turn, by design | the `mail` check's `sent_last_hour`; `journalctl -u mycity-worker-prod \| grep postponed`. Nothing to fix unless it is urgent mail behind a batch |
| Mail not delivered, worker fine | SMTP refused, password changed, sending limit on the Namecheap plan | the `mail` check's error; the worker log; cPanel for the account |
| PDFs fail | Chrome missing or crashing | the `chromium` check; `google-chrome-stable --version` |
| Public uploads stay "pending" | clamd down or signatures missing | `sudo systemctl status clamav-daemon clamav-freshclam` |
| Certificate warning in browsers | renewal failed | `sudo certbot renew`; `sudo systemctl reload nginx` |
| Disk full | media growth, logs, dumps | `sudo du -sh /srv/mycity/* /var/log`; `sudo journalctl --vacuum-size=1G`; old dumps in `/srv/mycity/backups/*` |
| Backup alert, or `mycity-backup` failed | the database unreachable, the disk full, the offsite host refusing | `journalctl -u mycity-backup -n 50`; fix the cause, then `sudo systemctl start mycity-backup` (`docs/runbooks/backup-restore.md`) |
| Restore drill alert | the backup stopped (newest nightly over 36 hours old), or a dump that does not restore | `journalctl -u mycity-restore-drill -n 50`; take a backup now, then `sudo /srv/mycity/bin/mycity-restore-drill` |
| Uptime alert, server looks fine | DNS, the certificate, or the firewall, seen only from outside | `node ops/monitoring/uptime-probe.js` from your own machine; its reason names which |
| Deploy failed | see the failing job in GitHub Actions, then `~mycity-deploy/deploy-gate.log` | a failed deploy leaves the previous release running; fix forward with a PR |

Restarting a unit is safe: requests in flight finish, the worker lets running jobs finish (30 s),
and unfinished jobs are picked up again.

## 3 · A bad release

Roll back first (`docs/runbooks/rollback.md`): GitHub, Actions, Rollback, the previous sha, approve.
If the release migrated and the old code cannot run on the new schema, the same runbook's §2
restores the pre-deploy dump.

## 4 · A leaked secret

| Leaked | Do |
|---|---|
| A deploy key | make a new pair, re-run provisioning with the new public keys (`docs/runbooks/deploy.md` §1), replace the GitHub secret. The old key stops working when `authorized_keys` is rewritten |
| `JWT_*` secrets | replace both in the `.env` (`openssl rand -hex 48` each) and restart: every session ends, everyone signs in again |
| `DB_PASSWORD` | `ALTER ROLE mycity_prod_app PASSWORD '...'` as postgres, the same value in the `.env`, restart |
| `ENCRYPTION_KEY` | **do not replace it alone**: every stored mailbox password and integration secret was encrypted with it. Stop, and plan a re-encryption |
| The server's `administrator` password | change it (`passwd`), check `last` and `/var/log/auth.log` for logins |

## 5 · Afterwards

Write down, in the team channel and in the PR that fixes it: what happened, when it started and
ended, who was affected, the cause, and what stops it happening again. If a check would have caught
it earlier, add the check.

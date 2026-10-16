# Runbook · Backup and restore

What is backed up, how to restore it, and how to prove a restore works (SYSTEM_ARCHITECTURE §11,
MILESTONES §16: a restore rehearsed from the backup into a scratch database).

---

## 1 · What runs on its own

| What | When | Where | Kept |
|---|---|---|---|
| Nightly dump of both databases, with a record of the migration head and every table's row count from the same snapshot | 02:30 Lagos, `mycity-backup.timer` | `/srv/mycity/backups/<env>/nightly-<UTC time>.dump` and `.json` | 14 per environment |
| Nightly media snapshot (documents, photos, generated PDFs); unchanged files are hard links to the night before, so a night costs only what changed | same run | `/srv/mycity/backups/<env>/media/<UTC time>/` | 14 per environment |
| Offsite copy: a mirror of all of `/srv/mycity/backups` | same run, once §2 is done | the host in `/etc/mycity/backup.env` | as on the server |
| Pre-deploy dump | every staging deploy and production promote, before migrations (`deploy-gate`) | `/srv/mycity/backups/<env>/predeploy-<time>-<sha>.dump` | last 10 per environment |
| Restore drill (§4) | Sundays 04:00 Lagos, `mycity-restore-drill.timer` | report in `/srv/mycity/backups/drills.jsonl` | every run |
| Secrets (database passwords, encryption keys) | once, at provisioning | `/root/mycity-secrets/` | **never in the backups**: keep a copy yourself (§2) |

A failed backup or drill alerts production's channels (WhatsApp, `docs/runbooks/monitoring.md` §2) and leaves its unit failed
(`systemctl --failed`). The drill also fails when the newest nightly is over 36 hours old, so a
backup that silently stopped is found within a week.

Check them:

```
systemctl list-timers 'mycity-*'                     # when each runs next, and last ran
sudo jq . /srv/mycity/backups/last-run.json          # the last backup: ok, items, failures
sudo tail -n 1 /srv/mycity/backups/drills.jsonl | jq '{started_at, ok, restore_seconds, failures}'
journalctl -u mycity-backup -n 30                    # the last run's log
```

The scripts are `scripts/db/backup.sh` and `scripts/db/restore-drill.js`; provisioning installs
them as `/srv/mycity/bin/mycity-backup` and `/srv/mycity/bin/mycity-restore-drill`. After either
changes, run `ops/provision/provision.sh` again from the new checkout to install the new copy.

## 2 · One-time setup

**Offsite.** Until this is done every copy is on one disk in one data centre; the hosting
provider's own fortnightly backup is a last resort, not a plan. The offsite host is any Linux
machine with SSH and space for about twice the backups folder (`sudo du -sh /srv/mycity/backups`),
that JBS Praxis or MyCity controls, with an encrypted disk: the dumps hold personal data.

1. On the offsite host, a user and a folder (not `backup`: Ubuntu already has a system user by that
   name): `sudo adduser --disabled-password --gecos '' mycity-offsite`, then
   `sudo -u mycity-offsite mkdir -p /home/mycity-offsite/mycity`.
2. On the server, the key the backup connects with (no passphrase; it runs unattended):
   `sudo ssh-keygen -t ed25519 -N "" -C "mycity offsite" -f /root/.ssh/mycity-offsite`
3. On the offsite host, that public key in `/home/mycity-offsite/.ssh/authorized_keys`, limited to
   rsync into that one folder (`rrsync` ships with rsync; the key can do nothing else):
   `command="/usr/bin/rrsync /home/mycity-offsite/mycity",restrict ssh-ed25519 AAAA... mycity offsite`
4. On the server, accept the offsite host's key once (the backup refuses unknown hosts):
   `sudo ssh -i /root/.ssh/mycity-offsite mycity-offsite@<offsite host>` and answer yes (it then
   refuses to run a shell, which is right).
5. On the server, `sudoedit /etc/mycity/backup.env` and set `OFFSITE_TARGET=mycity-offsite@<offsite host>:`
   (nothing after the colon: `rrsync` already confines it to the folder in step 3). Add
   `OFFSITE_PORT=` if SSH is not on 22.
6. `sudo systemctl start mycity-backup && journalctl -u mycity-backup -n 10`: the last lines say
   `offsite: copied to ...`. The copy is always a folder `mycity-backups/` under the target, so the
   mirror's deletions can never reach anything else on that host.

**Secrets.** Copy `/root/mycity-secrets/` (and both `.env` files) into the team's password
manager once, and again whenever provisioning adds one. Without the encryption keys a restored
database cannot read its stored mailbox passwords and integration secrets.

**Alerts.** `ALERT_WHATSAPP_URLS` in production's `.env` (`docs/runbooks/monitoring.md` §2). The
backup and the drill send through `/srv/mycity/bin/mycity-alert`, which provisioning installs.

## 3 · Take a backup now

Before anything risky (a data fix, a big import):

```
sudo systemctl start mycity-backup        # waits until it is done
journalctl -u mycity-backup -n 10
```

Copy a dump to your own computer:

```
ssh administrator@108.181.196.53 "sudo install -m 600 -o administrator /srv/mycity/backups/prod/nightly-<time>.dump ~/"
scp administrator@108.181.196.53:~/nightly-<time>.dump .
ssh administrator@108.181.196.53 "rm ~/nightly-<time>.dump"
```

## 4 · Prove a dump restores (the drill)

Runs every Sunday on its own. By hand:

```
sudo /srv/mycity/bin/mycity-restore-drill                  # production's newest nightly
sudo /srv/mycity/bin/mycity-restore-drill --env=stg
sudo /srv/mycity/bin/mycity-restore-drill --dump=/srv/mycity/backups/prod/predeploy-<time>-<sha>.dump
sudo /srv/mycity/bin/mycity-restore-drill --keep           # leave mycity_restore_drill_prod to look at
```

It checks the dump's sha256 against its record, restores it into `mycity_restore_drill_<env>` as
the postgres superuser, timed, and then demands exactly the migration head and the row count of
every table that the backup recorded from the same snapshot it dumped. The live database's counts
are printed beside them for information; it is only read, in a read-only transaction. The scratch
database is dropped at the end (unless `--keep`). A pre-deploy dump has no record, so it is
restored and listed, not compared.

```
Restore drill · prod · 2026-10-18T03:00:04Z
dump      /srv/mycity/backups/prod/nightly-20261018T013112Z.dump (66559303 bytes)
ok        newest nightly is 1.5 hours old
ok        sha256 matches the backup's record
ok        restored in 2.8s
ok        migration head 0030_error_event.sql, as recorded
ok        all 5 tables restored with exactly the rows the backup recorded
...
PASSED in 3.4s
```

For M11 (MILESTONES §16), run it in front of MyCity and keep the printed report; the history of
every Sunday's run is in `drills.jsonl`.

## 5 · Restore for real

**One environment's database** (anything written after the dump is lost; tell MyCity first):

1. `sudo systemctl stop mycity-api-prod mycity-worker-prod`
2. Restore the dump as in `docs/runbooks/rollback.md` §2 (`pg_restore --clean --if-exists --no-owner`),
   reading a nightly with `sudo cat <dump> | ...` since the backups are root's.
3. `sudo systemctl start mycity-api-prod mycity-worker-prod`; check `/api/health/ready`.

**The media**, from a snapshot (owners and modes come back as they were):

```
sudo rsync -a --delete /srv/mycity/backups/prod/media/<UTC time>/ /srv/mycity/prod/media/
```

**A whole new server**: provision it (`docs/runbooks/server-setup.md`), put the old `.env` files and
`/root/mycity-secrets/` back **before** the first deploy (the encryption keys must match the data),
bring the backups back from the offsite host (its `mycity-backups/` folder) into `/srv/mycity/backups`, restore both databases and
both media folders as above, then deploy (`docs/runbooks/deploy.md`).

## 6 · How it was tested

In a copy of the server's layout (the same users, folders, PostgreSQL 16 with pgvector), on
16/10/2026: nightly runs with retention and hard-linked media snapshots; a dump taken while rows
were being written every 50 ms (the restore held exactly the recorded counts, the live database
had moved on); the drill's refusals (no nightly, a stale one, a changed byte, a truncated dump, a
record that disagrees); the alerts to a webhook; the offsite mirror over SSH to a second account
(hard links kept, an unknown host key refused with ssh's own reason); and both scripts under a
read-only root with only the backups folder writable, as the units run them. Not yet on the real
server: the timers firing under systemd, and an offsite host.

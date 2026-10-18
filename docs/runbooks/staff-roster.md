# The staff roster is not on staging

Staging shows one person. People · Employees reads "1 staff · 1 departments", Settings · Users
reads "1 users · 0 invited" and the Organogram reads "1 seats · 1 filled · 0 open": all three are
the JBS Praxis build account. MyCity's 18 staff and 2 open seats are not there.

This runbook puts them there. It needs someone who can SSH to the server.

## 1 · What happened

The roster loader (`scripts/db/load-staff.js`) is written, tested and committed, and
`seeds/staff/staff-list.xlsx` is in every release. It has never run on staging.

`deploy-gate` is the only thing CI may run on the server. It lives at `/srv/mycity/bin/deploy-gate`,
root-owned, and it is installed by `ops/provision/provision.sh` alone. A release never replaces it:
the release carries `src`, `scripts/db`, `migrations` and `seeds`, not `scripts/deploy`, and CI's
key is forced into that script, so a deploy cannot update the thing it is being run by.

The copy on the server was provisioned before the roster step existed. The step that loads the
roster was added to `scripts/deploy/deploy-gate` in the staff register pull request and is in the
repository, but it is not in the script the server runs.

The deploy log says so. Every staging deploy prints the migrations, then the AI catalogue:

```
[migrate] applied 1199_seed_home
[migrate] 2 applied; head 10099_seed_knowledge_ai
[ai-catalogue] 50 entries synced, 0 removed
```

Between those two the current `deploy-gate` runs the roster loader, which prints `[staff] ...` lines
and, if it fails, makes the gate print `warning: the staff roster did not load on stg`. Neither
appears in the latest staging deploy (Release run 147). The step is not there to run.

## 2 · Deploy the fix first

**Do not run the loader on the release staging is on now.** The build account was given staff
number 00001, which the sheet says is the CEO's. On the release staging runs today the loader
treats that as a match, leaves the build account alone and skips the CEO: you get 17 people, no
CEO, and two people with no line manager because "CEO" resolves to nobody.

Worse, that run records the sheet's checksum on its batch, so every later run says
`already_loaded` and stops. The CEO would never arrive.

The branch `claude/eager-brahmagupta-oq6q2m` fixes it: a staff number the sheet gives one of its
people, held here by somebody the sheet does not name, is taken back, and the holder moves to the
next free number. The build account becomes 00004 and keeps its record, its login and its roles.

Merge it, let the Release workflow deploy to staging, then carry on below.

## 3 · Load the roster

Run it as the environment's user, from the running release, with that environment's `.env`.

Preview first. Nothing is committed; the whole run is rolled back.

```sh
cd /srv/mycity/stg/current
sudo -u mycity-stg node --env-file=/srv/mycity/stg/shared/.env \
  scripts/db/load-staff.js --dry-run
```

Expect 20 rows, 20 to create, 0 with problems, and two columns left out on purpose (the sheet's DOB
holds a day and month with no year, and Phone is a placeholder in every row):

```
[staff] column "DOB" not imported: every one of the 15 filled cells fails to read as Date of Birth
[staff] column "Phone" not imported: every one of the 18 filled cells fails to read as Phone
[staff] preview: 20 rows, 20 to create, 0 to update, 0 unchanged, 0 with problems
[staff] dry run: nothing committed
```

Then load it:

```sh
cd /srv/mycity/stg/current
sudo -u mycity-stg node --env-file=/srv/mycity/stg/shared/.env \
  scripts/db/load-staff.js
```

```
[staff] committed: 20 created, 0 updated, 0 unchanged, 0 left for People to correct
[staff] login invited for Ifeoma Mbonu: management, CEO
...
[staff] staff numbers continue after 32
[staff] logins: 18 invited, 1 already had one, 0 failed
```

No email is sent. Everyone gets a login in the invited state; Send Invite does the rest when People
are ready.

## 4 · Put the gate back

Until `/srv/mycity/bin/deploy-gate` is the current one, no deploy will ever load the roster, and a
corrected sheet will sit in the release doing nothing.

From a checkout of `main` on the server, as root, the one line `provision.sh` itself runs:

```sh
sudo install -m 755 -o root -g root \
  <checkout>/scripts/deploy/deploy-gate /srv/mycity/bin/deploy-gate
```

Or re-run provisioning, which is safe to run again (nothing generated is regenerated and an
existing `.env` is never overwritten):

```sh
sudo LE_EMAIL=ops@mycityapp.io bash ops/provision/provision.sh
```

Check it took:

```sh
grep -c load-staff /srv/mycity/bin/deploy-gate
```

`1` is right. `0` means the old script is still there.

## 5 · Check

```sh
cd /srv/mycity/stg/current
sudo -u mycity-stg node --env-file=/srv/mycity/stg/shared/.env \
  scripts/db/load-staff.js --dry-run
```

It should now read `20 rows, 0 to create, 0 to update, 20 unchanged`.

On screen, at `hub.staging.mycityapp.io`:

| Screen | Before | After |
|---|---|---|
| People · Employees | 1 staff · 1 departments | 19 staff · 7 departments |
| Settings · Users | 1 users · 0 invited | 19 users · 18 invited |
| People · Organogram | 1 seats · 1 filled · 0 open | 21 seats · 19 filled · 2 open |

Ifeoma Mbonu holds 00001 and sits at the top of the Organogram. Etudor Edidiong and Bode Oluwasanmi
report to her. The two open seats are Head Sales & Revenue and Technical Assistant. JBS Praxis Team
holds 00004.

## 6 · Production

`/srv/mycity/bin/deploy-gate` is one script serving both environments, so step 4 fixes production
too: the roster then loads on the next production deploy by itself, as it was meant to.

Check production the same way before you rely on it. If its first administrator was also given
00001, the same reclaim applies and that account moves to a free number on the first load; if
production has no people yet, the roster simply creates all 20.

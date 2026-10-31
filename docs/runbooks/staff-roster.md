# The staff roster on staging and production

MyCity's 18 staff and 2 open seats come from `seeds/staff/staff-list.xlsx` and `roles.json`, loaded by
`scripts/db/load-staff.js` (`docs/guides/foundation.md` §6.1). Each deploy is meant to run it by itself.
Today it does not, and the steps below need someone who can SSH to the server.

## 1 · Where things stand (19/10/2026)

- **Staging has the roster, loaded by hand.** It shows 19 people (the 18 and the JBS Praxis build
  account) and the two open seats.
- **The server's `deploy-gate` is still the one provisioned before the roster step.** The step that
  loads the roster is in `scripts/deploy/deploy-gate` in the repository, but a release never replaces
  `/srv/mycity/bin/deploy-gate` (root-owned, installed by `ops/provision/provision.sh` alone). Every
  staging deploy proves it: Release run 159 (19/10/2026) goes from the migrations straight to the AI
  catalogue, with no `[staff]` line between them, and the current gate always prints one.
- **Production has never loaded the roster** (its one deploy, Release run 139 on 17/10/2026, shows no
  `[staff]` line), and it runs `9ecc4c5`, from before the fix that takes 00001 back from the build
  account. Do not run the loader there by hand until production runs a current release (§3).
- **The sheet was corrected on 19/10/2026** (TB): the two VACANT rows name their seat's line manager
  (Head Sales & Revenue: Program Manager; Technical Assistant: CEO), Aaron Agama's team is Sales &
  Marketing, Markerting is Marketing in three titles, Operations& People Lead is Operations & People
  Lead, and two emails had a mistyped domain (gheil.com and gpril.com, for gmail.com). `roles.json`
  puts the build account (Implementation Partner) under the CTO. A person already loaded is never
  written over, so staging needs §6 on screen.

## 2 · Put the gate back

Until `/srv/mycity/bin/deploy-gate` is the current one, no deploy loads the roster, and a corrected
sheet sits in the release doing nothing. From a checkout of `main` on the server, as root, the one
line `provision.sh` itself runs:

```sh
sudo install -m 755 -o root -g root \
  <checkout>/scripts/deploy/deploy-gate /srv/mycity/bin/deploy-gate
```

Or re-run provisioning, which is safe to run again (nothing generated is regenerated and an existing
`.env` is never overwritten):

```sh
sudo LE_EMAIL=ops@mycityapp.io bash ops/provision/provision.sh
```

Check it took: `grep -c load-staff /srv/mycity/bin/deploy-gate` prints `1`. `0` means the old script
is still there. One script serves both environments, so this fixes production too.

This cannot go unnoticed again: every deploy now checks the server's gate against the commit it
deploys and stops, with the steps to install it, when they differ (`docs/runbooks/deploy.md` §5).

## 3 · Production

Deploy a current release to production first (Release, run by an approver after staging). The first
deploy with the gate back loads the roster by itself. Before relying on it, look at who production
already holds:

```sh
sudo -u postgres psql mycity_prod -c "SELECT staff_number, work_email FROM employee ORDER BY 1"
```

The build account on 00001 is expected: the loader moves it to the next free number and creates the
CEO there. A number the sheet gives one of its people and production gives somebody the sheet also
names (an operations lead made with `create-admin` before the roster, for instance) is not moved: that
row is reported in the deploy log and in Imports history, and People correct it on screen.

## 4 · Load the roster by hand

Only when the gate cannot be put back yet, and only on a release that has the 00001 fix. Run it as the
environment's user, from the running release, with that environment's `.env`. Preview first; nothing
is committed.

```sh
cd /srv/mycity/<env>/current
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/load-staff.js --dry-run
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/load-staff.js
```

On an environment with only the build account (production), the load reads:

```
[staff] column "DOB" not imported: every one of the 15 filled cells fails to read as Date of Birth
[staff] column "Phone" not imported: every one of the 18 filled cells fails to read as Phone
[staff] preview: 20 rows, 20 to create, 0 to update, 0 unchanged, 0 with problems
[staff] committed: 20 created, 0 updated, 0 unchanged, 0 left for People to correct
[staff] login invited for Ifeoma Mbonu: management, CEO
...
[staff] JBS Praxis Team (Implementation Partner) now reports to the Chief Technology Officer
[staff] staff numbers continue after 32
[staff] logins: 18 invited, 1 already had one, 0 failed
```

No email is sent. Everyone gets a login in the invited state; Send Invite does the rest when People are
ready.

## 5 · The corrected sheet on staging

Staging already holds the people, so the corrected sheet changes no person. It gives the two open
seats their lines and puts the build account under the CTO:

```
[staff] preview: 20 rows, 0 to create, 2 to update, 18 unchanged, 0 with problems
[staff] committed: 0 created, 2 updated, 18 unchanged, 0 left for People to correct
[staff] JBS Praxis Team (Implementation Partner) now reports to the Chief Technology Officer
[staff] logins: 0 invited, 19 already had one, 0 failed
```

The 2 updated rows are the seats. If the load cannot run yet, make the same three changes on screen:
People · Organogram, Head Sales & Revenue, Edit Role, Reports To Etudor Edidiong; Technical Assistant,
Edit Role, Reports To Ifeoma Mbonu; People · Employees, JBS Praxis Team, Change Manager, Bode
Oluwasanmi.

| Screen | Before | After |
|---|---|---|
| People · Organogram | "4 people and roles sit at the top"; the seven marketing officers under a seat at the top | No banner; one tree under Ifeoma Mbonu: Bode Oluwasanmi (with JBS Praxis Team and the back-end line), Etudor Edidiong (Chinyere Elechi, Cynthia Osakunih, Head Sales & Revenue with its seven) and Technical Assistant |
| People · Employees, Needs a Decision | No Line Manager: 1 person | Gone |
| ESS · Org Chart, as the build account | A card on its own, Direct Reports 0 | Reports To Bode Oluwasanmi |
| Leave for the seven marketing officers | Approved by the CEO (nobody above their seat) | Approved by Etudor Edidiong, the first person above Head Sales & Revenue |

## 6 · Corrections to make on screen on staging

People · Employees, open the person, Edit Record:

| Person | Field | Change to |
|---|---|---|
| Aaron Agama | Department | Sales & Marketing |
| Chinyere Elechi | Job Title | Head PR, Marketing & Brand Strategy |
| Chinyere Elechi | Work Email | chinyereelechi@gmail.com |
| David Idowu-Agida | Work Email | davididowuagida@gmail.com |
| Gideon Ekom | Job Title | Marketing & Growth Officer - Enugu |
| Adaeze Chike | Job Title | Marketing & Growth Officer - Abia |
| Cynthia Osakunih | Job Title | Operations & People Lead |

Two things the screen cannot do yet:

- **Chinyere's and David's logins follow the corrected address** (since 25/10/2026,
  `docs/guides/identity.md` §6.1): a login nobody has used yet moves with its employee's work email
  once People correct it on the record, so after the correction above Send Invite reaches them on
  staging too. A login already in use moves only with Use Work Email on Settings · Users. Production
  creates both logins with the corrected address.
- **The Marketing department stays in the department lists**, empty, once Aaron has moved: no screen
  retires a department yet. It no longer counts on People · Employees, which counts departments that
  have people.

### 6.1 The October chart's names (22/10/2026)

Nothing to do by hand. From Performance PR 1 the loader applies `seeds/staff/nomenclature.json` on
every deploy, before and after the sheet (`docs/guides/foundation.md` §6.1, `docs/guides/performance.md`
§6.20): Sales & Marketing becomes Branding & Marketing, Backend Operations becomes Technology &
Back-office Ops (Technology merged into it and retired), HR & Operations becomes People & Culture, all
in place; Partnership & Growth is created and takes its posts; the chart's titles, David's line to
Chinyere, the department codes and heads, and the seven new vacant seats follow. The deploy log lists
each change under `names:`; a second deploy lists none. A title already corrected on screen to something
else is left as it is. Since 25/10/2026 the changes to people and seats are applied once per version of
`nomenclature.json`: after that, a title, department or line People change on screen stays, even one
that matches an old name. A new version of the file applies once again.

## 7 · Check

```sh
cd /srv/mycity/stg/current
sudo -u mycity-stg node --env-file=/srv/mycity/stg/shared/.env \
  scripts/db/load-staff.js --dry-run
```

Once the sheet in the build has loaded, it says `this sheet is already loaded (batch IMP-...); a dry
run has nothing to preview` and writes nothing. A changed sheet is previewed: the log lists each row
to create or update and each problem, with nothing committed.

A row the log reports is corrected on People · Employees or in the next sheet. The ones to expect
since 25/10/2026, each with what to do:

| The log says | Do |
|---|---|
| `Staff number ... belongs to ..., loaded from the roster before` | The sheet changed that person's name and email together. Correct their record on screen; the row then matches |
| `... may already be staff number ...; add their Staff ID to the row` | Put the person's Staff ID in the sheet's row, or correct their email there |
| `... belongs to staff number ...; give this person their own email` | A second person in a post whose email `roles.json` gives: put their own address in the sheet |
| `department "..." is not one of MyCity's` | A typo in Team: correct it in the sheet. A real new department goes into `nomenclature.json` first |

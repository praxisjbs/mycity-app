# First accounts on a server

The first logins on staging and on production are made with `scripts/db/create-admin.js`
(BACKEND_STRUCTURE §17): a complete employee, their login and their role in one transaction. Two
are needed before anyone else can be invited from Settings · Users:

| Who | Role (`role_code`) | Why |
|---|---|---|
| The operations lead | `operations_people` (Operations & People) | Invites everyone else and gives them their roles |
| The build account | `implementation` (Implementation Team) | Full access for the build team while the system is built; suspended (soft) after handover |

Everyone else gets a login by invitation (Settings · Users → Invite User, or Send Invite on the
employee's record). Production is never seeded; these two are real people.

**Nothing about a real person goes into the repository**, which is public: not their email, not
their details, not a password. The details live in a file on the server for the length of the run,
and the password is typed at a hidden prompt.

## 1 · Before you start

- The release is deployed and migrated (`docs/runbooks/deploy.md`); `0190_seed_roles_and_grants`
  has run, so the seven roles exist.
- Mail works (`docs/runbooks/dns-and-mail.md`), or Forgot Password will not reach anyone later.
- You can SSH to the server and `sudo`.

## 2 · Write the details file

On the server, in your own home folder (not in the release), one file per person in the
`AdminBootstrap` shape (`packages/contract/schemas/organisation.js`). Every value below is a
placeholder:

```json
{
  "employee": {
    "first_name": "<first name>",
    "last_name": "<last name>",
    "work_email": "<their work email>",
    "phone": "<+234...>",
    "job_title": "<job title>",
    "department_name": "<department>",
    "start_date": "<yyyy-mm-dd>",
    "employment_type": "full_time",
    "work_pattern": "on_site"
  },
  "role_code": "operations_people",
  "is_ceo": false
}
```

`employment_type` is one of `full_time`, `part_time`, `contractor`, `consultant`, `intern`;
`work_pattern` one of `on_site`, `hybrid`, `remote`. For the build account use
`"role_code": "implementation"`. `chmod 600` the file.

## 3 · Run it

For each environment (`stg` first, then `prod`), as that environment's user, from the running
release, with its own settings:

```sh
cd /srv/mycity/<env>/current
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/create-admin.js --from=/home/<you>/ops-lead.json
```

It shows what it will create, asks you to type the environment's name, then asks for the password
twice. The password must be at least 8 characters with a lowercase and an uppercase letter, a
number and a symbol. Give it to the person by phone, or better, let them set their own: after the
run, use Forgot Password on the sign-in screen with their email.

The build account is the second holder of a powerful role on some servers; if the script says the
role already has an active holder, add `--allow-additional`, deliberately:

```sh
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/create-admin.js --from=/home/<you>/build-account.json --allow-additional
```

`--dry-run` runs the whole transaction and rolls it back, to check a file first.

## 4 · After

- Delete the details files (`shred -u`).
- Sign in at `https://hub.staging.mycityapp.io` (production: `https://hub.mycityapp.io`) as each
  account and open Settings · Users: both appear, Active, with their role.
- Invite the rest from Settings · Users.

## 5 · Removing the build account at handover

Settings · Users → the build account → Suspend, with the reason. Suspending ends every session and
refuses sign-in; the employee record and the audit history stay. Nothing is deleted.

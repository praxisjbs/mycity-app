# First accounts on a server

The first logins on staging and on production are made with `scripts/db/create-admin.js`
(BACKEND_STRUCTURE §17): a complete employee, their login and their role in one transaction. Two
are needed before anyone else can be invited from Settings · Users:

| Who | Role (`role_code`) | Why |
|---|---|---|
| The build account | `implementation` (Implementation Team) | Full access for the build team while the system is built; suspended (soft) after handover |
| The operations lead | `operations_people` (Operations & People) | Invites everyone else and gives them their roles |

Everyone else gets a login by invitation (Settings · Users → Invite User, or Send Invite on the
employee's record). Production is never seeded; these are real accounts.

**No email and no password goes into the repository**, which is public. Both are typed at the
terminal; the password at a hidden prompt.

## 1 · Before you start

- The release is deployed and migrated (`docs/runbooks/deploy.md`); `0290_seed_roles_and_grants`
  has run, so the seven roles exist.
- Mail works (`docs/runbooks/dns-and-mail.md`), or Forgot Password will not reach anyone later.
- You can SSH to the server and `sudo`.

Every command below runs as that environment's user, from the running release, with its own
settings (`stg` first, then `prod`). `--env=<name>` confirms which database you are writing to; the
script refuses if it is not this `.env`'s `APP_ENV`.

## 2 · The build account

The whole employee record is in the script (`BUILD_ACCOUNT` in `scripts/db/create-admin.js`):
JBS Praxis Implementation Team (known as JBS Praxis), Implementation Partner in the Implementation
department, consultant, remote, on a contract from 09/10/2026 to 09/12/2026 at ₦1,850,000.00 a
month, confirmed from the start (a consultant has no probation), with phone 0802 749 2738, date of
birth, next of kin and bank details. Every field is filled except the home address (an address is
picked on screen, never typed into a script, F27), the worksite and managers, which a remote first
account has none of, and the leaving date. You type two
things: the email (kept as both work and personal email) and the password.

```sh
cd /srv/mycity/<env>/current
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/create-admin.js --build-account --env=<staging|production>
```

```
Work email: <the build team's email>
Password (at least 8 characters, upper and lower case, a number and a symbol): ********
Repeat password: ********
```

It prints what it is about to create, then creates it. The bank account number is ten zeros on
purpose, so no payment run can ever send money to a real account.

## 3 · The operations lead

Their details are a real person's, so they are not in the script. Either run it with no options and
answer each question, or write a file in your own home folder (never in the release) in the
`AdminBootstrap` shape (`packages/contract/schemas/organisation.js`); every value below is a
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
`work_pattern` one of `on_site`, `hybrid`, `remote`. The optional fields (`middle_name`,
`preferred_name`, `personal_email`, `contract_ends_on`, `confirmation_due_on`, `confirmed_on`,
`date_of_birth`, `gender`, next of kin, bank, `gross_monthly`) can be added the same way. The home
address is not among them: an address is picked, never typed (F27), so the person picks it on My
Profile after signing in. A phone is 11 digits (`0803 123 4567`) or `+234` and ten. `chmod 600` the file, then:

```sh
sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env \
  scripts/db/create-admin.js --from=/home/<you>/ops-lead.json --env=<staging|production>
```

Only the password is asked. Give it to the person by phone, or better, let them set their own:
after the run, use Forgot Password on the sign-in screen with their email.

If the script says a role already has an active holder, add `--allow-additional`, deliberately.
`--dry-run` runs the whole transaction and rolls it back, to check first.

## 4 · After

- Delete any details file (`shred -u`).
- Sign in at `https://hub.staging.mycityapp.io` (production: `https://hub.mycityapp.io`) as each
  account and open Settings · Users: both appear, Active, with their role.
- Invite the rest from Settings · Users.

## 5 · Removing the build account at handover

Settings · Users → the build account → Suspend, with the reason. Suspending ends every session and
refuses sign-in; the employee record and the audit history stay. Nothing is deleted.

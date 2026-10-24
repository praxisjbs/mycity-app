# Runbook · GitHub settings

The repository is `praxisjbs/mycity-app`, JBS Praxis's account (moved from
`tomblakeasaah196/mycity-app` on 24/10/2026). Only the owning account is an admin, so **only whoever
signs in as `praxisjbs` can apply or change these settings**. Collaborators cannot see or change them; that is
what makes them hold. Re-check this page after any change to the repository's plan or visibility.

## Keep the repository public

On a free personal account, branch protection and the production environment's required
reviewers work **only on public repositories**. Making the repository private on the current plan
switches both off without warning. If it must become private, first move it to a plan that keeps
them (GitHub Team covers branch protection; confirm environment reviewers for the chosen plan),
or replace the production approval with a server-side control (SYSTEM_ARCHITECTURE §9.5).

## Branch rule for `main`

Settings → Branches → Add branch ruleset (or classic branch protection rule), target `main`:

- [ ] Require a pull request before merging
  - [ ] Required approvals: **1**
  - [ ] Dismiss stale pull request approvals when new commits are pushed
  - [ ] **Require review from Code Owners** (`.github/CODEOWNERS`)
  - [ ] Require approval of the most recent reviewable push
- [ ] Require status checks to pass: add **`ci`**; require branches to be up to date
- [ ] Require conversation resolution before merging
- [ ] Block force pushes
- [ ] Restrict deletions
- [ ] **Do not allow bypassing the above settings.** Without it, the admin (TB) is exempt from all
  of the above.

The `ci` check appears in the status-check picker only after the workflow has run once on a PR.

## Environments

Settings → Environments:

- [ ] `staging`: deployment branches and tags → selected branches → `main` only. Holds
  `STAGING_SSH_KEY`.
- [ ] `production`: required reviewers **@tomblakeasaah196 and @swizfcodes**, **prevent self-review**
  on, deployment branches `main` only. Holds `PROD_SSH_KEY`. While the repository is private on a
  free plan the reviewers section is not offered at all: set **Selected branches and tags** to
  `main` (not "Protected branches only", which allows every branch when no rule exists), and
  production runs only by hand (SYSTEM_ARCHITECTURE §9.3, interim). Never store the production key as a
  repository secret: it must be released only after approval (SYSTEM_ARCHITECTURE §9.3).

## Repository secret

Settings → Secrets and variables → Actions → Repository secrets:

- [ ] `ALERT_WHATSAPP_URLS`: the same WhatsApp links as in production's `.env`
  (`docs/runbooks/monitoring.md` §2). The uptime probe (`.github/workflows/uptime.yml`) sends
  through them; nothing else in GitHub reads it. It is not a production key, so it may be a
  repository secret.
- [ ] `ALERT_WEBHOOK_URL`: only if the team also uses a Slack or Google Chat webhook.

## Collaborators

Settings → Collaborators: GE, LA, AJ invited with write access. A collaborator can push branches,
open PRs, review, and merge a PR that passes the rule above. They cannot push to `main`, change
these settings, or approve their own PR.

## How a collaborator sends a change

```
git checkout main && git pull
git checkout -b m1/short-name
# work, commit
git push -u origin m1/short-name
gh pr create --base main          # or the "Compare & pull request" button
```

CI runs, a code owner other than the author approves, the author merges. Details: README §9.

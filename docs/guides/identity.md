# Sign-In, Sessions and Logins · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 |
| Backend modules | `identity`, `users`, `access` |
| Frontend paths | `app/src/auth/`, `app/src/features/ess/Security.tsx`, `app/src/features/shared/InviteToSignIn.tsx` |
| Permission key(s) | none for sign-in and the person's own security (own account); `settings` view, create, edit for Users |
| Screens (PROGRESS.md rows) | #70 Users, #90 My Security, and the M0 sign-in item |
| Status | Built |
| Last changed | 16/10/2026 |

Sources: MILESTONES §5.3 (brand on the sign-in screen), §14 (roles) and A2; BACKEND_STRUCTURE §11
and §17; the session rules of the donor product (REUSE_MAP), chosen by TB on 16/10/2026. Two-step
sign-in, passkeys and the PIN are the second sign-in PR (the `security` module) and are not in this
guide yet.

---

## 1 · What it is for

Everyone at MyCity signs in to the staff app with the email on their employee record and a
password only they know. A session lasts two hours at most and locks after half an hour unused, so
a desk left open does not stay signed in. People and Operations give an employee a login by
inviting them; the employee chooses their own password from the email. Nobody else ever sets or
sees it.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Sign In (`/`) | Staff app, signed out | Anyone | The four cities (Lagos, London, Accra, Nairobi) at their local time; the sign-in card | Sign in; Forgot Password |
| Forgot Password | Staff app, the sign-in card | Anyone | Email field | Send a reset link |
| Reset and Welcome (`/reset?token=`, `/welcome?token=`) | Staff app, from an email | The person the link was sent to | Their email or first name; New Password, Confirm Password | Choose a password; ask for a new link when it has expired |
| Lock screen | Over any staff screen | The signed-in person | Their name, email, why it locked; Password | Unlock; Sign Out |
| ESS · My Security (`my-security`) | Staff app | Every employee, own account | Password (last changed), Signed In (live sessions), Recent Sign-Ins, Clock-In Devices link | Change Password; sign out one device; Sign Out Others; Open My Devices |
| Settings · Users (`users`) | Staff app | `settings` view | Counts, the logins with status and roles, Users by Role | Invite User; per login: Save Roles, Resend Invitation, Send Reset Link, Sign Out Everywhere, Suspend, Reactivate |
| People · Employees, the 360 | Staff app | `settings` create | Send Invite on the record header | Invite this employee to sign in |
| The bell and email | Everywhere | The person concerned | Security notices | Read them; they cannot be switched off |

## 3 · How the screens relate

1. **Invitation.** Settings · Users → Invite User (or Send Invite on an employee's 360) posts
   `POST /users` with the employee and roles. `users.invite` creates the login with no usable
   password and emits `app_user.created` and `auth.link_requested` (purpose `invite`). The outbox
   handler `identity.send_link` mints the link token, keeps only its hash in `password_reset`, and
   queues the `user-invite` email with `STAFF_ORIGIN/welcome?token=…` (72 hours).
2. **First password.** The link opens Welcome: `POST /auth/link` checks it, `POST /auth/reset`
   sets the password (`auth.password_set`), spends the link and every other open one, and the card
   returns to Sign In with the email filled.
3. **Sign in.** `POST /auth/login` checks the password (Argon2id), starts a `user_session`, sets
   the refresh cookie and the device cookie, and returns the access token, the session clock and
   `me`. A browser this person has not used before, when they have used others, raises the New
   Sign-In notice (`auth.signed_in` with `new_device`).
4. **Working.** The access token lives in memory and lasts 15 minutes, capped at the session's
   end. While the person is active the app renews it a minute before it expires
   (`POST /auth/refresh`), one tab at a time.
5. **Lock.** At two hours, after 30 minutes with no key, tap or pointer in any tab, or when the
   refresh cookie is refused, every open tab shows the lock screen over the work. The idle lock
   ends the session on the server (`POST /auth/logout` with `reason: idle`). The password starts a
   new session and the screen carries on, half-filled forms included.
6. **Forgot.** Forgot Password posts `POST /auth/forgot`; the answer is the same whether or not
   the email has an account. A link (30 minutes) goes only to an active login, at most once in two
   minutes.
7. **My Security.** Change Password (`POST /auth/password`) needs the current password, ends the
   other sessions and the open links, and notifies the person. The session lists come from
   `GET /auth/sessions`; a device is signed out with `POST /auth/sessions/:id/end`.
8. **Administration.** Suspend ends every session and refuses sign-in after the right password;
   Reactivate lifts it. Send Reset Link and Sign Out Everywhere notify the person.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `app_user` | `employee_id` (unique), `email`, `password_hash`, `status`, `is_ceo`, `failed_login_count`, `last_failed_login_at`, `password_changed_at` | One login per employee. An invited login has the hash `!invited` and no `password_changed_at` |
| `user_session` | `user_id`, `refresh_token_hash`, `issued_at`, `expires_at`, `last_seen_at`, `method`, `known_device_id`, `device_label`, `ip_address`, `killed_at`, `end_reason` | `refresh_token_hash` is the hash of the current refresh token's id; idle is `now() - last_seen_at` |
| `known_device` | `user_id`, `fingerprint_hash`, `label`, `platform`, `last_seen_at`, `last_ip` | The device cookie's hash; drives the New Sign-In notice and the greeting |
| `password_reset` | `user_id`, `token_hash`, `purpose` (reset, invite), `expires_at`, `used_at`, `requested_by`, `requested_ip`, `source_event_id` (unique) | Only the hash is stored; one row per requesting event |
| `role`, `user_role`, `role_permission` | `role.code`, `home_view`, `rank` | Seven roles (§8); the grants matrix |

Schema migration: `migrations/0200_identity_sessions.sql`. Reference data:
`seeds/reference/0290_seed_roles_and_grants.sql`.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | `LoginBody` → `Session` | anonymous | | Sets the refresh and device cookies; 10 failures per address in 15 minutes |
| `POST /api/v1/auth/refresh` | `EmptyBody` → `SessionTokens` | anonymous, refresh cookie | | Rotates the cookie |
| `POST /api/v1/auth/logout` | `LogoutBody` → 204 | anonymous | | `reason: idle` records `inactivity_timeout` |
| `GET /api/v1/auth/device` | → `DeviceAccount` | anonymous, device cookie | | Who last signed in on this browser |
| `POST /api/v1/auth/forgot` | `ForgotBody` → `Accepted` | anonymous | | Same answer for every email; 5 per address in 15 minutes |
| `POST /api/v1/auth/link` | `LinkCheckBody` → `LinkCheck` | anonymous | | 404 `LINK_INVALID` when expired or spent |
| `POST /api/v1/auth/reset` | `ResetBody` → `ResetDone` | anonymous | | Sets the password, ends every session |
| `GET /api/v1/auth/me` | → `Me` | own account | | |
| `GET /api/v1/auth/security` | → `SecuritySummary` | own account | | |
| `POST /api/v1/auth/password` | `PasswordChange` → `PasswordChanged` | own account | | 10 per person in 15 minutes |
| `GET /api/v1/auth/sessions` | `SignInListQuery` → `SignInPage` | own account | yes, 25 | Filter `status` (active, ended); sort `issued_at` |
| `POST /api/v1/auth/sessions/end-others` | `EmptyBody` → `SessionsEnded` | own account | | |
| `POST /api/v1/auth/sessions/:id/end` | `EmptyBody` → 204 | own account | | 422 for the current session |
| `GET /api/v1/users` | `UserListQuery` → `UserPage` | `settings` view | yes, 25 | Filters `status`, `role`; sort `display_name`, `last_seen_at`, `created_at` |
| `GET /api/v1/users/summary` | → `UsersSummary` | `settings` view | | |
| `GET /api/v1/users/candidates` | `CandidateListQuery` → `CandidatePage` | `settings` view | yes, 25 | Employees with no login |
| `POST /api/v1/users` | `UserInvite` → `UserRow` | `settings` create | | |
| `GET /api/v1/users/:id` | → `UserRow` | `settings` view | | |
| `POST /api/v1/users/:id/invite`, `/reset-link` | `EmptyBody` → `LinkSent` | `settings` edit | | |
| `POST /api/v1/users/:id/roles` | `UserRolesSet` → `UserRow` | `settings` edit | | |
| `POST /api/v1/users/:id/suspend`, `/reactivate` | `UserSuspend`, `EmptyBody` → `UserRow` | `settings` edit | | Never on your own login |
| `POST /api/v1/users/:id/end-sessions` | `EmptyBody` → `UserSessionsEnded` | `settings` edit | | |
| `GET /api/v1/access/roles` | `RoleListQuery` → `RolePage` | `settings` view | yes, 25 | Sort `rank`, `name` |

Schemas: `packages/contract/schemas/identity.js`, `users.js`, `access.js`.

## 6 · Rules and calculations

**Sessions** (`identity.session-policy.js`; `SESSION_MAX_AGE_MIN` 120, `SESSION_INACTIVITY_MIN`
30, `ACCESS_TOKEN_MIN` 15):

- A session ends 120 minutes after sign-in, however active the person is.
- A refresh more than 30 minutes after the last one ends the session (`inactivity_timeout`).
- Every token expires no later than its session: an access token minted five minutes before the
  end lives five minutes.
- The refresh token rotates on every use. Presenting one that was already rotated ends the session
  (`refresh_token_reuse`): someone else holds a copy.
- Times go to the client as seconds remaining (`session_expires_in`, `session_idle_limit`), never
  as timestamps, so a wrong laptop clock cannot lock early or late.
- The refresh cookie is HttpOnly, SameSite Strict, path `/api/v1/auth`, `__Secure-` on the
  servers; the device cookie is `__Host-`, 400 days, and grants nothing.

**Passwords** (`NewPassword` in the contract, `identity.password-policy.js`):

- At least 8 characters, with a lowercase letter, an uppercase letter, a number and a symbol.
- Not one of the common passwords, not the name part of the person's email.
- Not in a known breach (the k-anonymity range lookup; only five characters of the hash leave
  the server). The check fails open after 3 seconds. `PASSWORD_BREACH_CHECK=false` turns it off.
- Hashed with Argon2id. Argon2 runs outside the transaction.

**Wrong passwords** (`identity.throttle.js`): the first 5 cost nothing; then each attempt waits
2^(n−5) seconds, at most 15 minutes. There is no lockout. The sixth notifies the person. An
unknown email and a wrong password get the same message and take the same time. A suspended
account is told so only after the right password.

**Links:** a reset link lasts 30 minutes, an invitation 72 hours. A new link closes the open ones of
the same kind. Setting a password spends every open link and ends every session.

**Logins:** no login without an employee; a person cannot suspend, reactivate or change the roles of
their own login.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `auth.signed_in` | A sign-in | Audit; New Sign-In notice (bell and email) when the browser is new and others are known |
| `auth.sign_in_failed` | A wrong password | Audit |
| `auth.sign_in_throttled` | The sixth wrong password in a row | Notice to the person |
| `auth.signed_out`, `auth.session_ended` | Sign-out; a session ended by policy, the person or an administrator | Audit; notice when an administrator ended it |
| `auth.password_changed` | Change Password | Notice to the person |
| `auth.link_requested` | Forgot, invite, resend, reset link | Outbox `identity.send_link`: mint the token, store its hash, queue the email (no token in the event, the ledger or a notification) |
| `auth.password_set` | A password chosen from a link | Notice after a reset |
| `app_user.created`, `app_user.suspended`, `app_user.reactivated` | Users actions | Audit (sensitive) |
| `access.roles_set` | Roles changed | Audit (sensitive); the grants cache is dropped |

Every `auth.*`, `app_user.*` and `access.*` notice is in the Security category: by email too, and
not something a person can switch off.

## 8 · Permissions and visibility by role

| Role (`code`) | Sees | Can do |
|---|---|---|
| Implementation Team (`implementation`) | Everything | Everything; for the build team, removed (soft) after handover |
| Operations & People (`operations_people`) | Everything in operations | Users: invite, roles, suspend, reset links |
| Management (`management`) | Everything | Read across modules |
| Head of Department (`head_of_department`) | Their department | Partnerships home |
| System Administrator (`administrator`) | Settings | Users and settings |
| Line Manager (`manager`) | Their team | Approvals for their team |
| Staff (`employee`) | Their own records | Self-service |

The CEO is a flag on the login (`is_ceo`) and holds every action. Every person sees and manages
only their own sessions on My Security. The exact grants are the seed matrix
(`seeds/reference/0290_seed_roles_and_grants.sql`).

## 9 · AI and search

- **AI reads**: none. Sign-in, sessions and logins are not something the assistant answers
  (`// ai:none` on the controllers).
- **AI routes**: none in these modules.
- **Search** (`users.search.js`): logins by name and email, opening Settings · Users, for
  `settings` view.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Sign In | The brand, "Every city. One team." and one line on MyCity App; the shown city's country, name, local time and day; the four cities with their times; the greeting (with the first name on a known browser), Email, Password, Forgot Password, Sign In | None | The session rules, the throttle and why the error never says which emails exist: §6 |
| Forgot Password | Reset Password, "We will email you a link.", Email, Send Link, Back; then Check Your Email with the address | None | How long a link lasts and that only an active login gets one: §6 |
| Reset and Welcome | The email (reset) or "Welcome, first name" (invitation); New Password, Confirm Password, Save Password or Set Password; an expired link says so with Request New Link | None | The password rules beyond the field's own mark: §6 |
| Lock screen | Session Locked, Session Ended or Signed Out; why in one line; the person's photo or initials, name and email; Password; Sign Out, Unlock | None | The idle and time limits and the server-side end: §3 step 5, §6 |
| ESS · My Security | Password with when it was changed; Signed In (device, address, when; Sign Out per device; Sign Out Others); Recent Sign-Ins (When, Device, Address, Status); Clock-In Devices with Open My Devices | None | Why other sessions end on a password change, the reuse rule: §6 |
| Settings · Users | Users, Active, Invited, Suspended, Signed In Now; the status chips; the list (person, roles, status, last seen); Users by Role; a login's detail with its actions | None | What each role grants: Settings · Roles & Permissions, §8 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Sign In | A short band with the city, its country and time (still), the brand on it; the form under it | The headline, the four city buttons, the moving drawing | Sign In, full width | None (signed out) |
| Lock screen | The same card, its buttons full width and stacked | Nothing | Unlock, full width | None until unlocked |
| ESS · My Security | Icon cards: Password, Signed In, Recent Sign-Ins, Clock-In Devices | The tables (each opens as cards in its sheet) | Change Password, full width in its sheet | Bottom bar Self-Service |
| Settings · Users | The counts two to a row, the status chips, logins as person cards | Users by Role | Invite User; a login's actions in its sheet | More, Settings |

## 11 · Edge cases

- **Two tabs refresh at once.** Refreshes are taken one at a time across tabs (Web Locks), so the
  second presents the cookie the first rotated to, and reuse detection does not fire.
- **Offline.** A refresh that cannot reach the server does not lock the screen; the call fails
  and says so.
- **A laptop that slept past two hours.** The lock is checked on return to the tab and every 15
  seconds, and the server refuses the old session anyway.
- **Unlocking as someone else.** The lock screen signs in only the person shown; Sign Out goes to
  the sign-in screen. A different account signed in from another tab reloads at Home.
- **Invited, never finished.** Status Invited; Resend Invitation sends a new link and the old one
  stops working.
- **Suspended mid-session.** Every session ends; the next refresh locks the screen with "This
  session was ended".
- **A reset link opened while signed in.** The link page opens anyway; afterwards the browser is
  back at Home.
- **The email cannot be sent.** The request still answers the same; the email job retries.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | the session policy (ceiling, idle, rotation with reuse detection, cooldown instead of lockout, refresh cookie) | Settings in `.env`; no tenant; the idle lock ends the session on the server |
| praxis-ls | the device cookie and the new-device notice | A notification in the Security category (bell and email) |

## 13 · Open questions

- Two-step sign-in, passkeys and the PIN: the second sign-in PR (security module), with fresh-auth
  checks on sensitive actions.
- The sign-in drawings are drawn, not photographs: image hosts were not reachable from the build.
  Licensed photographs can replace them through `CityShowcase` later; TB to decide.

## 14 · Change log

- 16/10/2026 · TB · First version, with the build: sessions to the donor rules, the lock screen,
  the four-city sign-in screen, Forgot, Reset and Welcome, My Security on the real API, Settings ·
  Users and Send Invite on the employee record.

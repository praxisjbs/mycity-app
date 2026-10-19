# Sign-In, Sessions and Logins · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 |
| Backend modules | `identity`, `security`, `users`, `access` |
| Frontend paths | `app/src/auth/`, `app/src/features/ess/Security.tsx`, `app/src/features/shared/InviteToSignIn.tsx`, `app/src/api/mock/modules/security.ts` |
| Permission key(s) | none for sign-in and the person's own security (own account); `settings` view, create, edit for Users |
| Capabilities | none of its own; `/auth/me` lists the ones the person holds (§5) |
| Screens (PROGRESS.md rows) | #70 Users, #90 My Security, and the M0 sign-in item |
| Status | Built |
| Last changed | 19/10/2026 |

Sources: MILESTONES §5.3 (brand on the sign-in screen), §14 (roles) and A2; BACKEND_STRUCTURE §11
and §17; the session rules of the donor product (REUSE_MAP), chosen by TB on 16/10/2026. Two-step
sign-in, passkeys and the PIN: TB's decisions of 16/10/2026 (REUSE_MAP §1.1, MILESTONES §5 and §14 as
amended, DATABASE_SCHEMA §4), built in the second sign-in PR (the `security` module).

---

## 1 · What it is for

Everyone at MyCity signs in to the staff app with the email on their employee record and a
password only they know. A session lasts two hours at most and locks after half an hour unused, so
a desk left open does not stay signed in. People and Operations give an employee a login by
inviting them; the employee chooses their own password from the email. Nobody else ever sets or
sees it.

Besides the password, each person can add three ways in from My Security: **two-step sign-in** (a
code from an authenticator app after the password or the PIN), **passkeys** (the device's
fingerprint, face or screen lock, which count as both steps) and a four-digit **PIN** that unlocks the
lock screen and signs in on a browser they have used before. Adding or removing one needs a fresh
sign-in. When a phone with the authenticator is lost, a recovery code gets the person in once, and an
administrator can reset their two-step from Settings · Users.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Sign In (`/`) | Staff app, signed out | Anyone | Eight cities (Lagos, London, Accra, Nairobi, Johannesburg, Rabat, Abidjan, Douala) at their local time; the sign-in card; on a browser the person has used, Use Passkey and Use PIN for the ways they have set up | Sign in with the password, a passkey or the PIN; Forgot Password |
| Code step | Staff app, the sign-in card and the lock screen | A person with two-step on, on a browser that has not given a code lately | Their email, Sign-In Code (six boxes), Use Recovery Code | Enter the authenticator app's code or a recovery code; Back |
| Set-up step | Staff app, the sign-in card | A person whose role requires two-step and who has not set it up | Their email, the new key as a QR code and as text, Code From App; then the ten recovery codes | Turn two-step on with the app's first code; Copy Codes; Continue into the app; Back |
| Forgot Password | Staff app, the sign-in card | Anyone | Email field | Send a reset link |
| Reset and Welcome (`/reset?token=`, `/welcome?token=`) | Staff app, from an email | The person the link was sent to | Their email or first name; New Password, Confirm Password | Choose a password; ask for a new link when it has expired |
| Lock screen | Over any staff screen | The signed-in person | Their name, email, why it locked; the PIN when they have one, else Password; Use Passkey; the code step when two-step asks; when their role now requires two-step, one line asking them to sign out and sign in | Unlock with the PIN, a passkey or the password; Sign Out |
| ESS · My Security (`my-security`) | Staff app | Every employee, own account | Password (last changed), Two-Step Sign-In (On or Off, Ask for a Code, recovery codes left), PIN (On or Off, when changed), Passkeys (name, added, last used, This Device), Signed In (live sessions), Recent Sign-Ins with the Method, Clock-In Devices link | Change Password; Set Up Two-Step, Change App, New Codes, Turn Off (not while a role they hold requires two-step), how often it asks; Set PIN, Change PIN, Remove PIN; Add Passkey, rename or remove one; Confirm It's You when asked; sign out one device; Sign Out Others; Open My Devices |
| Settings · Users (`users`) | Staff app | `settings` view | Counts, the logins with status, roles and two-step (desktop), Users by Role | Invite User; per login: Save Roles, Resend Invitation, Send Reset Link, Sign Out Everywhere, Reset Two-Step, Suspend, Reactivate |
| People · Employees, the 360 | Staff app | `settings` create | Send Invite on the record header | Invite this employee to sign in |
| The bell and email | Everywhere | The person concerned | Security notices, including every way in added, changed or removed | Read them; they cannot be switched off |

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
9. **Two-step set-up.** My Security → Set Up Two-Step posts `POST /security/two-step/setup`: a new
   key, kept encrypted as pending for 15 minutes, shown as a QR code and as text in groups of four.
   Nothing changes until the first code from the app (`POST /security/two-step`) proves it: two-step
   is on, ten recovery codes are made and shown once (only their hashes are kept), and every browser
   must give a code at its next sign-in. Change App runs the same steps while the old app keeps
   working until the new one is proved (`auth.two_step_changed`).
10. **Signing in with two-step.** When two-step is on and this browser has not given a code within the
    person's chosen time (every sign-in, once a day, once a month; once a day unless they choose),
    `POST /auth/login` and `POST /auth/pin` answer `{ step: "code", challenge_token }` instead of a
    session, and set no cookie. `POST /auth/two-step` takes the ticket with the app's code or a
    recovery code, opens the session (`password_totp` or `pin_totp`) and trusts the browser for that
    time.
11. **The PIN.** Set, changed and removed on My Security. `POST /auth/pin` is the first step on a
    browser this person has signed in on before (the device cookie), and the code follows when
    two-step asks. The lock screen offers the PIN first when there is one.
12. **Passkeys.** Add Passkey posts `POST /security/passkeys/options`, the browser makes the passkey
    with the fingerprint, face or screen lock, and `POST /security/passkeys` checks it and keeps its
    public key, named after the browser. To sign in or unlock, `POST /auth/passkey/options` (bound to
    the email on the lock screen and on a known browser), the browser signs, and `POST /auth/passkey`
    checks it and opens a `passkey` session: both steps at once, so no code.
13. **Fresh sign-in.** Turning two-step on or off, how often it asks, new recovery codes, adding or
    removing a passkey, and setting, changing or removing the PIN need the session to have signed in
    or confirmed in the last 15 minutes. Past that the API answers 403 `REAUTH_REQUIRED`; the screen
    asks Confirm It's You (`POST /security/confirm` with the password, the PIN or a passkey) and runs
    the change again. A form asks before it opens, so its save is not refused.
14. **Reset Two-Step.** Settings · Users → a login → Reset Two-Step (`settings` edit, a fresh sign-in,
    never your own login): the key, the recovery codes and every browser's trust go, every session
    ends, the person and the access watchers are told, and the person sets two-step up again.
15. **Two-step required by role.** Settings · Security marks a role as requiring two-step
    (`role.two_step_required`; `foundation.md` §6.4). When the password or the PIN is right and the
    person holds such a role without two-step on, `POST /auth/login` and `POST /auth/pin` answer
    `{ step: "setup", challenge_token }` and set no cookie. The sign-in card posts
    `POST /auth/two-step/setup` with the ticket for a new key and its QR code, then
    `POST /auth/two-step/enrol` with the app's first code: two-step turns on, the session opens
    (`password_totp` or `pin_totp`, the browser trusted for the person's chosen time) and the ten
    recovery codes come back once, shown before the app opens. The lock screen does not run the
    set-up; it asks the person to sign out and sign in. A passkey is both steps, so it signs in
    without the set-up.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `app_user` | `employee_id` (unique), `email`, `password_hash`, `status`, `is_ceo`, `failed_login_count`, `last_failed_login_at`, `password_changed_at` | One login per employee. An invited login has the hash `!invited` and no `password_changed_at` |
| `user_session` | `user_id`, `refresh_token_hash`, `issued_at`, `expires_at`, `last_seen_at`, `method`, `known_device_id`, `device_label`, `ip_address`, `killed_at`, `end_reason` | `refresh_token_hash` is the hash of the current refresh token's id; idle is `now() - last_seen_at` |
| `known_device` | `user_id`, `fingerprint_hash`, `label`, `platform`, `last_seen_at`, `last_ip` | The device cookie's hash; drives the New Sign-In notice and the greeting |
| `password_reset` | `user_id`, `token_hash`, `purpose` (reset, invite), `expires_at`, `used_at`, `requested_by`, `requested_ip`, `source_event_id` (unique) | Only the hash is stored; one row per requesting event |
| `app_user`, two-step and PIN | `mfa_secret_enc`, `mfa_enrolled_at`, `mfa_frequency`, `mfa_pending_secret_enc`, `mfa_pending_until`, `mfa_last_step`, `pin_hash`, `pin_changed_at`, `pin_failed_count`, `pin_last_failed_at`, `pin_window_started_at`, `pin_window_failures` | The key encrypted (`services/secrets`), the last step accepted so a code works once; the PIN's Argon2id hash and its wrong-try counts. Owned by `security` |
| `mfa_recovery_code` | `user_id`, `code_hash`, `used_at` | Ten per person, Argon2id, each used once; a new set replaces the old |
| `passkey` | `user_id`, `credential_id` (unique), `public_key`, `sign_count`, `transports`, `backed_up`, `label`, `known_device_id`, `last_used_at` | Never the private key; the browser it was added on marks This Device |
| `spent_challenge` | `challenge_hash` (unique), `purpose`, `user_id`, `expires_at` | Each ticket between steps works once; rows a day past expiry are pruned |
| `known_device.mfa_trusted_until`, `user_session.reauthenticated_at` | | How long a browser may skip the code; when the session last confirmed it was the person |
| `role`, `user_role`, `role_permission` | `role.code`, `home_view`, `rank` | Seven roles (§8); the grants matrix |

Schema migrations: `migrations/0200_identity_sessions.sql`, `migrations/0220_sign_in_methods.sql`
(two-step, the PIN, passkeys; `user_session.method` gains `pin_totp`). Reference data:
`seeds/reference/0290_seed_roles_and_grants.sql`.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | `LoginBody` → `SignInResult` | anonymous | | A session (sets the refresh and device cookies), the code step, or the set-up step when a role requires two-step (§3 step 15); 10 failures per address in 15 minutes |
| `POST /api/v1/auth/two-step` | `CodeStep` → `Session` | anonymous, the code step's ticket | | 401 `INVALID_CODE`, counted with the password; 400 `CHALLENGE_USED`; 10 failures per address |
| `POST /api/v1/auth/two-step/setup` | `SetupStart` → `TwoStepSetup` | anonymous, the set-up step's ticket | | The new key and its QR code; 400 `CHALLENGE_EXPIRED`; 10 failures per address |
| `POST /api/v1/auth/two-step/enrol` | `SetupFinish` → `EnrolledSession` | anonymous, the set-up step's ticket | | Turns two-step on and opens the session with the recovery codes; 401 `INVALID_CODE`; the ticket works once |
| `POST /api/v1/auth/pin` | `PinSignIn` → `SignInResult` | anonymous, device cookie | | 401 `PIN_UNAVAILABLE` off a known browser; 429 `PIN_THROTTLED`; 10 failures per address |
| `POST /api/v1/auth/passkey/options` | `PasskeyStart` → `PasskeyChallenge` | anonymous | | Optional email binds it to that person; 60 per address in 15 minutes |
| `POST /api/v1/auth/passkey` | `PasskeySignIn` → `Session` | anonymous | | 401 `PASSKEY_UNKNOWN`, `PASSKEY_NOT_YOURS`, `PASSKEY_FAILED` |
| `POST /api/v1/auth/refresh` | `EmptyBody` → `SessionTokens` | anonymous, refresh cookie | | Rotates the cookie |
| `POST /api/v1/auth/logout` | `LogoutBody` → 204 | anonymous | | `reason: idle` records `inactivity_timeout` |
| `GET /api/v1/auth/device` | → `DeviceAccount` | anonymous, device cookie | | Who last signed in on this browser |
| `POST /api/v1/auth/forgot` | `ForgotBody` → `Accepted` | anonymous | | Same answer for every email; 5 per address in 15 minutes |
| `POST /api/v1/auth/link` | `LinkCheckBody` → `LinkCheck` | anonymous | | 404 `LINK_INVALID` when expired or spent |
| `POST /api/v1/auth/reset` | `ResetBody` → `ResetDone` | anonymous | | Sets the password, ends every session |
| `GET /api/v1/auth/me` | → `Me` | own account | | `grants` per module, and `capabilities`: the codes the person holds through a role or directly, A to Z (the CEO's are every code in `capability`), the same the routes check (README §5.2). Every session response carries the same `Me` |
| `GET /api/v1/auth/security` | → `SecuritySummary` | own account | | |
| `POST /api/v1/auth/password` | `PasswordChange` → `PasswordChanged` | own account | | 10 per person in 15 minutes |
| `GET /api/v1/auth/sessions` | `SignInListQuery` → `SignInPage` | own account | yes, 25 | Filter `status` (active, ended); sort `issued_at` |
| `POST /api/v1/auth/sessions/end-others` | `EmptyBody` → `SessionsEnded` | own account | | |
| `POST /api/v1/auth/sessions/:id/end` | `EmptyBody` → 204 | own account | | 422 for the current session |
| `GET /api/v1/security` | → `SignInMethods` | own account | | Two-step, passkeys, PIN, and `confirmed_for` (seconds of the window left) |
| `POST /api/v1/security/confirm/options`, `/confirm` | `EmptyBody` → `PasskeyChallenge`; `Confirm` → `Confirmed` | own account | | 10 per person in 15 minutes |
| `POST /api/v1/security/two-step/setup` | `EmptyBody` → `TwoStepSetup` | own account, fresh | | |
| `POST /api/v1/security/two-step` | `TwoStepTurnOn` → `RecoveryCodes` | own account | | 422 `INVALID_CODE`, `SETUP_EXPIRED` |
| `POST /api/v1/security/two-step/off`, `/recovery-codes`, `/frequency` | `EmptyBody`, `EmptyBody`, `TwoStepFrequencySet` → `SignInMethods` or `RecoveryCodes` | own account, fresh | | Off: 422 `TWO_STEP_REQUIRED` while a role the person holds requires it |
| `GET /api/v1/security/passkeys` | `PageQuery` → `PasskeyPage` | own account | yes, 25 | Newest first |
| `POST /api/v1/security/passkeys/options`, `/passkeys` | `EmptyBody` → `PasskeyChallenge`; `PasskeyAdd` → `Passkey` (201) | own account; the options fresh | | 422 `PASSKEY_LIMIT` at 10; 409 `PASSKEY_TAKEN` |
| `POST /api/v1/security/passkeys/:id/rename`, `/remove` | `PasskeyRename` → `Passkey`; `EmptyBody` → `SignInMethods` | own account; remove fresh | | |
| `POST /api/v1/security/pin`, `/pin/remove` | `PinSet` → `SignInMethods`; `EmptyBody` → `SignInMethods` | own account, fresh | | 422 `WEAK_PIN` (the birthday is the server's check) |
| `GET /api/v1/users` | `UserListQuery` → `UserPage` | `settings` view | yes, 25 | Filters `status`, `role`; sort `display_name`, `last_seen_at`, `created_at` |
| `GET /api/v1/users/summary` | → `UsersSummary` | `settings` view | | |
| `GET /api/v1/users/candidates` | `CandidateListQuery` → `CandidatePage` | `settings` view | yes, 25 | Employees with no login |
| `POST /api/v1/users` | `UserInvite` → `UserRow` | `settings` create | | |
| `GET /api/v1/users/:id` | → `UserRow` | `settings` view | | |
| `POST /api/v1/users/:id/invite`, `/reset-link` | `EmptyBody` → `LinkSent` | `settings` edit | | |
| `POST /api/v1/users/:id/roles` | `UserRolesSet` → `UserRow` | `settings` edit | | |
| `POST /api/v1/users/:id/suspend`, `/reactivate` | `UserSuspend`, `EmptyBody` → `UserRow` | `settings` edit | | Never on your own login |
| `POST /api/v1/users/:id/end-sessions` | `EmptyBody` → `UserSessionsEnded` | `settings` edit | | |
| `POST /api/v1/users/:id/reset-two-step` | `EmptyBody` → `UserRow` | `settings` edit, fresh | | Never your own login; 422 `TWO_STEP_OFF` |
| `GET /api/v1/access/roles` | `RoleListQuery` → `RolePage` | `settings` view | yes, 25 | Sort `rank`, `name` |

Schemas: `packages/contract/schemas/identity.js`, `security.js`, `users.js`, `access.js`. "Fresh"
means signed in or confirmed in the last 15 minutes (§6); past it the answer is 403
`REAUTH_REQUIRED`, never a 401, which the app would read as an ended session.

## 6 · Rules and calculations

**Sessions** (`identity.session-policy.js`; `SESSION_MAX_AGE_MIN` 120, `SESSION_INACTIVITY_MIN`
30, `ACCESS_TOKEN_MIN` 15). The two `.env` limits are the floor: Settings · Security can shorten
either, never lengthen it (`foundation.md` §6.4); the minutes below are the defaults.

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

- At least 8 characters, with a lowercase letter, an uppercase letter, a number and a symbol. Settings ·
  Security can ask for more characters (`security.password_min_length`, never below
  `PASSWORD_MIN_LENGTH`); it applies to the next password each person chooses.
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

**Two-step sign-in** (`security.mfa.js`, `security.signin.js`):

- Codes are RFC 6238: HMAC-SHA-1 over 30-second steps, six digits, the key 20 random bytes in base32,
  on `node:crypto` (checked against the RFC's test vectors). One step either side of now counts.
- Each step is accepted once (`mfa_last_step`), so a code seen over a shoulder is already spent.
- A wrong code counts with the wrong passwords (the same wait, and the sixth tells the person, "Several
  wrong codes on your account"): whoever types it has the password.
- How often a browser is asked: `every_sign_in`, `daily` (the default) or `monthly`, per browser
  (`known_device.mfa_trusted_until`). Changing the rule, turning two-step on or moving to a new app
  asks every browser again.
- Recovery codes: ten, of ten characters from letters and numbers nobody misreads (no 0, O, 1, I or
  L), shown once as XXXXX-XXXXX; case, spaces and the dash do not matter when typed. Argon2id, each
  used once; using one tells the person how many are left.
- The set-up key waits 15 minutes for its first code; until then nothing changes.
- The ticket between the first step and the code lasts 5 minutes and works once (`spent_challenge`);
  it is signed like the tokens but cannot be used as one.
- Required by role: any role the person holds with `two_step_required` makes two-step required for
  them. The set-up ticket at sign-in (`two_step_setup`) lasts 15 minutes, the set-up key's own life,
  and is spent when two-step turns on. While it is required the person cannot turn two-step off; an
  administrator's Reset Two-Step still can, and the next sign-in asks for the set-up again.

**Passkeys** (`security.passkeys.js`, `@simplewebauthn/server`):

- The fingerprint, face or screen lock is required at creation and at every use (user verification
  required). A passkey is both steps, so two-step does not ask for a code after it.
- The relying party and origin come from `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` (hub.mycityapp.io,
  hub.staging.mycityapp.io), never from the request; empty, they are the host of `STAFF_ORIGIN`.
  Servers refuse an origin that is not https, or an ID the origin does not sit under.
- Discoverable passkeys: signing in names no passkeys, so the options say nothing about who has one.
  On the lock screen and a known browser the options are bound to the email, and another person's
  passkey is refused.
- The signature counter must rise; a passkey synced by a password manager reports 0 and is allowed.
  The same device cannot add a second passkey for the same person. At most 10 per person.

**The PIN** (`security.pin.js`, `weakPinReason` in the contract):

- Four digits, Argon2id. Refused: one digit repeated, a run (1234, 9876), a repeated pair (1212), two
  doubles (1122), the most common PINs, and the person's birthday (DDMM, MMDD, the year), which only
  the server knows.
- It signs in only on a browser this person has signed in on before (the device cookie); anywhere
  else the answer is the same as for no PIN.
- Wrong PINs cost what wrong passwords cost: 5 free, then a doubling wait to 15 minutes (the sixth
  tells the person). 10 wrong in a row, or 20 in 30 days, switch the PIN off and tell the person;
  the password still works.
- `verifyPin` is the one check, for signing in, unlocking and confirming, and for attendance later.

**Fresh sign-in** (`assertFresh`; `CREDENTIAL_ENROL_WINDOW_MIN`, 15): a session may add or remove a
way in for 15 minutes after it signed in or last confirmed (`user_session.reauthenticated_at`).
Renaming a passkey changes no way in and needs no window.

**Reset Two-Step:** an administrator never receives a working factor for anyone: the reset removes
the key, the recovery codes and every browser's trust and ends every session; the person sets
two-step up again.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `auth.signed_in` | A sign-in | Audit; New Sign-In notice (bell and email) when the browser is new and others are known |
| `auth.sign_in_failed` | A wrong password | Audit |
| `auth.sign_in_throttled` | The sixth wrong password in a row | Notice to the person |
| `auth.signed_out`, `auth.session_ended` | Sign-out; a session ended by policy, the person or an administrator | Audit; notice when an administrator ended it. Sign Out Everywhere turns push off on every device of the person; Sign Out Others (`kept_session_id` in its payload) on every device but the one it was pressed on. A plain Sign Out or a session that ends leaves push on (`docs/guides/notifications.md` §6) |
| `auth.password_changed` | Change Password | Notice to the person |
| `auth.link_requested` | Forgot, invite, resend, reset link | Outbox `identity.send_link`: mint the token, store its hash, queue the email (no token in the event, the ledger or a notification) |
| `auth.password_set` | A password chosen from a link | Notice after a reset |
| `app_user.created`, `app_user.suspended`, `app_user.reactivated` | Users actions | Audit (sensitive); suspension turns push off on every device of the person |
| `access.roles_set` | Roles changed | Audit (sensitive); the grants cache is dropped |
| `auth.two_step_started` | A set-up began | Audit |
| `auth.two_step_on`, `auth.two_step_changed`, `auth.two_step_off` | Two-step turned on, moved to a new app, turned off | Notice to the person |
| `auth.two_step_frequency_set` | How often it asks changed | Audit with the rule before and after; notice to the person |
| `auth.recovery_codes_renewed`, `auth.recovery_code_used` | New codes; a code used to sign in | Notice to the person (how many are left) |
| `auth.two_step_reset` | An administrator reset someone's two-step | Audit (sensitive); notice to the person and the access watchers |
| `auth.passkey_added`, `auth.passkey_removed`, `auth.passkey_renamed` | My Security | Notice to the person on added and removed; audit with the label before and after on renamed |
| `auth.pin_set`, `auth.pin_changed`, `auth.pin_removed` | My Security | Notice to the person |
| `auth.pin_failed`, `auth.pin_throttled`, `auth.pin_switched_off` | Wrong PINs | Audit; notice at the sixth in a row and when the PIN is switched off |
| `auth.reauthenticated` | Confirm It's You | Audit, with the way used |

Every `auth.*`, `app_user.*` and `access.*` notice is in the Security category: by email too, and
not something a person can switch off. A way in added, changed or removed tells its owner even when
they did it themselves, with "If this was not you". No key, code, PIN or credential reaches an event
or the audit.

## 8 · Permissions and visibility by role

| Role (`code`) | Sees | Can do |
|---|---|---|
| Implementation Team (`implementation`) | Everything | Everything: every module and action over everything, every capability, every field. For the build team, and training runs from it (TB, 19/10/2026); removed (soft) after handover |
| Operations & People (`operations_people`) | Everything in operations | Users: invite, roles, suspend, reset links |
| Management (`management`) | Everything | Read across modules |
| Head of Department (`head_of_department`) | Their department | Partnerships home |
| System Administrator (`administrator`) | Settings | Users and settings |
| Line Manager (`manager`) | Their team | Approvals for their team |
| Staff (`employee`) | Their own records | Self-service |

The build account (`create-admin --build-account`) holds the Implementation Team role. Until
handover that role is complete: a module, action, capability or masked field added later is given
to it in the same seed, and `tests/integration/settings.test.js` fails a seed that leaves it out.
What is the CEO's own stays the CEO's: a workflow stage addressed to the CEO, withdrawing someone
else's request, and a login that cannot be suspended.

The CEO is a flag on the login (`is_ceo`) and holds every action and every capability. Every person
sees and manages only their own sessions, two-step, passkeys and PIN on My Security (`self` routes:
no grant, only the caller's own login). Reset Two-Step needs `settings` edit and is never on your
own login. Requiring two-step by role is set on Settings · Security (`settings` edit; brought
forward from M9, `foundation.md` §6.4). The exact grants are the seed matrix
(`seeds/reference/0290_seed_roles_and_grants.sql`).

## 9 · AI and search

- **AI reads**: none. Sign-in, sessions, logins, keys, codes, passkeys and the PIN are not something
  the assistant answers (`// ai:none` on the controllers).
- **AI routes**: none in these modules.
- **Search** (`users.search.js`): logins by name and email, opening Settings · Users, for
  `settings` view. A person's own ways in are found on My Security, not searched (`// search:none`
  on the security controller).

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Sign In | The brand, "Every city. One team." and one line on MyCity App; the shown city's country, name, local time and day; the eight cities with their times; the greeting (with the first name on a known browser), Email, Password, Forgot Password, Sign In; Use Passkey and Use PIN on a known browser | None | The session rules, the throttle and why the error never says which emails exist: §6 |
| Code step and PIN | The email or the greeting; Enter Code with "From your authenticator app" or "One of your recovery codes"; Sign-In Code or Recovery Code; Enter PIN and PIN; Sign In, Back, Use Recovery Code or Use App Code, Use Password; the refusal in one line | None | Single use, the drift window, how often a browser is asked, the PIN's wait and switch-off: §6 |
| Set-up step | The email; Set Up Two-Step with "Your role needs a code from an authenticator app."; the QR code and the key; Code From App; Turn On, Back; then Recovery Codes with one line to keep them, the ten codes, Copy Codes, Continue | None | Which roles require it and why: `foundation.md` §6.4 |
| Forgot Password | Reset Password, "We will email you a link.", Email, Send Link, Back; then Check Your Email with the address | None | How long a link lasts and that only an active login gets one: §6 |
| Reset and Welcome | The email (reset) or "Welcome, first name" (invitation); New Password, Confirm Password, Save Password or Set Password; an expired link says so with Request New Link | None | The password rules beyond the field's own mark: §6 |
| Lock screen | Session Locked, Session Ended or Signed Out (Enter Code at the code step); why in one line; the person's photo or initials, name and email; PIN or Password, or Sign-In Code; Sign Out, Use Passkey, Use Password or Use PIN, Use Recovery Code, Unlock | None | The idle and time limits and the server-side end: §3 step 5, §6 |
| ESS · My Security | Password with when it was changed; Two-Step Sign-In with On or Off, Ask for a Code (Every Sign-In, Once a Day, Once a Month), the recovery codes left, Set Up Two-Step, New Codes, Change App, Turn Off; PIN with On or Off and when changed, Set PIN, Change PIN, Remove PIN; Passkeys (Name with This Device, Added, Last Used; Add Passkey; a passkey's sheet with Name, Save Name, Remove Passkey); Signed In (device, address, when; Sign Out per device; Sign Out Others); Recent Sign-Ins (When, Device, Method, Address, Status); Clock-In Devices with Open My Devices. In the set-up: the QR code, the key, one line to scan it, Code From App, Turn On; then the ten codes, one line to keep them, Copy Codes. Confirm It's You: Confirm With, Password or PIN, Confirm or Use Passkey | Two-Step Sign-In and PIN: what each is, behind the card title | Why other sessions end on a password change, the reuse rule, the window, how codes and passkeys are checked: §6 |
| Settings · Users | Users, Active, Invited, Suspended, Signed In Now; the status chips; the list (person, roles, last seen, two-step, status); Users by Role; a login's detail with its actions, Reset Two-Step among them, and its confirmation in one sentence | None | What each role grants: Settings · Roles & Permissions, §8; what a reset removes: §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Sign In | The city's photograph at the top, drifting, with the brand, a glass clock, the city's country, name and day, and a dot per city with the turn filling the shown one; the form in a smoked glass panel under it. Points of light rise behind the glass | The headline, the eight city buttons, the pointer parallax | Sign In, full width | None (signed out) |
| Code step and PIN | The same card as sign-in: the boxes 44 px, the number keyboard; a full code or PIN goes on its own | Nothing | Sign In, full width | None (signed out) |
| Set-up step | The same card: the QR code at 192 px, the key under it, the code boxes; a full code goes on its own | Nothing | Turn On, then Continue, full width | None (signed out) |
| Lock screen | The same card, its buttons full width and stacked: the PIN first when set, Use Passkey (the fingerprint or face) | Nothing | Unlock, full width | None until unlocked |
| ESS · My Security | Icon cards: Password, Two-Step Sign-In, Passkeys, PIN, Signed In, Recent Sign-Ins, Clock-In Devices | The cards and tables (each opens in its sheet; tables as cards) | Change Password, Save PIN, Turn On, full width in their sheets; Add Passkey makes the phone's own passkey | Bottom bar Self-Service |
| Settings · Users | The counts two to a row, the status chips, logins as person cards | Users by Role; the Two-Step column | Invite User; a login's actions in its sheet, stacked | More, Settings |

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
- **Lost phone with two-step on.** A recovery code signs in once; with none left, an administrator's
  Reset Two-Step, after which the person sets it up again.
- **Two requests with the same code or the same passkey answer.** Spending is a guarded update or a
  unique insert in the transaction that opens the session, so one session opens and the other is
  refused.
- **The window passes while a form is open.** Forms that end in a change check the window before they
  open; a change refused anyway opens Confirm It's You and runs again.
- **A passkey cloned or replayed.** A counter that went back is refused; a replayed ticket is spent.
- **The PIN on someone else's browser.** Refused the same way as no PIN: nothing says whether the
  account has one.
- **A PIN switched off after wrong tries.** The lock screen moves to the password and says why.
- **A role made to require two-step while its people are signed in.** Their sessions carry on; the
  next sign-in asks for the set-up; unlocking with the password or the PIN asks them to sign out and
  sign in first.
- **The set-up left half done.** Nothing changes until the first code; after 15 minutes the ticket
  has expired, the card goes back to sign-in and says so, and signing in again starts afresh.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | the session policy (ceiling, idle, rotation with reuse detection, cooldown instead of lockout, refresh cookie) | Settings in `.env`; no tenant; the idle lock ends the session on the server |
| praxis-ls | the device cookie and the new-device notice | A notification in the Security category (bell and email) |
| praxis-ls | two-step sign-in, recovery codes, passkeys (WebAuthn), the fresh-sign-in check (`assertFresh`) | No TOTP library (RFC 6238 on `node:crypto`); recovery codes hashed with Argon2id; passkeys require the fingerprint or face; single-use tickets in a table, not Redis; the PIN and how often two-step asks are new |

## 13 · Open questions

- ~~Two-step sign-in, passkeys and the PIN~~: closed 16/10/2026, built in the second sign-in PR (the
  `security` module, §3 steps 9 to 14, §6). Requiring two-step by role: built 17/10/2026 with
  Settings · Security (§3 step 15, `foundation.md` §6.4).
- ~~The sign-in drawings or licensed photographs~~: closed 17/10/2026. TB supplied photographs of the
  four cities at dusk, then four more (Johannesburg, Rabat, Abidjan, Douala); `CityShowcase` shows
  them, the drawings standing in for the first four until they load.

## 14 · Change log

- 16/10/2026 · TB · First version, with the build: sessions to the donor rules, the lock screen,
  the four-city sign-in screen, Forgot, Reset and Welcome, My Security on the real API, Settings ·
  Users and Send Invite on the employee record.
- 16/10/2026 · TB · Each contract schema names its table for gate 6 (`TABLES` in `identity.js`, `users.js`, `access.js`); the seed `0290` closes the database design's open decision on the role matrix.
- 16/10/2026 · TB · `create-admin --build-account --env=<name>`: the build account's complete employee record is in the script; only the email and password are typed (`docs/runbooks/first-accounts.md`).
- 16/10/2026 · TB · Two-step sign-in, passkeys and the PIN (the `security` module, migration `0220`):
  the code step, PIN and passkey sign-in, the lock screen's PIN, passkey and code, My Security's
  Two-Step Sign-In, PIN and Passkeys cards, Confirm It's You inside the 15-minute window, Reset Two-Step
  on Settings · Users, the Method on Recent Sign-Ins (§2 to §11); §13's open question closed.
- 16/10/2026 · TB · The reset and invitation emails (`templates/email/password-reset.html`, `user-invite.html`) were empty, so the worker failed every link email after the screen said it was sent; both written. The New Sign-In and other security notices now show in the bell on the real API (`notifications` module), opening My Security.
- 17/10/2026 · TB · The sign-in screen shows photographs of Lagos, London, Accra and Nairobi at dusk (`packages/ui/src/illustrations/photos/`, WebP at 1280 and 640): each drifts and zooms slowly on its own path, the lit horizon glows softly, the picture follows the pointer by a few pixels, and cities crossfade with a short focus pull. The drawings stand in while a photograph loads or if it fails; reduced motion and the phone band hold them still. §10 and §13 updated.
- 17/10/2026 · TB · Two-step required by role and the security rules within the `.env` floor, with
  Settings · Security (`foundation.md` track C): sign-in answers the set-up step when a role requires
  two-step that the person has not set up, `POST /auth/two-step/setup` and `/enrol` finish it on the
  sign-in card with the recovery codes, My Security has no Turn Off while it is required, and the
  session length, idle lock and password minimum read the saved rules. Migration `0400` widens
  `spent_challenge`'s purposes; `PASSWORD_MIN_LENGTH` is the new floor. §2, §3, §5, §6, §8, §10, §11
  and §13 updated.
- 17/10/2026 · TB · Four more cities on the sign-in screen: Johannesburg, Rabat, Abidjan and Douala (photographs only; their screen is the deep green until one loads). A photograph is fetched only when its city is shown or next. On a phone the photograph fills the top of the screen behind the brand, a glass clock and the city, and the form sits in a frosted panel in the dark theme's colours; nothing moves but the crossfade. The staging bar is gone from both apps (MILESTONES §6). §10 and §13 updated.
- 17/10/2026 · TB · The sign-in screen made a place to linger, on both shells: the form sits in smoked glass (a Deep Green tint over a blur of the photograph, a brand-yellow thread along the top, a slow sheen), the cities in a glass dock on desktop, a film grain and darkened edges over the photograph, points of city light rising slowly, the city's name arriving out of focus and the clock's colon ticking. The phone moves like the desktop now (drift, glow, focus pull, the lights) but for the pointer parallax; reduced motion holds all of it still. §10 updated.
- 17/10/2026 · TB · §5, §8: `Me` gains `capabilities`, the codes the person holds (every code for
  the CEO), read from the grants cache like `requireCapability`, so the shell and ⌘K gate Home's
  Team, Alerts and Reports tabs on what the API allows (README §5.2). `CapabilityCode` moves from
  `access.js` to `identity.js`, which `access.js` imports. Header gains the Capabilities row.
- 18/10/2026 · TB · `AuthProvider` no longer carries `justSignedIn` and `clearJustSignedIn`: their one reader was the shell's after-sign-in clock-in prompt, which moved to Home · Overview on the server's `prompt_clock_in` (home.md §6, attendance.md change log). Sign-in, the lock and Welcome back are unchanged.
- 19/10/2026 · TB · `Me.manages_people` counts the people under a vacant seat the reader answers for
  (the first person above the seat), as team scope does (`employee_effective_manager`, `1160`;
  `docs/guides/organogram.md` §6), so the manager above an empty post sees My Team and approvals.
- 19/10/2026 · TB · §8: the build account keeps the Implementation Team role, complete (every
  module, action, capability and field), until handover, because training runs from it; what is
  the CEO's own stays the CEO's. A test in `tests/integration/settings.test.js` holds the role to
  the catalogues, so a seed that adds a module, capability or field without it fails.
- 19/10/2026 · TB · §7: Sign Out Others names the session it kept (`kept_session_id`), so push stays on that device and goes off on the others; Sign Out Everywhere and suspension turn push off everywhere (`docs/guides/notifications.md`).

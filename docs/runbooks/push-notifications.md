# Push notifications on staging and production

Web push (`docs/guides/notifications.md`) needs **nothing in `.env`**. Each environment makes its own
key pair (VAPID, RFC 8292) the first time someone turns notifications on, and keeps it in
`integration_secret` (provider `web_push`, key `vapid`), encrypted with `ENCRYPTION_KEY`. This
runbook is what to check after the first deploy that carries push, how to read a device's health,
and how to pin or change the keys. TB decided all of it on 19/10/2026
(`docs/handoff/push-notifications.md` §2).

Commands run on the server as a user with sudo. `<env>` is `prod` or `stg`: the release is in
`/srv/mycity/<env>/current`, its settings in `/srv/mycity/<env>/shared/.env`, its database is
`mycity_prod` or `mycity_stg`, and its units are `mycity-api-<env>` and `mycity-worker-<env>`.

## 1 · What it needs

| | |
|---|---|
| `.env` | Nothing. `VAPID_SUBJECT` defaults to `mailto:jbspraxisllc@gmail.com`. `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are only for pinning a pair (§4): both or neither, or the API and the worker refuse to start |
| `ENCRYPTION_KEY` | The one already set. The stored pair is encrypted with it, so changing it is a key change (§4) |
| Mail | `MAILBOX_IDLE_MAX` unset or empty: 24 inboxes held live on production, 4 on staging (§2) |
| Network | Outbound HTTPS to the browsers' push services: `fcm.googleapis.com` (Chrome and Android), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari, iPhone and iPad), `*.notify.windows.com` (Edge on Windows). `ufw` only limits what comes in, so nothing is needed |
| nginx | Nothing. The API serves `/sw.js` with `Cache-Control: no-cache` (`src/http/static.js`), so a new service worker reaches every installed app on its next start |

## 2 · After the first deploy that carries push

1. **Mail is live on both.** Neither `.env` may pin `MAILBOX_IDLE_MAX` to 0:

   ```sh
   sudo grep -n MAILBOX_IDLE_MAX /srv/mycity/prod/shared/.env /srv/mycity/stg/shared/.env
   ```

   No line, or `MAILBOX_IDLE_MAX=` with nothing after it, is right. A `0` turns live mail off: delete
   the line and `sudo systemctl restart mycity-worker-<env>`. A number set by hand keeps production
   and staging together at 30 or under, the mail host's limit for one IP address
   (`docs/guides/mailbox.md` §6).

2. **The keys.** Once someone has turned notifications on (TB's phone check, handoff §7), the pair is
   there:

   ```sh
   sudo -u postgres psql mycity_<env> -c \
     "SELECT provider, key, active, created_at FROM integration_secret WHERE provider = 'web_push'"
   sudo journalctl -u mycity-api-<env> -g "web push keys"
   ```

   One row, `web_push | vapid | t`. The journal shows `web push keys made for this environment`
   with its `key_id` once, and never `web push keys unavailable`. To make the pair before anyone
   turns notifications on, ask the release itself (it prints where the pair came from and its id,
   never the private half):

   ```sh
   cd /srv/mycity/<env>/current
   sudo -u mycity-<env> node --env-file=/srv/mycity/<env>/shared/.env -e '
     require("./src/services/push/vapid").keys()
       .then((k) => console.log(k.source, k.keyId))
       .finally(() => require("./src/config/db").pool.end())'
   ```

3. **A device.** After a Turn On and a Send Test from the app (bell, gear, This Device):

   ```sh
   sudo -u postgres psql mycity_<env> -c "SELECT label, platform, last_success_at, failure_count,
     last_error, revoked_reason FROM push_subscription ORDER BY updated_at DESC LIMIT 10"
   ```

   The device has `last_success_at` set and `failure_count` 0.

## 3 · Reading delivery

Every push to every device is one `push_delivery` row (the test pushes have no `notification_id`):

```sh
sudo -u postgres psql mycity_<env> -c "SELECT status, http_status, left(error, 80) AS error, count(*)
  FROM push_delivery WHERE created_at > now() - interval '1 day' GROUP BY 1, 2, 3 ORDER BY 4 DESC"
```

| Status | Means | Action |
|---|---|---|
| `sent` | The push service took it | None |
| `skipped_read` | Read before its held minute was up (the person was in front of the app) | None |
| `gone` | The push service refused the subscription for good: 404 or 410 (the browser dropped it), 401 or 403 (made under another key, §4). The device is turned off with `revoked_reason` `refused` | None: the app subscribes again on its next start |
| `failed` | 429, a 5xx or no answer. The `notification-push` job tries again with backoff for about 20 minutes | Many in a row for one service: is the server's outbound HTTPS working (§1)? |

A device stops for these reasons, in `push_subscription.revoked_reason`: `turned_off` (Turn Off, or
removed from Other Devices), `refused` (above), `moved` (the browser's new subscription was already
saved as another row, which carries on), `signed_out` (Sign Out Everywhere in Settings · Users; Sign Out Others in My Security, which keeps
the device it was pressed on), `suspended`, `left`. A session that ends, one session an
administrator ends, or a plain Sign Out does not stop it.

## 4 · Pinning or changing the keys

Changing the pair (pinning a new one, deleting the stored one, or changing `ENCRYPTION_KEY`) makes
every browser's subscription stale. Pushes to them are refused (401 or 403) and turned off, and each
app subscribes again with the new key on its next start, by itself and without asking. Pushes to a
phone whose app is not opened again stop until it is.

- **Pin a pair** (to keep it outside the database, or to give it to a second server): make one with
  the release's own tool, put both halves in that environment's `.env`, restart both units.

  ```sh
  cd /srv/mycity/<env>/current && node_modules/.bin/web-push generate-vapid-keys
  sudoedit /srv/mycity/<env>/shared/.env     # VAPID_PUBLIC_KEY=... and VAPID_PRIVATE_KEY=...
  sudo systemctl restart mycity-api-<env> mycity-worker-<env>
  ```

  `.env` wins over the stored pair; the stored row stays unused.

- **Make a new stored pair** (the private half may have leaked): delete the row, restart both units,
  then make it again with step 2 of §2 (or let the next app start do it).

  ```sh
  sudo -u postgres psql mycity_<env> -c \
    "DELETE FROM integration_secret WHERE provider = 'web_push' AND key = 'vapid'"
  sudo systemctl restart mycity-api-<env> mycity-worker-<env>
  ```

- **`ENCRYPTION_KEY` changed** (`docs/runbooks/incident.md`): the stored pair can no longer be read,
  the journal says `web push keys unavailable` and This Device reads Not Available. Make a new stored
  pair as above.

Both units cache the pair for as long as they run, so a change is always followed by restarting both.

## 5 · When something is wrong

| What someone sees | Look at | Usually |
|---|---|---|
| This Device reads Not Available | `journalctl -u mycity-api-<env> -g "web push"` | The pair cannot be read: §4, `ENCRYPTION_KEY` changed |
| This Device reads Blocked | Nothing on the server | Notifications are blocked in that browser's site settings; only the person can allow them |
| This Device reads Install First | Nothing on the server | An iPhone or iPad in Safari: iOS pushes only to an installed app (Share, Add to Home Screen) |
| Send Test says sent, nothing arrives | §3 for that device | `gone`: it subscribes again on its next start. `failed`: the push service or the network |
| Mail arrives in the app minutes late | §2 step 1, then `journalctl -u mycity-worker-<env> -g "mail idle"` | `MAILBOX_IDLE_MAX=0` in `.env`, or more connected mailboxes than it allows (the rest are synced every 2 minutes) |
| A notification appears twice | Nothing on the server | Should not happen: the app on screen shows the banner and the device's own notification is held back. Report it with the phone's make and browser |

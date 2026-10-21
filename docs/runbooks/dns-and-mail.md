# MyCity App · DNS and mail request

For the person who manages **mycityapp.io** (Namecheap hosting, cPanel). Three parts: the records to
add, two checks, and the mail details we need back.

## 1 · DNS records to add

cPanel → **Zone Editor** → mycityapp.io → **Add Record**. Add these four. **Do not change or delete
any existing record** (the main website, MX, SPF, DMARC, DKIM).

| Name | Type | Value | TTL |
|---|---|---|---|
| hub | A | 108.181.196.53 | 14400 |
| go | A | 108.181.196.53 | 14400 |
| hub.staging | A | 108.181.196.53 | 14400 |
| go.staging | A | 108.181.196.53 | 14400 |

Do **not** add a CAA record: it could stop the main website's own certificate from renewing.

## 2 · Mail checks

cPanel → **Email Deliverability** → mycityapp.io:

- [ ] **SPF** shows **Valid**. Today's record is
  `v=spf1 +a +mx +ip4:198.54.114.120 +ip4:198.54.114.248 include:spf.web-hosting.com ~all`; leave it.
- [ ] **DKIM** shows **Valid**. If not, click **Install the suggested record**.
- [ ] **DMARC** exists (today `v=DMARC1; p=none;`); leave it.

The app sends mail through the Namecheap mail server, not from 108.181.196.53, so no mail record
needs the new server's address.

## 3 · Mail details we need back

cPanel → **Email Accounts** → **Create** `no-reply@mycityapp.io` with a strong password. The app
sends its system mail (password resets, approvals, notifications) from it.

Then **Connect Devices** for that account, **Mail Client Manual Settings**, and send us:

| Detail | Example |
|---|---|
| Outgoing (SMTP) server | `mail.mycityapp.io` or `server123.web-hosting.com` |
| SMTP port (SSL/TLS) | `465` |
| Username | `no-reply@mycityapp.io` |
| Password | sent separately, not in the same message |
| Incoming (IMAP) server and port | `mail.mycityapp.io`, `993` (for staff mailboxes in the app) |
| Hourly sending limit on the hosting plan | from Namecheap, if known |

Staff mailboxes need nothing extra: each person signs in to the app's Mailbox with the address and
password they already use for webmail.

## 4 · What came back (16/10/2026)

| Detail | Value | Where it goes |
|---|---|---|
| SMTP server | `mycityapp.io`, port `465`, TLS from the first byte | `SMTP_HOST=mycityapp.io`, `SMTP_PORT=465`, `SMTP_SECURE=true` |
| SMTP username | `no-reply@mycityapp.io` | `SMTP_USER`; the password on Settings · Integrations (encrypted) or in the server's `.env` files |
| IMAP server | `mycityapp.io`, port `993` | the Mailbox module's connection defaults |
| Certificate name | `mycityapp.io` | the host must be exactly that: `mail.mycityapp.io` fails the certificate check |
| Sending limit | **50 recipients an hour** | `MAIL_SEND_PER_HOUR`: production 40, staging 10 (both send from `no-reply`) |
| IMAP connections | **30 at once from one IP address** | the Mailbox module's limit (guide `mailbox.md` §6); prod and staging share the server's IP |
| Mailboxes on the plan | **30** | at most 30 staff mailboxes; more needs a bigger plan |
| MX | `mx1-hosting`, `mx2-hosting`, `mx3-hosting.jellyfish.systems`: Namecheap's spam filter, which hands mail back to the mailboxes on `mycityapp.io` | `SMTP_LOCAL_DOMAINS=mycityapp.io` (the default): system mail to staff is delivered on the host, not refused by the route check (foundation guide §6.14) |

System mail is paced to the limit (`src/services/mail/pace.js`): a batch larger than the hour's
allowance (payslips for every employee, a round of invitations) goes out over several hours instead
of being refused. Still to ask the domain manager: is the 50 for each mailbox, or for the whole
hosting account? If it is the whole account, staff sending from their own mailboxes eats into the
same 50, and the plan is too small for an office of 30.

**Where these go (20/10/2026).** On Settings · Integrations, on each environment
(`docs/guides/integrations.md`): System Sender, Server `mycityapp.io`, Port `465`, Security TLS,
Username `no-reply@mycityapp.io` and its password, From, Hourly Limit `40` (production) or `10`
(staging), Local Domains `mycityapp.io`; Staff Mail Server, the IMAP and SMTP hosts and ports above
(blank uses each address's own domain, which is the same here). Saved there they are tested before
they are kept, win over the `.env` lines and apply within a second, with no restart. The `.env`
lines in the table stay as the fallback when nothing is saved; a server no longer refuses to start
without them: with neither, system mail is held (not lost) until a sender is set, and goes out the
moment one is saved.

## 5 · Paused mail and refused addresses (21/10/2026)

**Pause Mail** (Settings · Integrations → System Sender, IT only; `docs/guides/integrations.md`
§6.15). Press it on each environment. Until Resume Mail only invitations, password resets, Send Test
Email and the server's health alarm are sent; notices reach people by push and the bell, digests are
dropped, other mail waits. Staff sending from Mailbox is not affected. Settings · Status reads Mail
as Paused.

**After the hosting upgrade** (Stellar Business, 10,000 an hour): on each environment, System Sender
→ Edit Settings → Hourly Limit (production and staging together at most the plan's limit), Save
Settings, then Resume Mail. When the sender is still read from the server file, the first save asks
for its password: `sudo grep '^SMTP_PASSWORD=' /srv/mycity/<env>/shared/.env`.

**A refused address** (cPanel's 550, "The mail server could not deliver mail to … The account or
domain may not exist") is listed on the System Sender as a Refused Address and not tried again
(§6.16). Mail between `mycityapp.io` addresses is delivered on the host itself, so:

| The address | Cure |
|---|---|
| `name@mycityapp.io` | cPanel → Email Accounts → Create the mailbox (or Forwarders, to send it on), or correct the work email in People |
| Another domain | A typo (`gmial.com`) or a domain that takes no mail: correct the work email in People |

A login's sign-in email is fixed when the login is made, so a wrong one is corrected on the server,
in one transaction with the employee's work email, as `administrator`:

```sh
sudo -u postgres psql -d mycity_<stg|prod> -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE employee SET work_email = 'right@example.com', updated_at = now() WHERE work_email = 'wrong@exmaple.com';
UPDATE app_user SET email = 'right@example.com', updated_at = now() WHERE email = 'wrong@exmaple.com';
COMMIT;
SQL
```

Each UPDATE should say `UPDATE 1`. Then Resend Invitation on Settings · Users. The change has no
audit row, because it does not go through the app.


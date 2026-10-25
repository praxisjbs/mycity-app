---
title: Settings
module: settings
milestones: M0, M9
summary: How the hub is set up: the company, logins, roles, approvals, notifications and the system's health.
icon: cog
---

Settings is where the hub is set up for everyone. You only see the tabs your role opens: most people
see none, Operations and People see most of them, and the IT team sees Status, Performance, Faults
and Integrations. Management sees every tab but cannot change anything.

A change here applies to everyone at once. Some changes ask you to confirm it is you first: type
your password or PIN in **Confirm It's You** and press **Confirm**.

## Organisation {#settings-organisation screen=settings/organisation icon=building}

The company's details, its brand files, its public holidays and its working week.

![Settings, Organisation](shot:settings-organisation)

### Edit the company's details {#settings-organisation-profile needs="settings edit"}

1. Open [Settings · Organisation](/settings?tab=organisation) and press **Edit Profile**.
2. Fill in **Legal Name**, **Trading Name**, **RC Number**, **Tax ID**, **Phone**, **Email** and
   **Website**. Every field is optional.
3. For **Address**, start typing and pick the address from the list, or pin it on the map. An
   address is always picked, never typed freely.
4. Press **Save Profile**.

### Change the logo {#settings-organisation-brand needs="settings edit"}

The **Brand** card holds the **Logo**, the **White Logo** (shown on dark green) and the **Icon**.
Letters, signatures and the hub's own mail use them at once.

1. Press **Upload Logo**, **Upload White Logo** or **Upload Icon**.
2. Choose a PNG or WebP file with a clear background, up to 5 MB.
3. **Remove** takes a file off.

### Add a public holiday {#settings-organisation-holiday needs="settings create"}

1. Under **Public Holidays**, press **New Holiday** at the top of the page.
2. Choose the **Date** and type the **Name**, such as `Independence Day`.
3. Press **Add Holiday**.
4. A holiday the government has not declared yet shows as **Expected**. When it is declared, open
   it, correct the date if it moved, and press **Confirm Holiday**. It then reads **Declared**.
5. {needs="settings delete"} To remove one, open it and press **Delete Holiday**.

### Set the working week {#settings-organisation-week needs="settings edit"}

Attendance, leave and every deadline count working days from the working week.

1. Under **Working Week**, press **Edit Week**.
2. Switch each day on or off, and set its **Start** and **End**.
3. Press **Save Week**.

## Status {#settings-status screen=settings/status icon=chart}

Status is the IT team's view of whether every part of the hub is working. It refreshes itself every
30 seconds.

![Settings, Status](shot:settings-status)

- The pill at the top reads **All Up**, **Degraded** or **Unavailable**.
- **Checks** lists every check that is not up. **Show All** lists every one. Each reads **Up**,
  **Degraded** or **Down**, says since when, and **Where to Look** says what it means.
- Press **Open** on a check for its detail, its jobs or queues, and its changes this week.
- {needs="system_health export"} **Download Brief** saves one file describing the whole system,
  problems first, to hand to whoever fixes it.

## Performance {#settings-performance screen=settings/performance icon=chart}

How fast the hub answers, how often it fails, and how busy the server is, against MyCity's targets.

![Settings, Performance](shot:settings-performance)

1. Choose the **Window**: **Hour**, **Day**, **Week** or **Month**.
2. The cards **Availability**, **Response Time**, **Failed Requests** and **Requests** turn red when
   a target is missed.
3. **Processor**, **Memory**, **Disk** and **Network** show the server itself.
4. Under the charts, **Slowest Routes**, **Database**, **Background Work** and **Processes** show
   where time goes.
5. {needs="system_health edit"} **Edit Targets** sets the targets and the warning levels. Press
   **Save Targets**.

## Faults {#settings-faults screen=settings/faults icon=alert}

Every error the hub reports, grouped, with how often it happened and how many people it reached.

![Settings, Faults](shot:settings-faults)

### Work through the faults {#settings-faults-work needs="system_health edit"}

1. Open [Settings · Faults](/settings?tab=faults). It lists what is **Open** or **Being Handled**.
2. Press a fault to read it: where it happened, how often, and the latest message.
3. Press **Take It On** when you start on it, so others know.
4. Write what you found in **Note**, then press **Mark Fixed** once it is fixed, or **Ignore Fault**
   if it needs nothing.
5. A fixed fault that happens again comes back marked **Came Back**.
6. {needs="system_health export"} Tick several faults and press **Download Brief** for one file
   about them all.

## Users {#settings-users screen=settings/users icon=user}

Every login to the hub: who can sign in, with which roles, and whether they have set their password.

![Settings, Users](shot:settings-users)

### Read the list {#settings-users-read}

- The tiles count **Users**, **Signed In Now**, **Invited** and **Suspended**.
- **Status** reads **Active** (signs in), **Invited** (has not chosen a password yet), **Not Sent**
  (invited, but no email has gone yet), **Suspended**, or **Left** (their employee record is
  archived).
- Search by name or email, or press **Everyone**, **Active**, **Invited** or **Suspended**.
- Press a person to open their login.

### Give someone a login {#settings-users-invite needs="settings create"}

1. Press **Invite User**.
2. Pick the **Employee**. Only active staff with no login are listed.
3. Pick their **Roles**. **Staff** is already picked.
4. Press **Send Invitation**. They get an email with a link to choose their password. It works once,
   for 72 hours.

> **Tip:** Logins made from MyCity's staff list show **Not Sent**. Press **Invite All Pending** to
> email every one of them at once.

### Help someone with their login {#settings-users-help needs="settings edit"}

Open the person's login, then:

- **Send Invitation** or **Resend Invitation** emails a new link to someone who has not chosen a
  password. The old link stops working.
- **Send Reset Link** emails a link to choose a new password, for someone who forgot theirs.
- **Sign Out Everywhere** ends every session they have, on every device.
- **Reset Two-Step** makes them set up their authenticator app again, for a lost phone.
- When their sign-in email differs from their record, a bar says so. **Use Work Email** moves their
  login to the record's email. They are signed out and both addresses are told.

### Change someone's roles {#settings-users-roles needs="settings edit"}

1. Open the person's login.
2. Add or remove roles under **Roles**.
3. Press **Save Roles**. Their new access applies at once.

You cannot change your own roles here. Ask another administrator.

### Suspend or reactivate a login {#settings-users-suspend needs="settings edit"}

1. Open the person's login and press **Suspend**.
2. Type the **Reason**, such as `Left the company`, and press **Confirm Suspend**. Every session they
   have ends at once.
3. To let them back in, open the login and press **Reactivate**.

A login that reads **Left** reopens with **Reactivate** once their employee record has been
restored on [People · Employees](/people?tab=employees).

## Roles & Permissions {#settings-roles screen=settings/roles-and-permissions icon=shield}

A role decides which modules its holders open, how much they can do there, and over whose records.
Everyone gets their access from their roles.

![Settings, Roles & Permissions](shot:settings-roles)

### Read a role {#settings-roles-read}

1. Open [Settings · Roles & Permissions](/settings?tab=roles-and-permissions) and pick a role.
2. **Access** shows each module's level: **No Access**, **View**, **Add**, **Edit** or **Full**,
   over **All**, **Team** or **Own** records, and whether its holders **Approve** or **Export**.
3. **Details** shows what the role is for, the **Sensitive Fields** its holders see (pay, bank,
   personal details, tax numbers), and its **Capabilities**.
4. **People** lists who holds it.
5. On a computer, **Matrix** shows every role against every module at once.

### Create a role {#settings-roles-create needs="settings create"}

1. Press **New Role**.
2. Type the **Role Name**. To start from an existing role, pick it in **Start From**. Press
   **Next**.
3. For each module, set the level and the records, and tick **Approve** or **Export** if needed.
   Press **Next**.
4. On **Details**, say **What It Is For**, choose its **Home** view, tick the **Sensitive Fields** it
   may see and the **Capabilities** it holds. Press **Review Role**.
5. Check the list of what it gains, then press **Create Role**.

### Change or delete a role {#settings-roles-edit needs="settings edit"}

1. Pick the role and press **Edit Role**.
2. Make the changes and press **Save Role**.
3. The review lists every change and how many people it reaches. Press **Save Role** again.
4. {needs="settings delete"} **Delete Role** removes a role you made. Give its holders another role
   first.

> **Important:** The hub refuses a change that would take away your own access to Settings, so you
> can never lock yourself out.

## Approvals {#settings-approvals screen=settings/approvals icon=ticks}

Who decides each kind of request, in which order, and how long each has.

![Settings, Approvals](shot:settings-approvals)

### Change who approves {#settings-approvals-edit needs="settings edit"}

1. Open [Settings · Approvals](/settings?tab=approvals) and press a flow, such as Leave Request.
2. Each stage shows its **Approver**, when it **Applies When**, and its **Time Limit**.
3. Press **Edit Stages**.
4. Press **Add Stage**, or the pencil beside a stage to change it. Choose the **Approver**:
   **Line Manager**, a **Role**, a **Person** or the **CEO**. Optionally limit it with
   **Applies When**, and set the **Time Limit, Hours**. Press **Update Stage** or **Add Stage**.
5. The arrows move a stage up or down.
6. Press **Save Stages**. It becomes the flow's next version. Requests already open keep the version
   they started on.

## Notifications {#settings-notifications screen=settings/notifications icon=bell}

Who is told about each event, how, and how urgently, and the reminders everyone gets. Each person
still chooses their own channels and quiet hours under the bell's **Notification Settings**.

![Settings, Notifications](shot:settings-notifications)

### Set the reminders {#settings-notifications-reminders needs="settings edit"}

1. Under **Reminders**, press **Edit Reminders**.
2. Switch on **Approvals Waiting** and say every how many hours, **Probation Ending** and how many
   days ahead, and the **Daily Digest** and its time.
3. Press **Save Reminders**.

### Change a notice {#settings-notifications-notice needs="settings edit"}

1. Find the notice by name, or choose its **Category**.
2. Press the notice.
3. Switch it **On** or off, choose its **Level** (**Normal**, **Important** or **Urgent**), and its
   channels: **In App**, **Email** and **Push**.
4. For a notice about someone else, **Add Roles** and **Add People** send copies to more people.
5. Press **Save Notice**. **Reset to Default** puts it back as it came.

Security notices are **Always On** and cannot be switched off.

## Appearance {#settings-appearance screen=settings/appearance icon=sun}

The hub's dark theme, its fonts, and the theme and density everyone starts with.

![Settings, Appearance](shot:settings-appearance)

### Change the look {#settings-appearance-change needs="settings edit"}

1. Under **Dark Theme**, pick a preset, or type the four colours. **Preview** shows the result as
   you go, and **Contrast** checks every colour stays readable.
2. Press **Save Palette**. **Restore Previous** goes back to the last palette.
3. Under **Fonts**, pick the **Heading Font** and **Body Font** and press **Save Fonts**.
4. Under **Defaults**, choose the **Theme for Everyone** and **Density for Everyone**. They save as
   soon as you pick them, for anyone who has not chosen their own.

## Documents & Numbering {#settings-numbering screen=settings/documents-and-numbering icon=doc}

How each document is numbered: staff numbers, expense requests, payslips and the rest.

![Settings, Documents & Numbering](shot:settings-numbering)

### Change a numbering scheme {#settings-numbering-edit needs="settings edit"}

1. Press the document, such as Staff Number.
2. Set the **Prefix** (such as `EXP`), the **Digits**, the **Separator**, and when it **Starts
   Again**: **Never**, **Each Year** or **Each Month**.
3. The line at the top shows the next number as it will look.
4. Press **Save Numbering**. It applies to the next number. A number already given never changes.

## Integrations {#settings-integrations screen=settings/integrations icon=link}

The services the hub uses: the mail server, maps and addresses, the AI providers, exchange rates and
push notifications. This tab is the IT team's.

![Settings, Integrations](shot:settings-integrations)

### Check a connection {#settings-integrations-check}

- Each connection reads **Working**, **Failing**, **Not Checked** or **Not Set Up**. A failing one
  says why, such as **Password refused** or **Key refused**.
- {needs="integrations edit"} Press **Test** to check it now.
- Press a connection for its settings, its last test step by step, and its use this week.

### Change a connection's settings {#settings-integrations-edit needs="integrations edit"}

1. Press the connection, then **Edit Settings**.
2. Fill in what it needs: the server and password for mail, or the **API Key**, **Plan** and
   **Daily Limit** for the others. A saved key shows **Saved**; press **Replace** to type a new
   one.
3. Press **Save Settings**. The hub tests them before saving and marks the field at fault if they
   do not work.

### Pause the hub's mail {#settings-integrations-pause needs="integrations edit"}

1. Press **System Sender**, then **Pause Mail**. Only invitations, password resets and test emails
   are sent; notices reach people by push and the bell instead.
2. Press **Resume Mail** to send everything again.
3. **Send Test Email** under **More Actions** sends a test to your own address.

## Security {#settings-security screen=settings/security icon=lock}

How long a session lasts, how strong a password must be, which roles need two-step sign-in, who is
signed in now, and failed sign-ins.

![Settings, Security](shot:settings-security)

### Set the sign-in rules {#settings-security-rules needs="settings edit"}

1. Under **Sessions and Passwords**, set **Session Minutes**, **Idle Lock Minutes** and
   **Password Minimum**. They can only be stricter than the server's own limits.
2. Press **Save Rules**.
3. Under **Two-Step by Role**, switch on each role that must use an authenticator app. Its people
   set it up at their next sign-in.

### End someone's session {#settings-security-end needs="settings edit"}

1. Under **Signed In**, find the person or device.
2. Press **End Session**, then confirm. They are signed out on that device.

**Failed Sign-Ins** lists every refused sign-in this week, with what went wrong.

## Audit Log {#settings-audit-log screen=settings/audit-log icon=history}

Who did what, when, to which record. Nobody can change it.

![Settings, Audit Log](shot:settings-audit-log)

1. Search by person or what was done, or choose a **Module** and **Dates**.
2. Press an entry to see every field it changed, before and after. A value your role does not see
   reads **Restricted**.
3. **Open Record** opens the record it is about.
4. {needs="settings export"} **Export** saves the filtered entries as a spreadsheet.

## Imports {#settings-imports screen=settings/imports icon=sheet}

Import a spreadsheet of records, such as new staff, and undo it if needed. Every import is kept with
its error file.

![Settings, Imports](shot:settings-imports)

### Import a spreadsheet {#settings-imports-run}

1. Press **Start Import**. You only see the imports your role may run.
2. On **Upload**, choose **What To Import**. **Blank Sheet** downloads a sheet with the right
   columns and notes. Upload your Excel file (up to 10 MB) or CSV file (up to 5 MB).
3. On **Map**, check which field each column fills. **Leave Out** skips a column. If the column
   names are not on the first row, choose the right row in **Column Names Row**.
4. Press **Next**. **Preview** shows what would happen: how many rows **To Create**, **To Update**,
   **Unchanged** and with **Problems**. Choose **Problems** or **Changes** under **Show** to read
   the rows. Nothing is saved yet.
5. On **Commit**, tick any new value to create, such as a new department.
6. If some rows have problems, switch on **Commit Valid Rows** to save the others.
7. Press **Commit Import**.

| A row reads | What it means |
|---|---|
| **Ready** | It will be saved |
| **Saved With Note** | It will be saved, without something the note names, such as a line manager nobody holds |
| **Not Imported** | It cannot be saved; the problem says why |
| **Duplicate** | An earlier row has the same staff number or email |
| **Unchanged** | It is already in the hub exactly as written |

### Fix the rows that failed, or undo an import {#settings-imports-fix}

1. Press the import in **History**.
2. **Download Errors** gives you your own sheet back, with a **Status** and **Problem** column on
   each row. Correct the rows and import them again.
3. **Revert** undoes the whole import: people it created are archived and records it changed go
   back. It is refused when one of them has changed since, or is now in use.

```shot settings-organisation
open: /settings?tab=organisation
as: operations
device: desktop
marks:
  1: button "Edit Profile" | The company's details
  2: button "New Holiday" | Add a public holiday
  3: button "Edit Week" | The working week
```

```shot settings-status
open: /settings?tab=status
as: admin
device: desktop
marks:
  1: button "Download Brief" | One file about everything
```

```shot settings-performance
open: /settings?tab=performance
as: admin
device: desktop
marks:
  1: button "Edit Targets" | The targets
```

```shot settings-faults
open: /settings?tab=faults
as: admin
device: desktop
marks:
  1: searchbox | Find a fault
```

```shot settings-users
open: /settings?tab=users
as: admin
marks:
  1: button "Invite User" | Give someone a login
  2: button "Invite All Pending" | Email every pending invitation
```

```shot settings-roles
open: /settings?tab=roles-and-permissions
as: admin
device: desktop
marks:
  1: button "New Role" | Create a role
```

```shot settings-approvals
open: /settings?tab=approvals
as: admin
device: desktop
marks:
  1: searchbox | Find a flow
```

```shot settings-notifications
open: /settings?tab=notifications
as: admin
device: desktop
marks:
  1: button "Edit Reminders" | The reminders
```

```shot settings-appearance
open: /settings?tab=appearance
as: admin
device: desktop
marks:
  1: button "Save Palette" | Save the dark theme
```

```shot settings-numbering
open: /settings?tab=documents-and-numbering
as: admin
device: desktop
marks:
  1: searchbox | Find a document
```

```shot settings-integrations
open: /settings?tab=integrations
as: admin
device: desktop
marks:
  1: text "System Sender" | The hub's mail server
```

```shot settings-security
open: /settings?tab=security
as: admin
device: desktop
marks:
  1: button "Save Rules" | Save the sign-in rules
```

```shot settings-audit-log
open: /settings?tab=audit-log
as: admin
device: desktop
marks:
  1: button "Export" | Save the entries
```

```shot settings-imports
open: /settings?tab=imports
as: admin
marks:
  1: button "Start Import" | Import a spreadsheet
```

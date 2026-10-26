---
title: Settings
module: settings
milestones: M0, M9
summary: How the hub is set up: the company, logins, roles, approvals, notifications and the system's health.
icon: cog
---

Settings is where the hub is set up for everyone. You only see the tabs your role opens: most people
see none, and Operations and People see most of them. Status, Performance, Faults and Integrations
are the IT team's. Management sees the other tabs but cannot change them. Imports are the
exception: whoever may add the records, such as staff, may import them. A button you may not use is
not shown.

A change here applies to everyone at once. Some changes ask you to confirm it is you first: follow
[Confirm it's you](#start-confirm-you).

## Organisation {#settings-organisation screen=settings/organisation icon=building}

The company's details, its brand files, its public holidays and its working week.

![Settings, Organisation](shot:settings-organisation)

- The **Company** card shows the details. **Currency** (Naira) and **Time Zone** (Africa/Lagos) are
  fixed for the hub.
- **Public Holidays** shows this year's holidays. Press next year's number, or **All**, to see
  others. A year with none reads **No Holidays Yet**.
- The **Working Week** card lists each day as **Worked** or **Off**, with its hours.

### Edit the company's details {#settings-organisation-profile needs="settings edit"}

1. Open [Settings · Organisation](/settings?tab=organisation) and press **Edit Profile**.
   ![Edit Profile](shot:settings-profile)
2. Fill in **Legal Name**, **Trading Name**, **RC Number**, **Tax ID**, **Phone**, **Email** and
   **Website**. Every field is optional.
3. For **Address**, start typing and pick the address from the list, or pin it on the map. An
   address is always picked, never typed freely. **Clear Address** removes it.
4. Press **Save Profile**. A message says **Profile saved**. **Cancel** closes without saving.

| The field says | What it means | What to do |
|---|---|---|
| **Not a phone number** | Not a Nigerian number, or a foreign one without its country code | Type it as `0803 123 4567`, or start with `+` and the country code |
| **Check the email** | Not an email address | Check the spelling, with one @ |
| **Not a web address** | The website is not a whole address | Paste it whole, starting with `https://` |
| *At most 200 characters*, or another number | More than the field holds | Shorten it |

### Change the logo {#settings-organisation-brand needs="settings edit"}

The **Brand** card holds the **Logo**, the **White Logo** (shown on dark green) and the **Icon**.
Letters, signatures and the hub's own mail use them at once.

1. Press **Upload Logo**, **Upload White Logo** or **Upload Icon**. On a phone, press the plus under
   the picture.
2. Choose a PNG or WebP file with a clear background, up to 5 MB.
3. The picture changes at once and a message says *Logo updated* (or *White logo updated*,
   *Icon updated*).
4. **Remove** asks first: press **Remove** again to confirm. A message says *Logo removed*. Letters
   and mail then use the company's name instead.

| Under the file | What it means | What to do |
|---|---|---|
| *Larger than 5 MB* | The file is too big | Save a smaller copy and upload that |
| **This file type is not accepted here.** | It is not really a PNG or WebP picture | Export it again as PNG and upload that |

### Add a public holiday {#settings-organisation-holiday needs="settings create"}

1. Press **New Holiday** at the top right of the page. On a phone, press **Quick Actions**, then
   **New Holiday**.
   ![New Holiday](shot:settings-holiday)
2. Choose the **Date** and type the **Name**, such as `Independence Day`.
3. Press **Add Holiday**. A message says **Holiday added**.

| The form says | What it means | What to do |
|---|---|---|
| **Required** | The Date or the Name is empty | Fill it in |
| **Already a holiday** | Another holiday is already on that date | Choose another date, or open the other holiday |

### Confirm, move or delete a holiday {#settings-organisation-holiday-change needs="settings edit"}

A holiday the government has not declared yet reads **Expected**. One it has declared reads
**Declared**.

1. Under **Public Holidays**, press the holiday.
2. For an **Expected** one, correct the **Date** if it moved, then press **Confirm Holiday**. It
   then reads **Declared**, and a message says **Holiday confirmed**.
3. For a **Declared** one, change the **Date** or **Name** and press **Save Holiday**. A message
   says **Holiday saved**.
4. {needs="settings delete"} To remove one the government did not declare, press
   **Delete Holiday**, then **Delete Holiday** again to confirm. The day becomes a normal day, and
   a message says **Holiday deleted**. Without the right to delete, the button is not shown.

### Set the working week {#settings-organisation-week needs="settings edit"}

Attendance, leave and every deadline count working days from the working week.

1. Under **Working Week**, press **Edit Week**.
   ![Edit Week](shot:settings-week)
2. Use the switch beside each day's name to work it or not. A day switched on starts at 09:00 to
   17:00. Set its **Start** and **End**.
3. Press **Save Week**. A message says **Working week saved**.

| The form says | What it means | What to do |
|---|---|---|
| **Enter both times** | A worked day has no Start or End | Set both times |
| **After the start** | The End is not later than the Start | Set an End after the Start |
| **Work at least one day** | Every day is switched off | Switch on at least one day |

## Status {#settings-status screen=settings/status icon=chart}

Status is the IT team's view of whether every part of the hub is working. It refreshes itself every
30 seconds.

![Settings, Status](shot:settings-status)

- The pill at the top reads **All Up**, **Degraded** or **Unavailable**.
- The tiles count **Checks Down**, **Open Faults**, **New Today** (faults first seen in the last 24
  hours) and **Came Back**.
- **Checks** lists every check that is not up. When all are up it says so. **Show All** lists every
  one, and **Show Fewer** goes back. Each reads **Up**, **Degraded** or **Down**, says since when, and **Where to Look** says what
  it means: press it to read.
- Press **Open** on a check for its detail:
  - **Jobs** (on Background Jobs) lists each scheduled job, its **Last Run**, **Next Run** and
    **State**: **On Time**, **Late**, **Failing** or **Not Due Yet**. A failing job shows its last
    error under its name.
  - **Queues** (on Worker) lists how many jobs are **Waiting**, **Active**, **Delayed** or
    **Failed**, and the **Newest Failure**.
  - **Changes** lists each change this week: **When**, what it **Became**, and what **It Said**.
    **No Changes** means it stayed the same all week.
  - On a phone the check shows only what is not well. Press **Show More** for its figures, every
    job and the changes.
- {needs="system_health export"} **Download Brief** saves one file describing the whole system,
  problems first, to hand to whoever fixes it. It can take a minute. A message says
  **Status brief ready** once the file is saved, or why it was not made.

## Performance {#settings-performance screen=settings/performance icon=chart}

How fast the hub answers, how often it fails, and how busy the server is, against MyCity's targets.

![Settings, Performance](shot:settings-performance)

1. Choose the **Window**: **Hour**, **Day**, **Week** or **Month**.
2. The cards **Availability**, **Response Time** and **Failed Requests** turn green when their target
   is met and red when it is missed. **Requests** counts the traffic per minute.
3. **Processor**, **Memory** and **Disk** each read **Normal**, **High** or **Critical**, with a bar
   split by what uses them. **Full In** says when the disk fills at its current rate. **Network**
   shows traffic now and this month. On a computer, **Server** shows the system and reads
   **Restart Needed** when the server wants a restart.
4. On a computer, charts follow, one for each figure over the window.
5. Lower down, press **Slowest Routes**, **Database**, **Background Work** or **Processes** to
   switch the list:

| Section | What it shows |
|---|---|
| **Slowest Routes** | Each address the app calls, slowest first: **p95**, **Mean**, **Calls**, **Failed**, **Over 1 s** and **Longest** |
| **Database** | Its **Size**, **Connections** and **Cache Hit**, the **Largest Tables** and the **Slowest Queries** |
| **Background Work** | **Events Waiting** and **Oldest Waiting**, the **Queues** and every **Scheduled Jobs** run with what it **Took** and its **Failures** |
| **Processes** | **People Online**, and each process **Running Now** with its **Memory**, **Event Loop** and **CPU** |

On a phone there are no charts and no **Server** card, and each list shows fewer columns.
**Window** and **Edit Targets** sit under the page title.

| You see | What it means | What to do |
|---|---|---|
| *Nothing recorded since* a time | The one-minute recording has stopped | Open [Settings · Status](/settings?tab=status) and read **Background Jobs** |
| **No traffic** or **Not recorded** on a card | Nobody used the app in the window, or nothing was recorded | Choose a longer **Window** |
| **Not Available Here** | This server cannot report processor, memory and disk | Nothing; the rest still works |
| **Slow SQL Off** | Slow query recording is not turned on | Ask the server's administrator to run provision.sh again |
| **Queues Not Answering** | Redis did not answer | Open [Settings · Status](/settings?tab=status) |
| **No Process Reporting** | No API or worker has reported in the last minute | Open [Settings · Status](/settings?tab=status) |
| **Targets not loaded** | Edit Targets could not read the targets | Press **Edit Targets** again |

### Change the targets {#settings-performance-targets needs="system_health edit"}

1. Press **Edit Targets** at the top right. On a phone it is under the page title.
2. On **Targets**, set **Availability %**, **Response Time ms** and **Failed Requests %**. Press
   **Next**.
   ![Edit Targets](shot:settings-targets)
3. On **Disk and Memory**, set when each turns amber and red: **Disk Free, Amber %**,
   **Disk Free, Red %**, **Memory, Amber %** and **Memory, Red %**. Press **Next**.
4. On **Processor and Connections**, set **Processor, Amber %**, **Processor, Red %**,
   **Connections, Amber %** and **Connections, Red %**.
5. Press **Save Targets**. A message says **Targets saved**. Status uses the new levels at once.

| The field says | What it means | What to do |
|---|---|---|
| **Enter a number** | The field is empty | Type a number |
| **Whole numbers only** | It has a decimal point | Use a whole number |
| *At least* or *At most* a number | Outside what the field takes | Use a number inside that range |
| **Not a percentage** | Not a number like `99.5` | Type the number only, with at most two decimals |
| **Between 90 and 99.99** | Availability out of range | Use 90 to 99.99 |
| **Between 0.1 and 20** | Failed Requests out of range | Use 0.1 to 20 |
| **Below the warning** | Disk Free, Red is not lower than Disk Free, Amber | Make the red level lower |
| **Above the warning** | A red level is not higher than its amber level | Make the red level higher |
| **Targets not saved** | The hub could not save them | Press **Save Targets** again |

## Faults {#settings-faults screen=settings/faults icon=alert}

Every error the hub reports, grouped, with how often it happened and how many people it reached.

![Settings, Faults](shot:settings-faults)

- Search by message or route. On a computer, choose a **Status** (**Open or Handling** at first,
  or **Any Status**) and a **Severity**: **Crash**, **Error**, **Warning** or **Form** (a form
  someone filled was refused).
- Each fault says where it came from (**API**, **Worker**, **Job** or **Browser**), how often
  **Today** and **On Record**, how many **People** it reached, and when it was **Last Seen**.
- **Nothing Has Failed** means the list is empty. New faults show within five minutes.
- On a phone only the search shows. It lists what is **Open** or **Being Handled**; use a computer
  to see fixed or ignored faults.
- If a notice's link says **That fault is no longer kept**, its record was cleared. Search the list
  for the same message instead.

### Work through the faults {#settings-faults-work needs="system_health edit"}

1. Open [Settings · Faults](/settings?tab=faults). It lists what is **Open** or **Being Handled**.
2. Press a fault to open it. It says what it probably means, **Where** it happened,
   **First Seen** and **Last Seen**, **How Often**, and who it is **Held By**. **Latest** shows the
   newest message; **Show Stack** shows the detail for an engineer. **Notes** lists what the team
   wrote.
   ![An opened fault](shot:settings-fault)
3. Press **Take It On** when you start on it. It reads **Being Handled** and **Held By** names you,
   so others know you are on it. A message says *Marked being handled*.
4. Write what you found in **Note**. Press **Add Note** to keep it on its own (*Note added*), or
   **Mark Fixed** once it is fixed, or **Ignore Fault** if it needs nothing: the note goes with it.
   A message says *Marked fixed* or *Marked ignored*.
5. A fixed fault that happens again comes back marked **Came Back**.
6. To act on several, tick them, then press **Mark Fixed** or **Ignore Faults**. The message counts
   them, such as *3 marked fixed*.
7. To reopen a fixed or ignored fault, choose that **Status**, tick it and press **Open Again**.
8. {needs="system_health export"} Tick up to 25 faults and press **Download Brief** for one file
   about them all. Each ticked **Open** fault becomes **Being Handled**, held by you. The message
   says the brief is ready, such as *Brief for 3 ready*.
9. Ticking more than one press takes (25 for a brief, 50 for a status) asks first: only the first
   25 or 50 are taken. **Go Back** lets you tick fewer. Ticking shows only when you may brief or
   change faults.

## Users {#settings-users screen=settings/users icon=user}

Every login to the hub: who can sign in, with which roles, and whether they have set their password.

![Settings, Users](shot:settings-users)

### Read the list {#settings-users-read}

- The tiles count **Users**, **Signed In Now**, **Invited** and **Suspended**.
- **Status** reads **Active** (signs in), **Invited** (has not chosen a password yet), **Not Sent**
  (invited, but no email has gone yet), **Suspended**, or **Left** (their employee record is
  archived).
- Each row shows the person, their **Roles**, when they were **Last Seen** and whether
  **Two-Step** is **On**. On a computer, **Users by Role** counts the logins in each role.
- Search by name or email, or press **Everyone**, **Active**, **Invited** or **Suspended**.
- Press a person to open their login. Your own login opens read only, with only **Close**: ask
  another administrator, or use My Security for your own sign-in.
- On a phone each login is a card; **Last Seen** and **Two-Step** show only on a computer.

### Give someone a login {#settings-users-invite needs="settings create"}

1. Press **Invite User** at the top right. On a phone, press **Quick Actions**, then
   **Invite User**.
2. Pick the **Employee**. Only active staff with no login are listed.
3. Pick their **Roles**, five at most. **Staff** is already picked. A sixth marks **Roles** with
   *At most 5 roles*.
4. Press **Send Invitation**. The message names them, such as *Invitation sent to Ada Okafor*.
   They get an email with a link to choose their password. It works once, for 72 hours.

| The form says | What it means | What to do |
|---|---|---|
| **Pick the employee** | Nobody is picked | Pick the person |
| **Pick a role** | No role is picked | Pick at least one role, at most five |
| **Already has a login** | Someone gave this person a login a moment ago | Close the form and open their login on the list |
| **Email used by a login** | Another person's login signs in with this work email | Correct the work email on [People · Employees](/people?tab=employees) first |
| **Not an active employee** | Their record was archived meanwhile | Restore the record first, if they still work here |

### Help someone with their login {#settings-users-help needs="settings edit"}

![An opened login](shot:settings-user-login)

Open the person's login, then:

- Logins made from MyCity's staff list read **Not Sent**. **Invite All Pending** at the top of the
  page emails every one of them at once. The message counts the invitations sent, or reads
  **Every invitation already sent**.
- **Send Invitation** or **Resend Invitation** shows while they are **Invited**. It emails a new
  link; the old one stops working. A message says **Invitation sent** or
  **Invitation sent again**.
- **Send Reset Link** shows while they are **Active**. It emails a link to choose a new password. A
  message says **Reset link sent**.
- **Sign Out Everywhere** shows while they are **Active**. Press **Sign Out** to confirm. Every
  session they have ends, and a message says **Signed out everywhere**.
- **Reset Two-Step** shows when their **Two-Step** reads **On**. Press **Reset Two-Step** again to
  confirm. They set up their authenticator app again, for a lost phone. A message says
  **Two-step reset, signed out everywhere**.
- When the bar says they sign in with one email but the record says another, press
  **Use Work Email**, then **Use Work Email** again. They are signed out and both addresses are
  told. The message names the new email.
- Reset Two-Step and Use Work Email may ask **Confirm It's You** first.

| The message | What it means | What to do |
|---|---|---|
| **Another login signs in with this email.** | The record's work email is another person's sign-in | Correct one of the two work emails on [People · Employees](/people?tab=employees) |
| **This person has already chosen a password.** | They set it from the link meanwhile | Close and reopen the login; it now reads **Active** |
| **Reactivate this login before inviting again.** or **Reactivate this login before sending a link.** | Someone suspended it meanwhile | Press **Reactivate** first, if they may come back |
| **This login is closed.** | Their employee record was archived meanwhile | Restore the record first |
| **Too many requests. Wait a moment and try again.** | You sent many links in a few minutes | Wait 15 minutes, then try again |

### Change someone's roles {#settings-users-roles needs="settings edit"}

1. Open the person's login.
2. Add or remove roles under **Roles**.
3. Press **Save Roles**. A message says **Roles saved**. Their new access applies at once.

| The message | What it means | What to do |
|---|---|---|
| **Pick a role** | Every role was removed | Give at least one role, such as **Staff** |
| *At most 5 roles* under **Roles** | More than five roles are picked | Keep five at most |
| *There is no role* and a name | That role was deleted a moment ago | Close the login, open it again and pick another |

### Suspend or reactivate a login {#settings-users-suspend needs="settings edit"}

1. Open the person's login and press **Suspend**. The CEO's login has no **Suspend**.
2. Type the **Reason**, such as `Left the company`, and press **Confirm Suspend**. Every session they
   have ends at once. A message says **Login suspended**.
3. To let them back in, open the login and press **Reactivate**. A message says
   **Login reactivated**.

A login that reads **Left** reopens with **Reactivate** once their employee record has been
restored on [People · Employees](/people?tab=employees).

| The message | What it means | What to do |
|---|---|---|
| **At least 6 characters** | The reason is too short | Say why in a few words |
| **Restore their employee record before reactivating this login.** | Their record is still archived | Restore it on [People · Employees](/people?tab=employees), then press **Reactivate** |

## Roles & Permissions {#settings-roles screen=settings/roles-and-permissions icon=shield}

A role decides which modules its holders open, how much they can do there, and over whose records.
Everyone gets their access from their roles.

![Settings, Roles & Permissions](shot:settings-roles)

### Read a role {#settings-roles-read}

1. Open [Settings · Roles & Permissions](/settings?tab=roles-and-permissions) and pick a role. Each
   role reads **Built-In** (it came with the hub) or **Custom**. The **Role Summary** beside its
   name says what it does in one line.
2. **Access** shows each module's level: **No Access**, **View**, **Add**, **Edit** or **Full**,
   over **All**, **Team** or **Own** records, and whether its holders **Approve** or **Export**. A
   module whose actions fit no level reads **Custom**. On a phone the modules are grouped by level,
   and letters mark **T** team records, **O** own records, **A** approves and **X** exports.
3. **Details** shows what the role is for, its **Home**, the **Sensitive Fields** (**Salary and
   pay**, **Bank details**, **Personal details**, **Tax and pension numbers**) as **Visible** or
   **Masked**, and each of its **Capabilities** as **Held** or **Not Held**.
4. **People** lists who holds it. Press a person to open their login on
   [Settings · Users](/settings?tab=users), where roles are given. **Nobody Holds It** means none.
5. On a computer, press **Matrix** at the top. **Permission Matrix** shows every role against every
   module, with the letters **T**, **O**, **A** and **X**. Press a role's name at the top of its
   column to open it. **Roles** goes back.

### Create a role {#settings-roles-create needs="settings create"}

1. Press **New Role**. On a phone, press **Quick Actions**, then **New Role**.
2. Type the **Role Name**. To start from an existing role, pick it in **Start From**. Press
   **Next**.
3. For each module, set the level and the records, and tick **Approve** or **Export** if needed. On
   a phone, press a module, choose its **Level**, **Records**, **Approve** and **Export**, then
   press **Done**. Press **Next**.
   ![Editing a role's access](shot:settings-role-access)
4. On **Details**, say **What It Is For**, choose its **Home** view, tick the **Sensitive Fields** it
   may see and the **Capabilities** it holds. Press **Review Role**.
5. **Review New Role** lists what it gains. Press **Create Role**. The message names it, such as
   *Studio Lead created*.

The messages it may show are listed under [Change or delete a role](#settings-roles-edit).

### Change or delete a role {#settings-roles-edit needs="settings edit"}

1. Pick the role and press **Edit Role**. On a phone, it is at the bottom of the role. The role reads
   **Editing**. A built-in role keeps its name.
2. Make the changes and press **Save Role**. On a phone, press a module, change it, then press
   **Done**.
3. **Review Changes** lists each change as **Gains**, **Loses** or **Changes**, and how many people
   it reaches. Press **Save Role** again, or **Back** to keep editing. The message names the role,
   such as *Studio Lead saved*.
4. {needs="settings delete"} While editing a **Custom** role nobody holds, press **Delete Role**,
   then **Delete Role** again. The message names it, such as *Studio Lead deleted*.

**Cancel** drops your changes. If you open another role first, choose **Discard Changes** or
**Keep Editing**.

> **Important:** The hub refuses a change that would take away your own access to Settings, so you
> can never lock yourself out.

| The message | What it means | What to do |
|---|---|---|
| **At least 2 characters** | The Role Name is too short | Type a longer name |
| **Name already used** | Another role has this name | Choose another name |
| **Grant at least one module** | Every module reads No Access | Give the role at least one module |
| **No changes to save** | Nothing was changed | Make a change, or press **Cancel** |
| **This would take away your own access to Settings. Ask the CEO or another administrator.** | The change would lock you out of Settings | Keep Settings at Edit over All records, or ask someone else |
| *1 person holds this role. Give them another role first.* | Someone still holds it | Change their roles on [Settings · Users](/settings?tab=users), then delete |
| **Choose another name for this role.** | Someone created a role with this name a moment ago | Choose another name |

## Approvals {#settings-approvals screen=settings/approvals icon=ticks}

Who decides each kind of request, in which order, and how long each has.

![Settings, Approvals](shot:settings-approvals)

### Read the flows {#settings-approvals-read}

- The tiles count the **Flows**, the **Open Requests**, those **Overdue**, and the flows that
  **Needs Fixing**.
- Each flow lists its **Stages** in order, its **Version** and its **Open Requests**.
- Search for a flow by name, then press it. Its stages show one by one, with their **Approver**,
  **Applies When** and **Time Limit**.
- On a phone each flow is a card, with its **Status**: **Active** or **Needs Fixing**.

### Change who approves {#settings-approvals-edit needs="settings edit"}

1. Open [Settings · Approvals](/settings?tab=approvals) and press a flow, such as Leave Request.
2. A flow marked **Needs Fixing** says **Fix these stages before the next request**, then what is
   wrong with each, such as *Finance: pick who decides*. Open each stage it names, put it right, and
   save.
3. Press **Edit Stages**.
   ![Edit Stages](shot:settings-stages)
4. Press **Add Stage**, or the pencil beside a stage to change it. A flow holds at most 10 stages:
   then *At most 10 stages* shows in place of **Add Stage**.
5. Type the **Stage Name**.
6. Choose the **Approver**: **Line Manager**, **Role**, **Person** or **CEO**. On a flow that names
   a person, **Named Person** also shows; choose which in **Named In**.
7. For **Role**, pick the role. For **Person**, pick the person: only active logins are listed.
8. Leave **Applies When** at **Always**, or choose a value. Then choose the **Comparison**
   (**Over**, **At Least**, **Under**, **At Most** or **Exactly**) and type the value.
9. Set the **Time Limit, Hours**, from 1 to 2160.
10. Press **Add Stage** or **Update Stage**. **Cancel** goes back without it.
11. The up and down arrows move a stage. The bin removes one. A flow keeps at least one stage.
12. Press **Save Stages**. The message names the flow and its new version, such as
    *Leave Request saved as version 3*. Requests already open keep the version they started on.
    **Cancel** closes without saving.

| The message | What it means | What to do |
|---|---|---|
| **Required** | The Stage Name or the Time Limit is empty | Fill it in |
| **Pick a role**, **Pick a person** or **Pick who** | The approver is not chosen | Choose one |
| **Enter a value** | Applies When has no value to compare | Type the value, or choose **Always** |
| *At least 1* or *At most 2,160* under **Time Limit, Hours** | Not between 1 and 2,160 hours | Use a number in that range |
| **This flow changed since you opened it. Open it again.** | Someone saved this flow first | Press **Cancel**, open the flow again, and redo your change |
| Each stage's problem, such as *Finance: a role it names no longer exists* | A stage breaks a rule | Correct each stage it names, then press **Save Stages** |

## Notifications {#settings-notifications screen=settings/notifications icon=bell}

Who is told about each event, how, and how urgently, and the reminders everyone gets. Each person
still chooses their own channels and quiet hours under the bell's **Notification Settings**.

![Settings, Notifications](shot:settings-notifications)

**Reminders** lists the three reminders, what each is set to, and **On** or **Off**. Each notice
shows **Who** it goes to, its **Channels** and its **Level**. **Set by Poster** means whoever posts
it chooses the level, as for an announcement. **Off** means nobody is told. Security notices are
**Always On** and cannot be switched off.

### Set the reminders {#settings-notifications-reminders needs="settings edit"}

1. Under **Reminders**, press **Edit Reminders**.
   ![Edit Reminders](shot:settings-reminders)
2. Switch on **Approvals Waiting** and type **Every How Many Hours**, from 1 to 168. Approvers are
   reminded that often, from 08:00 to 18:00.
3. Switch on **Probation Ending** and type **Days Ahead**, from 1 to 90.
4. Switch on **Daily Digest** and choose its **Time**. Each person gets an email of what they have
   not read.
5. Press **Save Reminders**. A message says **Reminders saved**. A switch turned off stops that
   reminder for everyone. **Cancel** closes without saving.

| The field says | What it means | What to do |
|---|---|---|
| **Required** | The box is empty | Type a number, or switch the reminder off |
| *At least 1*, *At most 168* or *At most 90* | The number is outside its limit | Hours from 1 to 168, days from 1 to 90 |
| **Reminders not saved** | The hub could not save them | Press **Save Reminders** again |

### Change a notice {#settings-notifications-notice needs="settings edit"}

1. Type part of the notice's name in the search, or choose its **Category**, such as **Approvals**
   or **Attendance and Leave**.
2. Press the notice. **Edit Notice** opens, a sheet on a phone.
   ![Edit Notice](shot:settings-notice)
3. Switch it **On** or off. Choose its **Level**: **Normal**, **Important** or **Urgent**. A notice
   whose poster chooses its level has no **Level** here.
4. Switch its channels on or off: **In App**, **Email** and **Push**. They apply to anyone who has
   not chosen their own.
5. For a notice about someone else, **Add Roles** and **Add People** send a copy to more people. A
   notice meant for one person has neither.
6. Press **Save Notice**. A message says **Notice saved**. **Reset to Default** appears once a
   notice was changed, and puts it back as it came: the message reads
   **Notice back to its defaults**.

| The message | What it means | What to do |
|---|---|---|
| **Role not found** under **Add Roles** | That role was deleted meanwhile | Remove it and press **Save Notice** |
| **Person not found** under **Add People** | That person has left | Remove them and press **Save Notice** |
| **Notice not saved** or **Notice not reset** | The hub could not save it | Press the button again |

## Appearance {#settings-appearance screen=settings/appearance icon=sun}

The hub's dark theme, its fonts, and the theme and density everyone starts with. Without the right
to change Settings, you can read this page but not change it.

![Settings, Appearance](shot:settings-appearance)

### Change the look {#settings-appearance-change needs="settings edit"}

1. Under **Dark Theme**, pick a preset: **Deep Green** (MyCity's own), **Charcoal**, **Black** or
   **Dark Grey**.
2. Or type the four colours as `#RRGGBB`: **Background**, **Card**, **Brand Green** (links and
   highlights) and **Primary Yellow** (buttons). The preset then reads **Custom**.
3. **Preview** shows the hub in those colours as you type.
4. **Contrast** shows the **Lowest Contrast** of any text, how many **Pairs Checked**, and how many
   colours were **Adjusted** to stay readable. **Details** lists each one.
5. Press **Save Palette**. A message says **Dark palette saved**.
6. Under **Fonts**, pick the **Heading Font** and **Body Font**, such as **Inter** or
   **Open Sans**, and press **Save Fonts**. A message says **Fonts saved**.
7. Under **Defaults**, choose the **Theme for Everyone**: **Follow the Device**, **Light** or
   **Dark**. Then the **Density for Everyone**: **Compact** or **Comfortable**. Each saves as soon
   as you pick it, for anyone who has not chosen their own: **Default theme saved** or
   **Default density saved**.

- **Undo Changes** puts the colours or the fonts back to what is saved.
- Each save may ask **Confirm It's You** first, since it changes the hub for everyone.
- **Restore Previous** appears once a palette has replaced another. It brings the earlier one back:
  **Previous palette restored**.
- Everyone else sees the change when they next sign in or reload.

| The field says | What it means | What to do |
|---|---|---|
| **Use #RRGGBB** | It is not a colour code | Type six letters and numbers, such as `#141517` |
| **Too light for dark** | **Background** or **Card** is too pale for white text | Choose a darker colour |
| **Too dark for buttons** | **Primary Yellow** is too dark to carry text | Choose a brighter colour |
| **Not saved. Try again.** | The hub could not save it | Press the button again |

## Documents & Numbering {#settings-numbering screen=settings/documents-and-numbering icon=doc}

How each document is numbered: staff numbers, expense requests, payslips and the rest.

![Settings, Documents & Numbering](shot:settings-numbering)

### Read the numbering {#settings-numbering-read}

- The tiles count the **Document Types**, the **Numbers Issued** so far, and how many schemes
  **Reset Each Period**.
- Each document shows its **Next Number**, its **Prefix**, when it **Starts Again**, and how many
  are **Issued**. A phone shows the next number and when it starts again.

### Change a numbering scheme {#settings-numbering-edit needs="settings edit"}

1. Press the document, such as Staff Number. Its sheet opens, a sheet from the bottom on a phone.
2. Set the **Prefix**, up to 8 letters such as `EXP`, and the **Digits**, from 0 to 10.
3. Choose the **Separator**: `-`, `/`, `.`, `_` or **None**.
4. Choose when it **Starts Again**: **Never**, **Each Year** or **Each Month**.
5. Tick **Put the year or month in the number** under **Period**. A scheme that starts again must
   have it, so choosing **Each Year** or **Each Month** ticks it for you.
6. **Next** at the top shows the next number as it will look.
7. Press **Save Numbering**. A message such as *Staff Number numbering saved* confirms it. It
   applies to the next number. A number already given never changes. **Cancel** closes without
   saving.

| The field says | What it means | What to do |
|---|---|---|
| **Up to 8 letters** | The prefix is too long or has symbols | Use up to 8 letters and numbers |
| **0 to 10** | Too many digits | Choose 10 or fewer |
| **Add sequence digits** | No prefix and no digits | Add digits, such as 4 |
| **Add digits or period** | No digits, and no period to tell numbers apart | Add digits, or tick the period and choose when it starts again |
| **Needed when it resets** | It starts again without the year or month | Tick **Put the year or month in the number** |

## Integrations {#settings-integrations screen=settings/integrations icon=link}

The services the hub uses: the mail server, maps and addresses, the AI providers, exchange rates and
push notifications. This tab is the IT team's.

![Settings, Integrations](shot:settings-integrations)

### Check a connection {#settings-integrations-check}

- The tiles count the connections **Working**, **Failing** and **Not Set Up**.
- Press **All**, **Mail**, **Maps**, **AI**, **Finance** or **Notifications** to see one group.
- Each connection's **State** reads **Working**, **Failing**, **Not Checked** or **Not Set Up**. The
  System Sender also reads **Paused** while system mail is paused.
- **Source** says where its settings come from: **Saved Here**, **Server File** (the server's own
  settings) or **Nothing Set**. A failing one shows why instead, such as **Password refused** or
  **Key refused**.
- On a computer, each row also shows its **Plan**, **Free** or **Paid**, when it was **Checked**,
  and **Today**'s use against its daily limit. A phone shows the **Working** and **Failing** tiles,
  and each connection's state and source.
- {needs="integrations edit"} Press **Test** on its row to check it now. On a phone, open the
  connection and press **Test** at the foot. A message says **Test passed**, or
  *Test failed: Key refused* names what went wrong.

### Open a connection {#settings-integrations-open}

1. Press a connection. It opens at the side, or full screen on a phone.
   ![A connection](shot:settings-connection)
2. **Settings** lists what it uses now. A password reads **Saved**. A key reads
   *Saved, ends 1a2b*, with who saved it and when.
3. **Last Test** reads **Passed** or **Failed**, with each step ticked or crossed and its time.
   Steps include **Connect**, **Sign In**, **Key**, **Models** and **Address Search**.
4. **Use** shows the last seven days: the calls, or the use against the daily limit, and how many
   failed.
5. **Checks** lists every test, newest first, with **When**, **Kind**, **Result** and **By**.
   **Worker** means the hub checked it by itself. **No Checks Yet** means none.
6. {needs="integrations edit"} For Geoapify, **Address** is the address the test searches. Change
   it, then press **Test**. **Last Test** lists what it found.
7. {needs="ai_control view"} For an AI provider, **Open AI Control** opens the screen that chooses
   which model each feature uses.

### Change a connection's settings {#settings-integrations-edit needs="integrations edit"}

1. Press the connection, then **Edit Settings**. For the System Sender or a key,
   **Confirm It's You** may open first. **Cancel** there takes you back to the connection.
   ![Edit Settings, System Sender](shot:settings-integration-edit)
2. Fill in what the connection needs:
   - **System Sender**, in two steps. **Server**: the **Server**, **Port**, **Security** (**TLS**
     or **STARTTLS**), **Username** and **Password**. Press **Next**. **Sending**: the **From**
     address, **Reply-To**, **Hourly Limit** and **Local Domains**.
   - **Staff Mail Server**, in two steps. **Servers**: **IMAP Host**, **IMAP Port**, **SMTP Host**
     and **SMTP Port**. Leave a host blank to use each address's own domain. **Limits**:
     **Hourly Limit per Person**, **Sync Every, Minutes** and **Live Connections**.
   - Geoapify, an AI provider or Exchange Rates: the **API Key**, the **Plan** (**Free** or
     **Paid**) and the **Daily Limit**.
   - **Web Push**: the **Subject**, a `mailto:` or `https://` address.
3. A saved password or key reads **Saved**. Press **Replace** to type a new one, or **Keep Saved**
   to keep it. Changing the server, port or username needs the password again.
4. Press **Save Settings**. The hub tests the settings before saving; nothing is saved until the
   test passes. A message says **Settings saved**, and the connection opens again with its new
   **Last Test**.

| The message | What it means | What to do |
|---|---|---|
| **Server not found** or **Not a host name** | No such mail server | Check the server's name |
| **No answer on port** | Nothing answers on that port | Check the **Port**: 465 with **TLS**, 587 with **STARTTLS** |
| **Secure connection failed** or **Certificate name differs** | The server's security does not match | Check **Security**, and use the name on its certificate |
| **Password refused** | The server refused the username or password | Type the password again |
| **Type the password again** | The server, port or username changed | Type the password for the new server |
| **Sender refused** | The server will not send from that address | Use an address the mailbox owns in **From** |
| **Key refused** | The provider does not accept the key | Copy the key again from the provider |
| **Over today's quota** | The key has used today's allowance or its balance | Wait until tomorrow, or top up with the provider |
| **Not an address**, **Not a domain list** or **Not mailto or https** | The text is not in the right form | Type it as the example shows |
| **At least 1**, **At most 65535**, **At most 100000**, **Too large** and the like | The number is outside its limit | Use a number within it |
| **The service is not answering. Try again shortly.** or **The service did not answer in time.** | The provider did not answer | Try again in a few minutes |
| **None of the models this connection needs is on the key's list.** | The key cannot use the models the hub needs | Use a key with access to them |
| **The saved key cannot be read. Type it again.** | The saved key is unreadable | Press **Replace** and type the key |
| **Saved by someone else first** | Someone saved this connection while you typed | Open **Edit Settings** again and check their values |
| **The test failed. Check the marked field.** | The test failed after you confirmed it was you | Open **Edit Settings** again and look at the marked field |

### Pause the hub's mail {#settings-integrations-pause needs="integrations edit"}

1. Press **System Sender**, then **Pause Mail**. A message says **Mail paused**.
2. The row reads **Paused**, and the panel shows **Mail paused** with who paused it and when. Only
   invitations, password resets and test emails are sent. Notices reach people by push and the bell
   instead.
3. Press **Resume Mail** to send everything again. A message says **Mail resumed**.
4. Once the System Sender is set up, **Send Test Email** under **More Actions** sends a test to your
   own work email. A message says **Test email sent**.

| The message | What it means | What to do |
|---|---|---|
| **Your login has no email to send the test to.** | Your login has no work email | Ask People to add one, or test from another login |
| *The hourly limit is reached. Try at 14:00.* | The mail host's hourly limit is used up | Try again at the time it gives |
| *Test failed: Password refused* | The test could not send | Read **Last Test**, then correct the settings |

### Fix a refused address {#settings-integrations-refused}

1. Press **System Sender**. **Refused Addresses** lists every address the mail server would not
   take: the **Address**, the **Person** who holds it, the **Message** and **Last Refused**.
   **No Refused Addresses** means none.
2. The hub stops sending to an address once it is refused, such as a misspelt email.
3. Correct the person's email on [People · Employees](/people?tab=employees), or create the
   mailbox. An address leaves the list once mail to it goes through.

### Remove a connection's saved settings {#settings-integrations-remove needs="integrations delete"}

1. Press the connection, then **More Actions**, then **Remove Saved Settings**. It shows only when
   its **Source** is **Saved Here**.
2. Read the warning and press **Remove Settings**. **Confirm It's You** may open first.
3. A message says **Settings removed**. The server's own settings apply again, or it reads
   **Not Set Up**. Without a System Sender, system mail waits.

If it says **Nothing is saved here for this connection.**, someone removed them first.

### Replace the push keys {#settings-integrations-keys needs="integrations edit"}

1. Press **Web Push**, then **More Actions**, then **Replace Keys**.
2. Press **Replace Keys** to confirm. **Confirm It's You** may open first.
3. A message says **Keys replaced**. Each phone and computer turns push on again the next time the
   app opens. Until then it gets no push.

### Add a model {#settings-integrations-models needs="integrations edit"}

Each AI provider has a **Models** list: each model, what it does, which jobs use it, and **On Key**.
**Available** means this key can use it; **Not on Key** means it cannot. A test reads the list from
the provider, so most models arrive by themselves. A phone shows the list without prices.

1. Press the AI provider, such as Gemini. Under **Models**, press **Add Model**.
   ![Add Model](shot:settings-add-model)
2. Type the **Model ID** exactly as the provider writes it, such as `gemini-3.8-flash`.
3. Optionally type a **Name** to show instead of the id.
4. Choose what it **Does**: **Text Only**, **Text and Images**, **Text, Images, Audio**,
   **Speech to Text** or **Embeddings**.
5. Leave **Endpoint** blank to use the provider's own, or type an `https://` address.
6. Press **Add Model**. A message says **Model added**, and the connection opens again.
7. {needs="integrations delete"} To take off a model you added, press the bin beside it (on a phone
   too), then **Remove Model**. A message says **Model removed**. A model the provider lists
   cannot be removed.

| The field says | What it means | What to do |
|---|---|---|
| **Not a model id** or **Too short** | It is not a model id | Copy the id from the provider's page |
| **Already on the list** | That model is already listed | Nothing to add |
| **Sonnet or Haiku only** | Anthropic takes only Sonnet and Haiku models | Use a `claude-sonnet` or `claude-haiku` id |
| **Not an https address** | The endpoint is not a secure web address | Start it with `https://`, or leave it blank |
| **Only a model added here can be removed.** | Someone removed it first, or it came from the provider | Nothing to do |

### Fetch today's exchange rates {#settings-integrations-rates}

**Exchange Rates** keeps the naira and every other currency against the dollar, fetched each day
after midnight. Its **Exchange Rate** card shows **One Dollar** in naira, the day the rates are for
(**Rates Of**), and how many **Currencies**. **No Rates Yet** means none was fetched.

1. {needs="integrations edit"} Press **Exchange Rates**, then **Sync Rates** on its card.
2. {needs="integrations edit"} A message says **Rates synced**. *Sync failed: Key refused* names
   what went wrong; correct the key with **Edit Settings**.

## Security {#settings-security screen=settings/security icon=lock}

How long a session lasts, how strong a password must be, which roles need two-step sign-in, who is
signed in now, and failed sign-ins.

![Settings, Security](shot:settings-security)

### Read the security page {#settings-security-read}

- The tiles count who is **Signed In Now**, how many logins have **Two-Step On**, and the
  **Failed Sign-Ins** of the **Last 7 days**.
- Under **Two-Step by Role**, each role says how many of its people have set it up, or
  **Nobody holds it**.
- **Signed In** lists every session: the **Person**, the **Device** and when they were
  **Last Active**. On a computer it also shows the **Method**, such as **Password and Code**, and
  the **Address**.
- **Failed Sign-Ins** lists the refused sign-ins of the last 7 days, as the figure counts them,
  newest first. Search by email or address.
  **Outcome** says why: **Wrong password**, **Wrong code**, **No such account**, **Slowed down**
  (too many tries), **Suspended**, **Closed** or **Refused**. Many from one address may mean someone
  is guessing; tell the IT team.
- Without the right to change Settings, the rules and switches are locked.

### Set the sign-in rules {#settings-security-rules needs="settings edit"}

1. Under **Sessions and Passwords**, set **Session Minutes**, **Idle Lock Minutes** and
   **Password Minimum**. They can only be stricter than the server's own limits.
2. Press **Save Rules**. A message says **Security rules saved**. **Undo Changes** puts back what is
   saved.
3. Under **Two-Step by Role**, switch on a role that must use an authenticator app. Press
   **Require Two-Step** to confirm. It saves at once, the switch busy until it has; **Save Rules**
   is not needed. A message such
   as *Staff now needs two-step* confirms it.
4. Its people set it up at their next sign-in. A passkey counts as both steps.
5. Switch a role off to stop requiring it. It saves at once, without asking: *Staff no longer needs
   it*.

| The field says | What it means | What to do |
|---|---|---|
| **At least 5 minutes** | Too short, or empty | Type 5 or more |
| *At most 120 minutes* | Longer than the server allows | Type the number it names or less |
| **Within the session length** | The idle lock is longer than the session | Make it no longer than **Session Minutes** |
| *At least 8* | Shorter than the server's password minimum | Type the number it names or more |
| **At most 64** | Longer than a password may be | Type 64 or less |

### End someone's session {#settings-security-end needs="settings edit"}

1. Under **Signed In**, search for the person or the device.
2. Press **End Session** on the row, then **End Session** again to confirm.
3. A message such as *Ada Okafor is signed out there* confirms it. They sign in again on that
   device. Your own session reads **This Session**; use **Sign Out** for it.

If it says **That session has already ended.**, they signed out, or someone ended it first.

## Audit Log {#settings-audit-log screen=settings/audit-log icon=history}

Who did what, when, to which record. Nobody can change it.

![Settings, Audit Log](shot:settings-audit-log)

- The tiles count the entries **Today**, **This Week** and **This Month**, and the **Sensitive**
  ones this month, such as a pay or bank change.
- Each entry says **When**, **Who** did it (**System** when the hub did it itself), **What** was
  done and to which **Record**. A computer also shows its **Module** and **Entries by Module**.

1. Search by person or what was done, or choose a **Module** and the **Dates**, **From** and
   **To**. A day typed wrong is marked under its own box, such as **Not a real date**. On a phone,
   press **Filter**, choose them, and press **Show Entries**. **Clear Filters** removes them.
2. Press an entry. It shows **When**, **Who**, the **Record**, the **Action** and the **Address** it
   came from, then each **Field** **Before** and **After**. A value your role does not see reads
   **Restricted**.
3. **Open Record** opens the record it is about, when it has a screen. **Close** goes back.
4. {needs="settings export"} On a computer, **Export** (shown only with the right to export) saves the filtered entries as a
   spreadsheet, up to 10,000 entries. A message says **Export downloaded**. For more, narrow the
   **Dates** and export again. **Export failed. Try again.** means it did not finish; press
   **Export** again.

If the page reads **No Access**, your role sees Settings for some records only, and the log covers
all. Ask an administrator for Settings over **All** records.

## Imports {#settings-imports screen=settings/imports icon=sheet}

Import a spreadsheet of records, such as new staff, and undo it if needed. Every import is kept with
its error file.

![Settings, Imports](shot:settings-imports)

### Import a spreadsheet {#settings-imports-run needs="people create or performance create"}

1. Press **Start Import**. **Import Records** opens.
2. On **Upload**, choose **What To Import**. You only see the imports your role may run.
   ![Import Records, Upload](shot:settings-import-wizard)
3. {needs="people create"} **Employees** imports staff. **Import Staff** on
   [People · Employees](/people?tab=employees) opens it already set to **Employees**.
4. {needs="performance create"} **OKR Workbook**, **OKR Workbook KPIs** and
   **Scorecards Workbook** import a performance plan.
5. **Blank Sheet** downloads a sheet with the right columns and notes.
6. Drop your file on **Drop files here, or browse**, or press it to pick one. Excel up to 10 MB, or
   CSV up to 5 MB. Press **Next** once its name shows; before that it says *Upload a sheet first*.
7. On **Map**, check which field each column fills. **Leave Out** skips a column. The hub finds the
   row with the column names among the first 20 rows. If it is wrong, or reads **Choose Row**,
   pick the right row in **Column Names Row**. The columns are matched again. **Required** names
   the fields that need a column, each marked once one fills it. Press **Next**. If one still has
   no column, **Map** stays open and says which, such as *Choose a column for Designation*.
8. **Preview** shows what would happen: how many rows **To Create**, **To Update**, **Unchanged**
   and with **Problems**. On a computer, choose **Problems** or **Changes** under **Show** to read
   the rows. On a phone, press **Download Errors** to read them in the sheet. Nothing is saved yet.
   **Every Row Is Fine** under **Problems** means nothing needs fixing. Press **Next**.
9. On **Commit**, tick any new value to create, such as a new department.
10. If some rows have problems, switch on **Commit Valid Rows** to save the others.
11. Press **Commit Import**. A message such as *12 created, 3 updated* confirms it, and the bell
    says **Your import finished**.

If the window says **Nothing To Import**, your role may run no import. Ask People and Operations to
run it. Pressed before the list of imports has loaded, the window waits for it.

| A row reads | What it means |
|---|---|
| **Ready** | It will be saved |
| **Saved With Note** | It will be saved, without something the note names, such as a line manager nobody holds |
| **Not Imported** | It cannot be saved; the problem says why |
| **Duplicate** | An earlier row has the same staff number or email |
| **Unchanged** | It is already in the hub exactly as written |

| The message | What it means | What to do |
|---|---|---|
| *Larger than 10 MB* | The file is too big | Split it, or save it as CSV |
| **The file is empty** or **The file has no sheets with data** | Nothing to read in it | Check you chose the right file |
| **This spreadsheet could not be read. Open it in Excel, save it again as .xlsx, and retry.** | The file is damaged or locked | Do as it says |
| **This is an old .xls file. Save it as .xlsx and upload it again.** | An old Excel format | Do as it says |
| **Upload an .xlsx or .csv file.** | Not a spreadsheet | Save it as .xlsx or .csv |
| *This file is too large to import: more than 100,000 rows.* | Over a limit it names | Split the file |
| **Choose the row that holds the column names** | The row picked is past the sheet's end | Pick a row that has the names |
| *Choose a column for Designation* | A required field has no column | Choose that field for one column |
| *"Email" and "Work Email" are both mapped to Work Email* | Two columns fill one field | Set one of them to **Leave Out** |
| *3 rows have problems. Fix them in the file, or commit the valid rows only.* | Some rows cannot be saved | Fix them and import again, or switch on **Commit Valid Rows** |

### When a performance workbook is refused {#settings-imports-performance needs="performance create"}

| The message | What it means | What to do |
|---|---|---|
| **Set up the quarter before importing its plan** | The workbook's quarter is not set up | [Set up a quarter](#performance-quarter) first |
| **This is not the OKR workbook: no sheet has a KR ID table** | The file chosen is not the OKR workbook | Choose the OKR workbook |
| **This is not the scorecards workbook: no sheet is a person's** | The file chosen is not the scorecards workbook | Choose the scorecards workbook |
| *No function is called Studio* | A row names a function the hub does not have | Use the function's name as Performance shows it |
| **A company key result takes a function key result of its quarter** | A company key result is fed from another quarter | Link it to a key result of the same quarter |
| **Another KPI has this code** | The KPI ID is already used | Give the KPI another ID |
| **They do not work here now** | A scorecard names someone who has left | Remove that person's sheet |

### Fix the rows that failed, or undo an import {#settings-imports-fix}

**History** lists every import: its **Reference**, what was imported, **When**, how many were
**Created** and **Updated**, and its **Status**:

| Status | What it means |
|---|---|
| **Committed** | It was saved |
| **Reverted** | It was undone |
| **Uploaded**, **Mapped** or **Previewed** | It was started and not finished. Press it, then **Continue** |
| **Failed** | It was left unfinished for 14 days and closed |

1. Press the import in **History**.
2. On an import once previewed, **Download Errors** gives you your own sheet back, with a
   **Status** and **Problem** column on each row. Correct the rows and import them again.
3. On an unfinished import (**Uploaded**, **Mapped** or **Previewed**) you may run, press
   **Continue**: **Import Records** opens at **Map**, or at **Preview** for one previewed.
4. {needs="people create or performance create"} On a **Committed** import you may run, press
   **Revert**, then **Revert Import** to confirm. People it created are archived and records it
   changed go back.
5. {needs="people create or performance create"} A message such as *12 archived, 3 put back*
   confirms it, and the bell says **Your import was undone**.

| The message | What it means | What to do |
|---|---|---|
| *This import cannot be reverted: row 4 was changed after the import.* | Someone changed that record since | Undo those rows by hand on their screen |
| *... row 9 is now used elsewhere.* | Another record now depends on it | Leave it, or change those records by hand |
| **You cannot run this import** | Only someone who may run this kind of import may revert it | Ask People and Operations |

```shot settings-organisation
open: /settings?tab=organisation
as: operations
marks:
  1: button "Edit Profile" | The company's details
```

```shot settings-holiday
open: /settings?tab=organisation
as: operations
do:
  - desktop click: button "New Holiday"
  - phone click: button "Quick Actions"
  - phone click: button "New Holiday"
  - wait: button "Add Holiday"
crop: modal
marks:
  1: label "Date" | The day
  2: label "Name" | What it is called
  3: button "Add Holiday" | Add it
```

```shot settings-status
open: /settings?tab=status
as: admin
marks:
  1: button "Download Brief" | One file about everything
```

```shot settings-performance
open: /settings?tab=performance
as: admin
marks:
  1: button "Edit Targets" | The targets
```

```shot settings-faults
open: /settings?tab=faults
as: admin
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
do:
  - phone click: button "Quick Actions"
marks:
  1: button "New Role" | Create a role
```

```shot settings-approvals
open: /settings?tab=approvals
as: admin
marks:
  1: searchbox | Find a flow
```

```shot settings-notifications
open: /settings?tab=notifications
as: admin
marks:
  1: button "Edit Reminders" | The reminders
```

```shot settings-appearance
open: /settings?tab=appearance
as: admin
marks:
  1: button "Save Palette" | Save the dark theme
```

```shot settings-numbering
open: /settings?tab=documents-and-numbering
as: admin
marks:
  1: searchbox | Find a document
```

```shot settings-integrations
open: /settings?tab=integrations
as: admin
marks:
  1: text "System Sender" | The hub's mail server
```

```shot settings-security
open: /settings?tab=security
as: admin
marks:
  1: button "Save Rules" | Save the sign-in rules
```

```shot settings-audit-log
open: /settings?tab=audit-log
as: admin
marks:
  1: row 1 | Press for what changed
```

```shot settings-imports
open: /settings?tab=imports
as: admin
marks:
  1: button "Start Import" | Import a spreadsheet
```

```shot settings-profile
open: /settings?tab=organisation
as: operations
do:
  - click: button "Edit Profile"
  - wait: button "Save Profile"
crop: modal
marks:
  1: label "Legal Name" | The registered name
  2: label "Trading Name" | The name people know
```

```shot settings-week
open: /settings?tab=organisation
as: operations
do:
  - click: button "Edit Week"
  - wait: button "Save Week"
crop: modal
marks:
  1: button "Save Week" | Save the week
```

```shot settings-targets
open: /settings?tab=performance
as: admin
do:
  - click: button "Edit Targets"
  - wait: label "Availability %"
crop: modal
marks:
  1: label "Availability %" | The share of time it must answer
  2: button "Next" | The warning levels
```

```shot settings-fault
open: /settings?tab=faults
as: admin
sources:
  - app/src/features/settings/SystemHealth.tsx
do:
  - click: row 1
  - wait: button "Take It On"
crop: modal
marks:
  1: button "Take It On" | Say you are on it
  2: button "Mark Fixed" | Close it
```

```shot settings-user-login
open: /settings?tab=users
as: admin
do:
  - click: row 2
  - wait: button "Save Roles"
crop: modal
marks:
  1: label "Roles" | Their roles
  2: button "Save Roles" | Save the roles
```

```shot settings-role-access
open: /settings?tab=roles-and-permissions
as: admin
device: desktop
sources:
  - app/src/features/settings/Roles.tsx
do:
  - click: button "Edit Role"
  - wait: text "Editing"
marks:
  1: text "Editing" | You are changing this role
```

```shot settings-stages
open: /settings?tab=approvals
as: admin
sources:
  - app/src/features/settings/Approvals.tsx
do:
  - click: row 1
  - click: button "Edit Stages"
  - wait: button "Save Stages"
crop: modal
marks:
  1: button "Add Stage" | Add a stage
  2: button "Save Stages" | Save as a new version
```

```shot settings-reminders
open: /settings?tab=notifications
as: admin
do:
  - click: button "Edit Reminders"
  - wait: button "Save Reminders"
crop: modal
marks:
  1: label "Every How Many Hours" | How often approvers are reminded
  2: button "Save Reminders" | Save all three
```

```shot settings-notice
open: /settings?tab=notifications
as: admin
sources:
  - app/src/features/settings/Notifications.tsx
do:
  - fill: searchbox = approval was started
  - click: text "An approval was started"
  - wait: button "Save Notice"
crop: modal
marks:
  1: text "In App" | Where it reaches people
  2: text "Email" | By email
```

```shot settings-connection
open: /settings?tab=integrations&id=gemini
as: admin
sources:
  - app/src/features/settings/integrations/Connection.tsx
do:
  - wait: button "Edit Settings"
crop: modal
marks:
  1: button "Edit Settings" | Change its settings
```

```shot settings-integration-edit
open: /settings?tab=integrations&id=mail_sender
as: admin
sources:
  - app/src/features/settings/integrations/EditSettings.tsx
do:
  - click: button "Edit Settings"
  - wait: button "Next"
crop: modal
marks:
  1: label "Server" | The mail server's name
  2: button "Next" | Then the sending details
```

```shot settings-add-model
open: /settings?tab=integrations&id=gemini
as: admin
sources:
  - app/src/features/settings/integrations/Models.tsx
do:
  - click: button "Add Model"
  - wait: label "Model ID"
crop: modal
marks:
  1: label "Model ID" | The provider's id
  2: label "Endpoint" | Blank for the provider's own
```

```shot settings-import-wizard
open: /settings?tab=imports
as: operations
sources:
  - app/src/features/settings/Imports.tsx
do:
  - click: button "Start Import"
  - wait: label "What To Import"
crop: modal
marks:
  1: label "What To Import" | Which records
  2: button "Blank Sheet" | A sheet with the right columns
```

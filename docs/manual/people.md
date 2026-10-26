---
title: People
module: people
milestones: M0, M1
summary: The staff register: adding people, their records and their logins.
icon: users
---

People is where MyCity keeps its staff register. Operations and People, Management and the CEO
use it every day. A line manager sees the people who report to them on the screens their role opens.

## Employees {#people-employees screen=people/employees icon=users}

Employees lists everyone who works for MyCity, one row each, 25 to a page. Each person's record
holds their job, their pay and bank details, their manager and their login.

![The Employees screen](shot:people-employees)

### Read the list {#people-employees-read}

- The tiles at the top count active staff: **Headcount**, **Confirmed**, **On Probation** and
  **Attrition, 90 Days** (people who left in the last 90 days). Under them, how many work
  **On Site**, **Hybrid** and **Remote**. On a computer, the line under **Employees** counts the
  staff and the departments.
- Type in the search box to find someone by name, job title, staff number or work email.
- **Department**, **Status**, **Work Pattern** and **Contract** narrow the list. They start on
  **All Departments**, **Any Status**, **Any Pattern** and **Any Contract**; **Ending in 30 Days**
  shows the contracts ending soon. Archived people are hidden until you choose **Archived** under
  Status.
- **All Employees** shows each person's **Employee** (name and job title), **Number**,
  **Department**, **Line Manager**, **Work Pattern**, **Status** and **Login**.
- On a computer, press the **Employee**, **Number** or **Department** heading to sort by it. Press
  it again to reverse it.
- **Status** reads **Active**, **On Probation**, **Suspended**, **Left** or **Archived**.
- **Login** reads **Active** (signs in), **Invited** (has a login but has not chosen a password
  yet), **Suspended**, **Left** or **No Login**.
- Press a row, or **View Record** on a computer, to open the person's record.
- **Headcount by Department** shows, as bars, how many staff each department has.
- Below the list, **Needs a Decision** lists what is waiting. **Probation Ending** counts the
  people whose probation ends in the next 30 days and opens their probation reviews on
  [Performance · Reviews](/performance?tab=reviews), where each is confirmed or extended.
  **Contracts Ending** counts the contracts ending in the next 30 days and opens the list on
  **Contract**, *Ending in 30 Days*.
  **No Line Manager** and **Open Seats** open [People · Organogram](/people?tab=organogram).
  **Not Yet Invited** opens [Settings · Users](/settings?tab=users).

On a phone each person is a card with their name, job title, status and login. **Sort** orders the
cards by name, number or department, up or down.

### Add an employee {#people-add-employee needs="people create"}

Add a person once they have accepted their offer, before their first day. The form has four steps.
Each step checks its own fields before **Next** lets you on. A few checks need the hub, so they come
when you press **Add Employee**; the form then goes back to the step with the field marked.

1. Open [People · Employees](/people?tab=employees).
2. Press **Add Employee** at the top right. On a phone it is also in **Quick Actions**, and the
   form opens full screen with the step's number and title at the top.
   ![The first step of Add Employee](shot:people-add-person)
3. On **Person**, fill in **First Name**, **Last Name**, **Work Email** and **Phone**.
   **Middle Name**, **Gender** and **Date of Birth** are optional. **Gender** is **Female** or
   **Male**. Press **Next**.
4. On **Job**, fill in **Job Title**, pick the **Department**, and choose the **Start Date**,
   **Employment Type** and **Work Pattern**. **Employment Type** is **Full Time**, **Part Time**,
   **Contractor**, **Consultant** or **Intern**, and starts on **Full Time**.
   ![The Job step](shot:people-add-job)
5. For someone who works **On Site** or **Hybrid**, pick their **Worksite**, so they can clock in on
   their first day. For **Remote** it is optional.
6. If you know them, set **Contract Ends**, **Probation Ends** and the **Line Manager**. Press
   **Next**.
7. On **Pay and Bank**, enter **Gross Monthly**, **Bank** and the ten-digit **Account Number** if
   you have them. Press **Next**.
8. On **Next of Kin**, enter **Next of Kin**, **Next of Kin Phone** and **Relationship** if you have
   them. Press **Back** to return to an earlier step. On the first step, **Cancel** closes the form.
9. Press **Add Employee**. The message gives their staff number, such as
   *Ada Okafor added as 00042*, and their record opens.

The staff number is given by the hub, in order. You never type it.

| Field | What to enter | Needed |
|---|---|---|
| **Work Email** | Their address at MyCity, such as `ada@mycityapp.io`. It becomes their sign-in email | Yes |
| **Phone** | Their mobile, any way you write it: `0803 123 4567` or `+234 803 123 4567` | Yes |
| **Date of Birth** | A date before their start date | No |
| **Start Date** | Their first working day | Yes |
| **Worksite** | The office they clock in at | For On Site and Hybrid |
| **Contract Ends**, **Probation Ends** | On or after the start date | No |
| **Line Manager** | Someone on the active staff | No |
| **Account Number** | Exactly ten digits | No |

> **Tip:** A field you cannot see on the form is one your role does not set. People or Management
> fill it in later.

If you may view employees but not add them, the first step says
**You can view employees but not add them, so ask People to add this person.** Press **Close**.

### When a field is refused {#people-add-refused needs="people create"}

The form marks a field as soon as you leave it, and the mark goes the moment it is right.

| The field says | What it means | What to do |
|---|---|---|
| **Required** | It cannot be left empty | Fill it in |
| **Check the email** | Not an email address | Check the spelling, with one @ |
| **Not a phone number** | Not a Nigerian mobile, or a foreign number with its country code | Type it as `0803 123 4567` |
| **Ten digits** | The account number is not ten digits | Type all ten digits |
| **Not below zero** | **Gross Monthly** has a minus | Type the amount without it. Zero is allowed |
| **Check the amount** or **Two decimals at most** | **Gross Monthly** has a second point, a comma out of place, or more than two decimals | Type it as `350,000` or `350000.50` |
| *At most 100 characters*, or another number | A name, job title, bank or next of kin is longer than the field holds | Shorten it |
| **Pick a worksite** | On Site or Hybrid with no worksite | Pick one, or choose Remote |
| **Not a worksite** | The worksite was retired while the form was open | Pick another worksite |
| **Not before the start** | A contract or probation end before the start date | Correct the date |
| **Before the start date** | A date of birth on or after the start date | Correct the date |
| **Already in use** | Another employee has this work email | Use the person's own address, or open the other record |
| **Archived record** | An archived record has this work email | Restore that record instead of adding a new one |
| **Used by a login** | Somebody else's login signs in with this email | Ask an administrator on Settings · Users |
| **Not an employee** | The line manager has left or is suspended | Pick someone on the active staff |

**Already in use**, **Archived record**, **Used by a login** and **Not an employee** appear when you
press **Add Employee**. The form goes back to the step holding the field.

If the hub cannot be reached, a line above the buttons says
**Not saved. Check your connection and try again.** Your answers stay in the form.

### Read a record {#people-record-read}

1. Open the person from [People · Employees](/people?tab=employees). Their name, job and department
   are at the top, with their status, work pattern, manager and start date.
2. **Profile** holds **Person**: their name, work email, phone, gender and date of birth.
   **Personal Details** holds their personal email, home address and next of kin.
3. **Job** holds **Job and Terms**: staff number, job, department, employment type, work pattern,
   dates and status. **Pay and Bank** holds their pay and bank. The account shows only its last
   four digits.
4. **Work Schedule** holds their week. See [Read someone's work schedule](#people-schedule).
5. **Reporting Line** shows **Reports To**: their manager, their dotted line and how many report to
   them. **Open Organogram** shows them on the chart. Under **Direct Reports**, press a person to
   open their record.
6. **Login** shows **Sign In**: whether they can sign in, the email they use, their **Roles** and
   when they last signed in.
7. **History** lists every change under **What**, **Who** and **When**. **System** means the hub
   made the change.
8. Press **Back to Employees** to return to the list.

Fields shown as **Restricted** are ones your role does not see, or that nobody has filled in yet.
On a phone the record's buttons sit full width under the name, and the tabs scroll sideways.

### Open and correct a record {#people-record}

A record's tabs are **Profile**, **Job**, **Work Schedule**, **Reporting Line**, **Login** and
**History**.

![A person's record](shot:people-record)

1. Open the person from [People · Employees](/people?tab=employees).
2. {needs="people edit"} Press **Edit Record**. **Edit Employee** opens, with the fields of Add
   Employee on one form, except **Line Manager**. Change a manager on **Reporting Line**.
3. {needs="people edit"} Change what is wrong and press **Save Record**. Empty a field to remove what
   it held. Moving someone to **On Site** or **Hybrid** asks for their **Worksite**. The message
   names them, such as *Ada Okafor saved*. If you changed nothing, the form just closes.

### When an edit is refused {#people-record-refused needs="people edit"}

| The field says | What it means | What to do |
|---|---|---|
| **Required** | A needed field was emptied | Fill it in again |
| **Check the email**, **Not a phone number**, **Ten digits**, *At most 100 characters* | As on Add Employee | Correct it |
| **Pick a worksite** | On Site or Hybrid with no worksite | Pick one, or choose Remote |
| **Not before the start** | A contract or probation end before the start date | Correct the date |
| **Before the start date** | A date of birth on or after the start date | Correct the date |
| **Already in use**, **Archived record**, **Used by a login** | The work email is someone else's | Use the person's own address |

If a line above the buttons says **Check the dates.**, the new Start Date is after the day their
probation was confirmed. Keep the start date on or before it.
**Not saved. Check your connection and try again.** keeps your changes in the form.

### Read someone's work schedule {#people-schedule}

![Someone's work schedule](shot:people-schedule)

1. Open the person's record and choose **Work Schedule**.
2. **Work Setup** shows their **Work Pattern** and their **Office** with its radius, or
   **No Office Assigned**.
3. For someone who works from home on some days, while MyCity checks homes, **Home Location** reads
   **Approved**, **Waiting** or **Not Set**. They set their home on My Attendance.
4. **Work Schedule** lists each weekday with its hours and **Office** or **Remote**, or **Off**.
   **Company Hours** under a day means the company's usual hours.
5. **From** is the day their schedule began, or **Company Hours** when none is set. **Next** shows
   the first day of one waiting to start.

Lateness and absence follow these days and hours.

### Set someone's work schedule {#people-schedule-set needs="people edit"}

Set a person's own week when it differs from the company hours, such as a part-time consultant. You
cannot set your own, nor that of someone archived, suspended or gone: **Set Schedule** is not offered
there. **From** can be at most 90 days ahead.

1. Open the person's record and choose **Work Schedule**.
2. Press **Set Schedule** under the week. On a phone it opens full screen.
   ![Set Schedule](shot:people-schedule-set)
3. For each day, tick **Working**, or leave it clear for a day off.
4. For a working day, choose **Office** or **Remote** under **Place**.
5. Type its **Starts** and **Ends**. Leave both empty for the company hours of that day.
6. Choose **From**, the first day it applies: today, or up to 90 days ahead.
7. Type the **Reason**, at least 10 characters, such as `Evening desk cover`.
8. Press **Save Schedule**. A message says **Schedule saved**, and the person is told.

A schedule from the same first day replaces the earlier one. A later first day waits under
**Next**.

| The field says | What it means | What to do |
|---|---|---|
| **Required** | The Reason is empty | Type why |
| **At least 10 characters** | The Reason is too short | Say a little more |
| *At most 500 characters* | The Reason is over 500 characters | Shorten it |
| **Both times or neither** | Only Starts or only Ends is filled | Fill both, or empty both for company hours |
| **Ends after it starts** | Ends is not later than Starts | Correct the times |
| **Tick a working day**, on Monday | No day is ticked **Working** | Tick at least one day |
| **Give the hours** | A working day the company does not work, with no hours | Type its Starts and Ends |
| **Too far ahead** | From is more than 90 days away | Pick a nearer day |
| **Already past** | From is before today | Pick today or later |

**Only people who work here now have a schedule.** means the record is archived, suspended or left.
**Someone else sets your work schedule** means it is your own record. **Schedule not saved** means
the hub could not be reached: press **Save Schedule** again.

### Change who someone reports to {#people-reporting needs="people edit"}

1. Open the person's record and choose **Reporting Line**.
2. Press **Change Manager** on the **Reports To** card. **Change Reporting Line** opens.
   ![Change Reporting Line](shot:people-reporting)
3. Under **Manager Is**, choose **A Person** and pick the **Line Manager**. Or choose
   **An Open Role** and pick the post under **Open Role**; **Pick an open role** means none is
   picked.
4. Optionally pick a **Dotted Line**, a second manager for shared work. It does not change who
   approves their leave, expenses or tasks.
5. Type a **Reason** if it helps, and press **Save Line**. The message names them, such as
   *Ada Okafor reassigned*.

| Message | What it means | What to do |
|---|---|---|
| **Nobody reports to themselves.** | You picked the person as their own manager or dotted line | Pick someone else |
| **That would make a loop in the reporting line.** | The manager you picked reports to this person, directly or further down | Pick someone above or beside them |
| **That manager is not on the staff list now.** | The manager left or was archived while the form was open | Pick someone on the active staff |
| **Not changed. Try again.** | The hub could not be reached | Press **Save Line** again |

### Give someone a login {#people-invite needs="settings create"}

A person needs a login to sign in. The hub emails them a link to choose their own password.

1. Open the person's record. Their **Login** reads **No Login**.
2. Press **Send Invite** at the top of the record, or on **Login**. **Invite to Sign In** opens.
3. Check the **Employee**, then pick their **Roles**. **Staff** is already picked.
4. Press **Send Invitation**. The message names them, such as *Invitation sent to Ada Okafor*.
   Their email works once, for 72 hours.

| Message | What it means | What to do |
|---|---|---|
| **Pick the employee** | Nobody is picked | Pick the person |
| **Pick a role** | Every role was removed | Pick at least one, such as **Staff** |
| **Already has a login** | Someone gave them a login first | Close the form; **Login** shows it |
| **Email used by a login** | Another login signs in with their work email | Ask an administrator on [Settings · Users](/settings?tab=users) |
| **Not an active employee** | They were archived while the form was open | Restore the record first |

> **Important:** A person who has already chosen a password signs in with it. To help someone who
> forgot it, send a reset link from [Settings · Users](/settings?tab=users).

### Send the invitation again {#people-invite-again needs="settings edit"}

1. If they lost the email or it expired, open **Login** on their record and press **Send Invite**.
   It shows while their login reads **Invited**.
2. It sends a new link and the old one stops working. The message names the address, such as
   *Invitation sent to ada@mycityapp.io*.

| Message | What it means | What to do |
|---|---|---|
| **This person has already chosen a password.** | They have signed in already | Send a reset link from Settings · Users if they forgot it |
| **Reactivate this login before inviting again.** | Their login was suspended | Reactivate it on Settings · Users |
| **Not sent. Try again.** | The hub could not be reached | Press **Send Invite** again |

### Archive or restore a record {#people-archive needs="people delete"}

Archive a person when they leave MyCity. Their record and history are kept, but they leave every
list and the organogram, and their login stops working at once. The CEO's record has no
**Archive Record**.

1. Open the person's record and press **Archive Record**.
2. Type the **Reason**, such as `Left the company`, and choose their **Last Day**: it starts on
   today and cannot be later. **Attrition, 90 Days** counts them from that day. Press
   **Archive Record**. The message names them, such as *Ada Okafor archived*.
3. Anyone who reported to them now sits at the top of
   [People · Organogram](/people?tab=organogram). Give each a new manager.
4. To bring them back, choose **Archived** under Status on the list and open them.
5. Press **Restore Record**, then **Restore Record** again to confirm. The message
   *Ada Okafor restored* confirms it. They are **Active** again. Their login stays closed until an
   administrator reactivates it on [Settings · Users](/settings?tab=users).

An archived record reads **Archived**. **Job** shows the day and the reason. Its **Login** reads
**Left**, and **Send Invite** is not offered.

| Message | What it means | What to do |
|---|---|---|
| **Required** | No reason given | Say why in a few words |
| *At most 200 characters* | The reason is over 200 characters | Shorten the reason |
| **Not after today** | The **Last Day** is still to come | Archive them on or after their last day |
| **Before their start** | The **Last Day** is before they started | Pick a later day |
| **This record is already archived.** | Someone archived it while you had it open | Close the form; it now reads **Archived** |
| **This record is not archived.** | Someone restored it first | Nothing to do |
| **Not archived. Try again.** or **Not restored. Try again.** | The hub could not be reached | Press again |

### Download someone's data {#people-download-data needs="ceo"}

A copy of what the hub shows about one person, as one spreadsheet.

1. Open the person's record from [People · Employees](/people?tab=employees).
2. Press **Download Their Data** at the top of the record. On a phone it is under their name.
3. Wait while the button spins. The file is saved on this device, and a message says
   **Their data downloaded**.

It holds their record and its history, leave, attendance, a list of their documents and their
sign-ins. The account shows only its last four digits, and there is no pay. Pressing again the same
day gives you the same file.

| Message | What it means | What to do |
|---|---|---|
| **Their copy was already made today. Try tomorrow.** | The person downloaded their own copy today | Press again tomorrow |
| **That file could not be made. Try again.** | The file failed | Press **Download Their Data** again |
| **That file is taking too long. Try again.** | It was not ready in five minutes | Press again |

### Import many people at once {#people-import needs="people create"}

1. Press **Import Staff** at the top of [People · Employees](/people?tab=employees).
2. The import opens on [Settings · Imports](/settings?tab=imports), set to employees. Follow
   [Import a spreadsheet](#settings-imports-run).

## Organogram {#people-organogram screen=people/organogram icon=users}

The whole company's structure as a tree: who reports to whom, and the open roles nobody holds yet.
People and Operations shape it here. Line managers read it here too. Everyone reads it on
[Org Chart](/ess?tab=org-chart) in Employee Self-Service.

![The Organogram](shot:people-organogram)

### Read the structure {#people-organogram-read}

1. Open [People · Organogram](/people?tab=organogram). On a computer, the line under the title
   counts the seats, those filled and those open.
2. Type a name, job or department in **Name or role** to mark the matching cards.
3. A card with a team has a small round button at its foot. It shows a plus and how many are folded
   away, or a minus when the team is open. Press it to fold or open the team. The chart opens with
   the top three levels open. On a computer, **Expand All** opens every branch.
4. A solid line is the reporting line. A dashed line is a **Dotted Line**: a second manager for
   shared work, who does not approve leave, expenses or tasks. A dashed card is an open role. On a
   computer, the key above the chart reads **Reporting Line**, **Dotted Line**, **CEO** and
   **Vacant Seat**. Each card shows the job, department, start date and work pattern. An open role
   reads **Open role** if you cannot change the chart.
5. Press a person's card. **Profile** opens with their **Department**, who they **Reports To**,
   their **Dotted Line** and their **Team**. **Send Message** writes to them. On your own card,
   **My Profile** opens your profile instead.
6. {needs="people view, settings view"} **Open Record** opens their record.
7. {needs="people edit"} **Change Manager** changes who they report to. The CEO's card has none.
8. **Download PDF** saves the chart as a file on this device. Wait while it spins; a message says
   **PDF downloaded**.

If more than one person or role has no manager, a line above the chart says so, such as
*3 people and roles sit at the top. Give each one a line manager.*

On a phone there is no drawn chart, key or seat count. **View** switches between **Everyone** and
**Focus**, and opens on **Everyone**: the company as one list. Press the arrow beside a row to fold
its team. Tap a row to see it in **Focus**.

**Focus** shows the line from the top as names; tap one to move up. Then **Reports To**, the
person's own card, and **Direct Reports**, **Dotted Line** and **Same Manager**. At the top of the
company, **Also At The Top** lists the others there. Tap the person's own card to open their
**Profile**. **Show Top** returns to the top. Typing in the search box lists the people and roles
that match; tap one to focus it. **No Match** means nothing matched.

### Change the structure {#people-organogram-change needs="people edit"}

1. To move someone, drag their card onto their new manager. The message names them, such as
   *Ada Okafor now reports to Bode Oluwasanmi*. Dragging works on a computer only, and the CEO's
   card cannot be moved. Or press their card, then **Change Manager**, and follow
   [Change who someone reports to](#people-reporting).
2. {needs="people create"} To add a post nobody holds yet, press **Add Role**. On a phone it is in
   **Quick Actions**. **Add Open Role** opens. Type the **Role Title**, search for the **Department**
   (those in use) and, if you know it, who it **Reports To**. Press **Add Role**. The message names it, such as
   *Head of Sales added as an open role*.
   ![Add Open Role](shot:people-add-role)
3. To correct an open role, press **Edit Role** on its card. **Edit Open Role** opens with the same
   fields. Press **Save Role**. The message names it, such as *Head of Sales saved*.

| Message | What it means | What to do |
|---|---|---|
| **Name the role** | **Role Title** is empty | Type the role's title |
| **Pick a department** | No department picked | Pick the department it sits in |
| *That would make a loop in the reporting line.*, or another reason | The move or the role was refused, and the message says why | Pick another manager, or check who it **Reports To** |
| **Not moved. Try again.** or **Not saved. Try again.** | The hub could not be reached | Check your connection and press again |
| **That file could not be made. Try again.** | The PDF failed | Press **Download PDF** again |
| **That file is taking too long. Try again.** | It was not ready in five minutes | Press **Download PDF** again |

## Attendance {#people-attendance screen=people/attendance icon=clock}

The day's attendance register: who is expected, who is in, who is late, and the punches waiting for
a decision. Operations and People see everyone. A line manager sees the people who report to them,
and reads their team's exceptions; Operations and People decide them.

![People · Attendance](shot:people-attendance)

### Read the register {#people-attendance-read}

1. Open [People · Attendance](/people?tab=attendance). It opens on today. Choose another **Date**
   to see that day, as far back as you like but never past today.
2. The figures count the day: **Expected**, **Present**, **Late**, **Absent**, **On Leave** and
   **Not In**. Press one, except **Expected**, to list only those people. **Open Exceptions** counts
   the day's punches waiting on People; pressing it opens **Exceptions** on that day's open ones.
3. Under **View**, keep **Register** for the day's list. Press a status chip, such as **Late**, or
   type in **Name or Location**. Press **Employee** or **Clock In** at the top of the list to sort
   it.
4. Each row shows the person's **Status**, **Clock In**, **Clock Out**, **Arrangement**,
   **Location** (the place matched, and whether they were inside its circle), **Device** and
   **Review**.
5. Press a row to see the day's evidence. The card at the top shows the **Shift**,
   **Arrangement**, **Expected Location**, **Hours**, **Late By**, **Left Early By** and
   **Overtime**. Each punch shows its **Server Time**, its **Result**, the **Device Time**, the
   reading's **Accuracy** and **Coordinates**, and its **Source**.
   ![A day's evidence](shot:people-attendance-day)
6. On a temporary site's day, **Route** lists the clock-in, each check-in with **Inside**,
   **Recorded** or **Flagged**, then the clock-out. **Exceptions** under it lists the day's
   exceptions; press one to decide it.
7. {needs="people export"} Press **Export**, choose the **Period**, its **From** and **To** days at
   most 31 days apart, and the **Status**: it starts on the status chip you chose, such as
   **Late**, or **All**. Press **Export Register**. **Preparing your export** shows, then a message
   says **Export downloaded** once the file is saved on this device. A day typed wrong is marked
   under its own box, such as **Not a real date**; **At most 31 days** under both means the period
   is too long; **Export failed. Try again.** means the file could not be made.

| Word | What it means |
|---|---|
| *Late 12m* | Clocked in 12 minutes after the shift's start, past the grace |
| **Not In** | Expected today and not clocked in yet |
| **Absent** | A working day closed with no clock-in |
| **Day Off** | Not a working day for this person |
| **Inside** or **Outside** | The clock-in was within, or beyond, the place's circle, with the distance |
| **Unclear** | The reading could not prove where they were, with why: a rough reading, at the edge, no home, no office or no reading |
| **Not Checked** | A remote day while MyCity does not check homes |
| *1 Open* | One exception on this day waits for a decision |

A punch's **Result** reads **Accepted**, **Review** (waiting on People), **Not Counted** (refused
at the clock) or **Rejected** (People rejected it). **Source** reads **Clock**, *Added by* and a name, or
**System Clock-Out**.

To see every day of one person, search their name with ⌘K and press the last row of
**Attendance Days**, such as *All Days of Ada Obi*. A panel with their name lists their days of
this month, newest first, with **Date**, **Clock In**, **Clock Out**, **Hours** and **Status**.
Choose another month at the top. Press a day to open its evidence over the panel; close it to come
back to their days.

On a phone the figures sit two to a row, and each person is a card with **Status**, **Clock In** and
**Clock Out**. Tap the card for the rest. In the day's sheet a punch shows **Punch**,
**Server Time**, **Result** and **Location** only; **Device Time**, **Accuracy**, **Coordinates**,
**Device** and **Source** are on a computer only. **Sort** orders the cards.

### Decide an exception {#people-attendance-decide needs="people approve, people edit"}

An exception is a punch the hub could not accept on its own.

| Exception | What happened |
|---|---|
| **Outside Worksite** | A clock-in or check-in beyond the place's circle |
| **Outside Home** | A remote day's clock-in beyond the approved home's circle |
| **Location Unclear** | The reading could not prove where they were |
| **Unknown Device** | A device they have not registered |
| **Device Time Ahead** | The device's clock was ahead of the hub's |
| **Missing Clock-Out** | They clocked in and never clocked out |
| **System Clock-Out** | The hub clocked them out |

1. Under **View**, choose **Exceptions**. **Open** lists those waiting, **Decided** those settled,
   and the date chip every exception of the chosen **Date**. Type in **Name or Detail** to find
   one. **Explained** under **Note** means the person wrote why.
2. Press one. It shows the person, the punch, its **Date**, **Detail** and **Severity**,
   **Their Note** and, for a System Clock-Out, their **Real Time**. The decision shows only when it
   is yours to make: Operations and People decide, never on their own exception. Otherwise the
   sheet has **Close** only.
   ![Deciding an exception](shot:people-attendance-decide)
3. Under **Outcome**, choose what fits:
   - Most exceptions: **Accept** keeps the punch, **Reject** stops it counting. The person can then
     clock in again.
   - **Missing Clock-Out**: **Add Clock-Out** with the **Clock-Out Time** they left, or **Accept**
     to leave it open.
   - **System Clock-Out**: **Accept** keeps the hub's time; **Correct Time** records the
     **Clock-Out Time** they gave.
   - A check-in's flag: **Accept** clears it; **Reject** keeps it flagged. The shift does not
     change.
   - A punch refused at the clock (its **Detail** starts *Refused*): neither choice makes it
     count. **Accept** agrees with the refusal; **Reject** notes it was wrong.
4. Type the **Reason**, at least 10 characters, such as `Matches gate log`, and press
   **Record Decision**. A message says **Decision recorded**, and the person is told.

The punch itself never changes. Your decision is kept beside it, with your name and the time.

| The screen says | What it means | What to do |
|---|---|---|
| **At least 10 characters** | The reason is too short | Say more in **Reason** |
| **Give the time** | **Add Clock-Out** or **Correct Time** with no time | Fill in **Clock-Out Time** |
| **After the clock-in** | The time is before the clock-in, or still to come | Give a time after the clock-in, up to now |
| **Only People with access to everyone decide attendance exceptions** | Your role sees your team only | Ask Operations and People to decide it |
| **Someone else decides your own attendance** | It is your own exception | Ask another person in People |
| **This exception was already decided** | Someone decided it first | Close it. **Decided** shows the outcome |
| **This day already has a clock-out** | A clock-out was added or made meanwhile | Close it and read the day again |
| **Decision not recorded** | The hub could not be reached | Press **Record Decision** again |

### Approve a home location {#people-attendance-homes needs="people approve, people edit"}

When MyCity checks homes, staff who work from home send their home for approval. **Homes** appears
under **View** only then.

1. Under **View**, choose **Homes**. **Waiting** lists those to decide; **Approved**, **Rejected**
   and **All** the rest. Type in **Name** to find one.
2. Press one. Read the **Address**, the reading's **Accuracy** and **From Approved Home**: how far it
   is from the home in use. The decision shows only when it is yours to make, never on your own
   home.
3. Under **Outcome**, keep **Approve**, or choose **Reject** and type the **Reason**, at least 10
   characters. The person reads it.
4. Press **Record Decision**. A message says **Home location approved** or
   **Home location rejected**.

**Replaced** means a newer home was sent or approved. A line manager sees the status and distance,
never the address. On a phone each home is a card with the person, **From Approved Home** and
**Status**.

| The screen says | What it means | What to do |
|---|---|---|
| **At least 10 characters** | The reason is too short | Say more |
| **Only People with access to everyone decide home locations** | Your role sees your team only | Ask Operations and People |
| **Someone else decides your own home location** | It is your own home | Ask another person in People |
| **This home location was already decided** | Someone decided it first | Close it and read its status |
| **Home locations are off in the Attendance policy.** | MyCity stopped checking homes meanwhile | Nothing to decide |
| **Decision not recorded** | The hub could not be reached | Try again |

### Waive deductions {#people-attendance-waive needs="people approve, people edit"}

![Deductions to waive](shot:people-attendance-pay)

1. Under **View**, choose **Deductions**. The chips show **Pending** first; choose **Waived** or
   **All** for the rest. Type in **Name** to find someone. Each item shows the person, the
   **Date**, the **Kind**, the **Minutes**, the **Method**, the **Amount** and its **Status**.
2. To waive one deduction, press it, type the **Reason** and press **Waive Deduction**.
3. To waive several, tick them, on as many pages as you like, and press **Waive Selected**. When
   some ticked items are not yours to waive, **Waiving** counts those that are, such as
   *3 of 4 selected*. Type the **Reason** and press **Waive Deductions**. On a phone,
   **Waive Selected** is also in **Quick Actions** once you tick one.
4. A message says **Deduction waived**, or counts them, such as *3 deductions waived*. Items decided
   meanwhile or already in payroll are skipped and counted, such as
   *2 waived, 1 already decided, 1 in payroll*. The day still counts as late; the pay is restored.

| Method | How the amount is worked out |
|---|---|
| **Pro-Rata by Minute** | The hourly rate for each minute |
| **Fixed per Hour** | A fixed sum for each hour or part of one |
| **Fixed per Day** | A fixed sum for the late day |
| **A Day's Pay** | One day's pay, for an absence |
| **Multiple of Hourly Rate** | Overtime at a multiple of the hourly rate |

**In Payroll** means payroll has taken it, so it can no longer be waived. An item you may not decide
opens with **Close** only. **Restricted** in the Amount means your role does not see salaries.
**No Salary Set** means the person has no salary on their record yet.

| The screen says | What it means | What to do |
|---|---|---|
| **At least 10 characters** | The reason is too short | Say more |
| **Only People with access to everyone waive deductions** | Your role sees your team only | Ask Operations and People |
| **Someone else waives your own deductions** | It is your own deduction | Ask another person in People |
| **None of these can be waived** | Every ticked item is your own, or already decided | Tick pending deductions of other people |
| **Nothing waived** | The hub could not be reached | Try again |

### Decide overtime {#people-attendance-pay needs="people approve"}

A line manager confirms or cuts their team's overtime.

1. Under **View**, choose **Overtime**. The chips show **Pending** first; choose **Confirmed**,
   **Cut** or **All** for the rest.
2. Press a pending overtime item.
3. To confirm all of it, press **Confirm**. To confirm fewer, change **Minutes** first. A message
   says **Overtime confirmed**. When the month's cap holds it back, the message says so instead:
   *Overtime cut: monthly cap reached*, or the minutes kept, such as
   *1h 30m confirmed: monthly cap reached*.
4. To refuse it, type the **Reason**, at least 10 characters, and press **Cut**. A message says
   **Overtime cut**.
5. When MyCity's policy approves overtime beforehand, you can agree it before it is worked: open
   the person's day for today and press **Approve Overtime**. Choose the **Day**, from today up to
   90 days ahead, type the **Minutes**, up to 720, and a **Reason** of at least 10 characters.
   Press **Approve Overtime**. A message says **Overtime approved**, and the person is told.

Approving the same day again replaces the minutes. **Approve Overtime** is never offered on your own
day, nor when the policy confirms overtime afterwards.

On a phone each item is a card with a tick, and **Method** is in the item's sheet. **Sort** orders
by **Date** or **Minutes**.

| The screen says | What it means | What to do |
|---|---|---|
| **At least 10 characters** | The reason is too short | Say more |
| **At least 1** | The minutes are 0 | Type minutes up to the item's |
| **This overtime was already decided** | Someone decided it first | Close it |
| **Someone else confirms your own overtime** | It is your own overtime | Ask another person |
| **Someone else approves your own overtime** | It is your own day | Ask another person |
| **Overtime not decided** or **Overtime not approved** | The hub could not be reached | Try again |

## Leave {#people-leave screen=people/leave icon=calendar}

Everyone's leave requests, the decisions waiting on you, and the leave types and allowances.
Operations and People see everyone. A line manager sees the requests of the people who report to
them.

![People · Leave](shot:people-leave)

### Read the requests {#people-leave-read}

1. Open [People · Leave](/people?tab=leave).
2. The figures count those **On Leave Today**, those **Pending Approval**, those
   **Starting Soon** in the next 14 days, and those **Approved This Year**.
3. Press a chip (**All**, **Pending**, **Approved**, **Rejected** or **Cancelled**), or type in
   **Name or type**.
4. The first request waiting is shown beside the list, or the one a link named, from **Need You**,
   search or a notification. Press another to show it instead. Its card
   shows **Employee**, **Type**, **From**, **To**, **Days**, **Status**, **Waiting On**,
   **Recorded By** (**People** when People recorded it), the person's **Reason**, and **Also Away**:
   who else in the department is off then. **Nobody else in the department** means nobody else is
   off.
5. **Leave Calendar** shows approved and waiting leave a month at a time, each day with the first
   names of who is away; *(Waiting)* follows a name still to be decided. Choose another month, this
   year or next.
6. **Leave Types** and **Allowances** list the types and each person's days. Only People change
   them.

On a phone, the figures sit two to a row and the request's card is under the list. Tap a request,
then scroll down to it, or drag it down to close it.

### Approve or reject leave {#people-leave-decide needs="people approve"}

A request waits on the person's line manager. Leave over 5 days then waits on Operations and
People. **Waiting On** says who decides it now.

1. A request in **Need You** on your [Home · Overview](/home?tab=overview) opens here with that
   request shown. Or press **Pending** and press the request waiting on you.
   ![A request waiting on you](shot:people-leave-request)
2. Check **Also Away** for who else is off. **Approve** and **Reject** show only when the request
   waits on you now.
3. Press **Approve**. The message says it is approved and the person has been told, such as
   *Approved. Ada has been told.*
4. Or press **Reject**, type the **Reason**, and press **Reject Leave**. The person reads your
   reason.

| The screen says | What it means | What to do |
|---|---|---|
| **You are not an approver for this stage** | It waits on someone else, named in **Waiting On** | Leave it to them |
| *This approval is already approved* | Someone decided it first, here or in My Approvals | Read its **Status** |
| **Not saved. Try again.** | The hub could not be reached | Try again |

### Record leave for someone {#people-leave-record needs="people create"}

For leave already agreed, such as sick leave told by phone.

1. Press **Record Leave** at the top right of [People · Leave](/people?tab=leave).
   ![Record Leave](shot:people-leave-record)
2. Pick the **Employee**, the **Leave Type**, the **First Day** and the **Last Day**. The
   **Employee** list offers only people who work here now. The first day may be in the past. Add a
   **Note** if it helps.
3. Press **Record Leave**. The message names them, such as *Leave recorded for Ada Okafor*. It is
   approved at once, and the person is told.

Leave cannot be recorded for someone suspended or who has left.

| The field says | What it means | What to do |
|---|---|---|
| **Pick someone** | No employee picked | Pick the person |
| **Not active** | They were suspended or left meanwhile | Leave cannot be recorded for them |
| **Required** | A type or a date is empty | Fill it in |
| **Ends before it starts** | The last day is before the first | Correct the last day |
| **Ends in another year** | It runs past 31 December | Record two, one for each year |
| **No working days** | Every day is a day off or a holiday | Pick working days |
| **Overlaps other leave** | They already have leave on some of those days | Change the days, or cancel the other |
| *32 working days, 19 left* | It takes their year past the type's allowance: the working days asked for, then the days left | Record fewer days, or raise their allowance |
| **Not offered** | The type was retired meanwhile | Pick another type |

### Cancel granted leave {#people-leave-cancel needs="people edit"}

1. Press the approved request. **Cancel Leave** shows until its last day.
2. Press **Cancel Leave**, then **Cancel Leave** again, or **Keep It**. A message says
   **Leave cancelled**, and the person is told.

If it says **This leave can no longer be cancelled**, the leave has ended or was already cancelled.

### Set leave types and allowances {#people-leave-types needs="people edit"}

1. Press **Leave Types** to see each type with its **Allowance** and **Status**: **Offered** or
   **Retired**.
2. {needs="people create"} Press **Add Type**. **Add Leave Type** opens. Type its **Name** and its
   **Days a Year** (leave it empty for a type with no limit, such as unpaid leave), and press
   **Add Type**. The message names it, such as *Study added*.
3. Press a type to change its **Name** or **Days a Year**, and press **Save Type**. The message
   names it, such as *Study saved*. Untick **Offered on new requests** to retire it: it reads
   **Retired**, and leave already taken keeps it. Tick it again to offer it again.
   ![A leave type](shot:people-leave-type)
4. Press **Allowances**. Pick the **Employee** and choose the **Year**, this year or next. Each type
   shows days entitled, taken, booked and left, or **No set allowance**.
5. Press **Set** beside a type. Type the **Days**, or leave it empty for the type's usual
   allowance, and press **Save Allowance**. The message names them, such as
   *Allowance saved for Ada Okafor*. The person is told.
6. {needs="people delete"} To remove a type nobody has used, press it, then **Delete Type**, and
   **Delete Type** again. The message names it, such as *Study deleted*. If it says
   **This type has leave on record. Retire it instead.**, untick **Offered on new requests**
   instead.

| The screen says | What it means | What to do |
|---|---|---|
| **Name the type** | **Name** is empty | Type a name |
| **At most 80 characters** | **Name** is too long | Shorten it |
| **0 to 366 days** | **Days a Year** or **Days** is out of range | Type 0 to 366, or leave it empty |
| **Already a type** | Another type has a name that close | Choose another name |
| *Retire a type first: 25 is the most offered at once* | 25 types are offered already | Retire one, then add or offer this one |
| **That leave type does not exist** | Someone deleted it meanwhile | Close the form |
| **Not saved. Try again.** | The hub could not be reached | Try again |

## Devices {#people-devices screen=people/devices icon=phone}

Every device staff have clocked in from, with its status. A person registers their own on
[My Devices](/ess?tab=my-devices).

![People · Devices](shot:people-devices)

1. Open [People · Devices](/people?tab=devices).
2. **All** shows every device. Press **Registered**, **New** (seen on a clock-in, not registered) or
   **Removed** to narrow the list, or type in **Device or Person**.
3. Each row shows the **Employee**, the **Device**, its **Status**, when it was **First Seen**, and
   its **Last Punch**. Press one to see when it was **Registered** or **Removed**, **Removed By**
   and the **Reason**.
On a phone each device is a card with the person, **Device** and **Status**. Tap it for
**First Seen** and **Last Punch**.

### Remove someone's device {#people-devices-remove needs="people edit"}

1. To take a device off, for a lost phone, press it and press **Remove Device**.
2. Type the **Reason**, such as `Phone lost`, and press **Remove Device** again.
3. A message says **Device removed**, and the person is told. They can register a new one.

| The screen says | What it means | What to do |
|---|---|---|
| **Required** | No reason | Type why |
| **This device is already removed.** | Someone removed it first, or the person did | Close it |
| **Device not removed** | The hub could not be reached | Try again |

## Worksites {#people-worksites screen=people/worksites icon=pin}

The offices staff clock in at, each a centre and a circle around it, and the temporary sites people
work at for a few days.

![People · Worksites](shot:people-worksites)

### Read the worksites {#people-worksites-read}

1. Open [People · Worksites](/people?tab=worksites). **Permanent** lists the offices: their
   **Code**, **Address**, **Radius**, how many people are **Assigned**, and their **Status**.
2. Press **In Use**, **Retired** or **All**, or type in **Name or Address**.
3. Press a worksite. It shows its **Address**, **Centre**, **Radius**, **Timezone**, its map and
   circle, and **Assigned People** with each one's **Arrangement**.
4. Choose **Temporary** for the temporary sites, **Awaiting Approval** first. Press a state chip, or
   type in **Name, Number or Person**. **Withdrawn** means its sender took it back.
5. Press a site. It shows its **Purpose**, **Hours**, days, who **Added By** it and who it is
   **Waiting On**, its **Description**, each address on a map with its **Radius**, its **People**,
   and **Approval**: the route and each decision.

> **Tip:** A yellow number on **Permanent**, **Temporary** or a chip counts what is new for you
> there, and Worksites opens on the side that holds it.

On a phone each worksite is a card with its **Radius**, **Assigned** and **Status**; tap it for the
rest. The buttons that add a worksite or a temporary site are also in **Quick Actions**.

### Add a worksite {#people-worksites-add needs="people create"}

1. Press **Add Worksite**.
   ![Add Worksite](shot:people-add-worksite)
2. Type its **Name**, such as `Lekki Office`.
3. Start typing the **Address** and pick it from the list. It fills **Latitude** and **Longitude**.
   Or press **Drop a Pin** and pin it on the map. Or type the **Latitude** and **Longitude**
   yourself; the hub then names the address. A map shows the centre and its circle; tap it to move
   the centre.
4. Set the **Radius, Metres**: a punch within it counts as on site. MyCity's offices use about 100.
5. Press **Add Worksite**. A message says **Worksite added**.

A radius from 25 to 1,000 metres is allowed. Outside that, the field says **From 25 to 1,000 m**.
A **Latitude** outside -90 to 90 says **From -90 to 90**, and a **Longitude** outside -180 to 180
says **From -180 to 180**. With no address picked and no centre typed, **Latitude** and
**Longitude** say **Required**.

### Change, retire or assign {#people-worksites-change needs="people edit"}

1. Open the worksite from [People · Worksites](/people?tab=worksites).
2. Press **Edit Worksite**, change it and press **Save Worksite**. A message says
   **Worksite saved**.
3. To add someone who works there, press **Assign Employee**, pick the **Employee** and press
   **Assign Employee**. The message names them, such as *Ada Obi assigned*. Someone at another
   worksite moves here.
4. To stop using it, press **Retire Worksite**, then **Retire Worksite** again. A message says
   **Worksite retired**; its people's punches are no longer matched to it. **Restore Worksite**
   brings it back: **Worksite restored**.

| The screen says | What it means | What to do |
|---|---|---|
| **Pick someone** | No employee picked | Pick the person |
| **Pick someone who works here now** | The person is suspended or has left | Pick someone on the active staff |
| **Restore the worksite before assigning anyone** | It was retired meanwhile | Press **Restore Worksite** first |
| **Not saved** or **Not assigned** | The hub could not be reached | Try again |

### Decide a temporary site {#people-worksites-temporary needs="people approve"}

When someone asks to work elsewhere with **Add Work Site**, it waits here for approval.

1. Choose **Temporary**, then press a site **Awaiting Approval**.
   ![A site waiting on you](shot:people-worksites-site)
2. Read its **Purpose**, days, addresses on the map, **People** and **Description**.
3. **Approve** and **Reject** show when the site waits on you, and never on a site you are on.
   Press **Approve**: the message names it, such as *TS-0012 approved*. Or press **Reject**, type
   the **Reason** and press **Reject**: *TS-0012 rejected*. The people on it are told.
4. To take someone off a site waiting or in force, press **Take Off** on their row under **People**.
   Type the **Reason** and press **Take Off**. The message names them, such as *Ada Obi taken off*.
   With one person left there is no **Take Off**: cancel the site instead.
5. To end an approved site early, press **Cancel Site**, type the **Reason** and press
   **Cancel Site**. The message names it, such as *TS-0012 cancelled*. Days already worked keep
   their punches.
6. To send people out yourself, choose **Temporary** and press **Add Temporary Site**. Fill it in as
   [Add a work site](#home-overview-work-site), but pick the **People** from the whole staff; you
   are not on it. Press **Save Site**. The message names it and counts who was told, such as
   *TS-0012 added, 3 told*. It is in force at once.

| The screen says | What it means | What to do |
|---|---|---|
| *This approval is already approved* | Someone decided it first | Read its state |
| **At least 10 characters** | The reason is too short | Say more |
| **This temporary site has ended** | Its last day has passed | Nothing to change |
| **This temporary site is closed** | Someone cancelled it meanwhile | Close it |
| **That person is not on this site** | Someone took them off first | Close it |
| **Cancel the site instead** | They are the last one on it | Press **Cancel Site** |
| **Not yourself** | You put yourself on a site you add here | Take yourself off; add your own from Home |
| **Not working here** | Someone is not on the active staff on its first day | Take them off |
| **Not changed. Try again.** | The hub could not be reached | Try again |

### Decide an older request {#people-worksites-requests needs="people approve"}

Requests made before temporary sites still show under **Temporary** while one waits or is in force.

1. Choose **Temporary**, then **Requests**. **Waiting** lists those to decide; **Approved**,
   **Rejected**, **Cancelled** and **All** the rest. Type in **Name or Number** to find one.
2. Press one. It shows its type (**Temporary Home**, **Remote Day** or **Client Visit**), its days,
   its **Place** and **Reason**.
3. When it waits on you, choose **Approve**, or **Reject** with a **Reason**, and press
   **Record Decision**. The message names it, such as *WLR-0003 approved*.

**Decision not recorded** means the hub could not be reached: try again.

### Change an older field assignment {#people-worksites-field needs="people approve"}

1. Choose **Temporary**, then **Field**. Press an assignment **In Progress** or **Upcoming**.
2. To take someone off, press **Take Off** on their row under **People**, type the **Reason** and
   press **Take Off**. The message names them, such as *Ada Obi taken off*. With one person left
   there is no **Take Off**: cancel the assignment instead.
3. To end it, press **Cancel Assignment**, type the **Reason** and press **Cancel Assignment**. The
   message names it, such as *FA-0002 cancelled*.

| The screen says | What it means | What to do |
|---|---|---|
| **At least 10 characters** | The reason is too short | Say more |
| **This field assignment is cancelled** | Someone cancelled it first | Close it |
| **This field assignment has ended** | Its last day has passed | Nothing to change |
| **That person is not on this field assignment** | Someone took them off first | Close it |
| **Not changed** | The hub could not be reached | Try again |

```shot people-employees
open: /people?tab=employees
as: operations
marks:
  1: button "Add Employee" | Add a person
  2: button "Import Staff" | Import a spreadsheet
  3: searchbox | Find anyone
```

```shot people-add-person
open: /people?tab=employees
as: operations
do:
  - click: button "Add Employee"
  - wait: label "First Name"
crop: modal
marks:
  1: label "First Name" | Their first name
  2: label "Work Email" | Their sign-in email
  3: button "Next" | The next step
```

```shot people-add-job
open: /people?tab=employees
as: operations
do:
  - click: button "Add Employee"
  - fill: label "First Name" = Ada
  - fill: label "Last Name" = Okafor
  - fill: label "Work Email" = ada.okafor@mycityapp.io
  - fill: label "Phone" = 0803 123 4567
  - click: button "Next"
  - wait: label "Job Title"
crop: modal
marks:
  1: label "Department" | Pick the department
  2: label "Start Date" | Their first day
  3: label "Worksite" | Their office
```

```shot people-record
open: /people?tab=employees
as: operations
do:
  - click: row 1
  - wait: button "Edit Record"
marks:
  1: button "Edit Record" | Correct the record
  2: button "Archive Record" | When they leave
  3: tab "Login" | Their login
```

```shot people-organogram
open: /people?tab=organogram
as: operations
sources:
  - app/src/features/organogram/OrgTree.tsx
do:
  - click: heading "Organogram"
marks:
  1: searchbox | Find someone
  2: button "Download PDF" | Save the chart
```

```shot people-attendance
open: /people?tab=attendance
as: operations
sources:
  - app/src/features/attendance/PeopleAttendance.tsx
do:
  - click: heading "Attendance"
marks:
  1: role radiogroup "View" | Register, Exceptions, Deductions, Overtime
  2: role group "Status" | One status only
```

```shot people-attendance-day
open: /people?tab=attendance
as: operations
sources:
  - app/src/features/attendance/PeopleAttendance.tsx
do:
  - click: row 1
  - wait: heading "Punches"
crop: modal
marks:
  1: heading "Punches" | Each punch and its result
```

```shot people-leave
open: /people?tab=leave
as: operations
do:
  - click: heading "Leave"
marks:
  1: button "Leave Calendar" | Who is away
  2: button "Record Leave" | Record agreed leave
```

```shot people-leave-request
open: /people?tab=leave
as: operations
sources:
  - packages/ui/src/layout/ListDetail.tsx
do:
  - click: button "Pending"
  - click: row 1
  - wait: button "Approve"
marks:
  1: button "Reject" | Say no, with a reason
  2: button "Approve" | Grant it
```

```shot people-devices
open: /people?tab=devices
as: operations
sources:
  - app/src/features/attendance/Devices.tsx
do:
  - click: heading "Devices"
marks:
  1: role group "Status" | Registered, New or Removed
  2: searchbox | Find a device or person
```

```shot people-worksites
open: /people?tab=worksites
as: operations
sources:
  - app/src/features/attendance/Worksites.tsx
do:
  - click: heading "Worksites"
marks:
  1: button "Add Worksite" | Add an office
  2: role radiogroup "Worksites" | Permanent or Temporary
```

```shot people-add-worksite
open: /people?tab=worksites
as: operations
sources:
  - app/src/features/attendance/Worksites.tsx
do:
  - click: button "Add Worksite"
  - wait: label "Latitude"
crop: modal
marks:
  1: label "Name" | Its name
  2: label "Address" | Pick the address
  3: label "Radius, Metres" | The circle that counts
```

```shot people-schedule
open: /people?tab=employees
as: operations
sources:
  - app/src/features/attendance/WorkSetup.tsx
do:
  - click: row 2
  - click: tab "Work Schedule"
  - wait: button "Set Schedule"
marks:
  1: button "Set Schedule" | Set their week
```

```shot people-schedule-set
open: /people?tab=employees
as: operations
sources:
  - app/src/features/attendance/WorkSetup.tsx
do:
  - click: row 2
  - click: tab "Work Schedule"
  - click: button "Set Schedule"
  - wait: button "Save Schedule"
crop: modal
marks:
  1: label "From" | The first day
  2: label "Reason" | Why it changed
  3: button "Save Schedule" | Save it
```

```shot people-reporting
open: /people?tab=employees
as: operations
sources:
  - app/src/features/shared/ReportingForm.tsx
do:
  - click: row 2
  - click: tab "Reporting Line"
  - click: button "Change Manager"
  - wait: button "Save Line"
crop: modal
marks:
  1: text "Manager Is" | A person or an open role
  2: button "Save Line" | Save it
```

```shot people-add-role
open: /people?tab=organogram
as: operations
device: desktop
sources:
  - app/src/features/organogram/OrgTree.tsx
do:
  - click: button "Add Role"
  - wait: label "Role Title"
crop: modal
marks:
  1: label "Role Title" | The post's title
  2: label "Department" | Where it sits
```

```shot people-attendance-decide
open: /people?tab=attendance
as: operations
sources:
  - app/src/features/attendance/PeopleAttendance.tsx
do:
  - click: role radio "Exceptions"
  - click: row 1
  - wait: button "Record Decision"
crop: modal
marks:
  1: label "Reason" | Why you decided so
  2: button "Record Decision" | Record it
```

```shot people-attendance-pay
open: /people?tab=attendance
as: operations
sources:
  - app/src/features/attendance/PayItems.tsx
do:
  - click: role radio "Deductions"
  - wait: text "Pending"
marks:
  1: role radio "Deductions" | The deductions
  2: role group "Deductions" | Pending, Waived or All
```

```shot people-leave-record
open: /people?tab=leave
as: operations
do:
  - click: button "Record Leave"
  - wait: label "Employee"
crop: modal
marks:
  1: label "Employee" | Who is away
  2: label "Leave Type" | The kind of leave
```

```shot people-leave-type
open: /people?tab=leave
as: operations
sources:
  - app/src/features/people/LeaveSettings.tsx
do:
  - click: button "Leave Types"
  - click: text "Annual"
  - wait: button "Save Type"
crop: modal
marks:
  1: label "Days a Year" | The yearly allowance
  2: button "Save Type" | Save it
```

```shot people-worksites-site
open: /people?tab=worksites
as: operations
sources:
  - app/src/features/attendance/TemporarySites.tsx
do:
  - click: role radio "Temporary"
  - click: row 1
  - wait: text "Added By"
crop: modal
marks:
  1: text "Added By" | Who asked for it
  2: text "Purpose" | Why they are going
```

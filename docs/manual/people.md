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
  **On Site**, **Hybrid** and **Remote**.
- Type in the search box to find someone by name, job title, staff number or work email.
- **Department**, **Status** and **Work Pattern** narrow the list. Archived people are hidden until
  you choose **Archived** under Status.
- **Status** reads **Active**, **On Probation**, **Suspended**, **Left** or **Archived**.
- **Login** reads **Active** (signs in), **Invited** (has a login but has not chosen a password
  yet), **Suspended**, **Left** or **No Login**.
- Press a row, or **View Record** on a computer, to open the person's record.
- Below the list, **Needs a Decision** lists what is waiting: probations and contracts ending in the
  next 30 days, people with no line manager, open seats, and people not invited yet. Press one to go
  to it.

On a phone each person is a card with their name, job title, status and login. **Sort** orders the
cards.

### Add an employee {#people-add-employee needs="people create"}

Add a person once they have accepted their offer, before their first day. The form has four steps,
and each step checks its own fields before **Next** lets you on, so nothing is refused at the end.

1. Open [People · Employees](/people?tab=employees).
2. Press **Add Employee** at the top right. On a phone it is also on the round button with a plus.
   ![The first step of Add Employee](shot:people-add-person)
3. On **Person**, fill in **First Name**, **Last Name**, **Work Email** and **Phone**.
   **Middle Name**, **Gender** and **Date of Birth** are optional. Press **Next**.
4. On **Job**, fill in **Job Title**, pick the **Department**, and choose the **Start Date**,
   **Employment Type** and **Work Pattern**.
   ![The Job step](shot:people-add-job)
5. For someone who works **On Site** or **Hybrid**, pick their **Worksite**, so they can clock in on
   their first day. For **Remote** it is optional.
6. If you know them, set **Contract Ends**, **Probation Ends** and the **Line Manager**. Press
   **Next**.
7. On **Pay and Bank**, enter **Gross Monthly**, **Bank** and the ten-digit **Account Number** if
   you have them. Press **Next**.
8. On **Next of Kin**, enter **Next of Kin**, **Next of Kin Phone** and **Relationship** if you have
   them.
9. Press **Add Employee**. The hub gives the person the next staff number, says so, and opens their
   record.

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
| **Pick a worksite** | On Site or Hybrid with no worksite, on Add Employee or Edit Record | Pick one, or choose Remote |
| **Not before the start** | A contract or probation end before the start date | Correct the date |
| **Before the start date** | A date of birth on or after the start date | Correct the date |
| **Already in use** | Another employee has this work email | Use the person's own address, or open the other record |
| **Archived record** | An archived record has this work email | Restore that record instead of adding a new one |
| **Used by a login** | Somebody else's login signs in with this email | Ask an administrator on Settings · Users |
| **Not an employee** | The line manager has left or is suspended | Pick someone on the active staff |

If the hub cannot be reached, a line above the buttons says
**Not saved. Check your connection and try again.** Your answers stay in the form.

### Open and correct a record {#people-record}

A record's tabs are **Profile**, **Job**, **Work Schedule**, **Reporting Line**, **Login** and
**History**.

![A person's record](shot:people-record)

1. Open the person from [People · Employees](/people?tab=employees).
2. {needs="people edit"} Press **Edit Record**. The form holds the same fields as Add Employee.
3. {needs="people edit"} Change what is wrong and press **Save Record**. Empty a field to remove what
   it held. Moving someone to **On Site** or **Hybrid** asks for their **Worksite**.
4. **History** lists every change: what changed, who changed it and when.

Fields shown as **Restricted** are ones your role does not see, or that nobody has filled in yet.

### Change who someone reports to {#people-reporting needs="people edit"}

1. Open the person's record and choose **Reporting Line**.
2. Press **Change Manager**.
3. Under **Manager Is**, choose **A Person** and pick the **Line Manager**, or **An Open Role** for
   a post nobody holds yet.
4. Optionally pick a **Dotted Line**, a second manager for shared work. It does not change who
   approves their leave or expenses.
5. Type a **Reason** if it helps, and press **Save Line**.

### Give someone a login {#people-invite needs="settings create"}

A person needs a login to sign in. The hub emails them a link to choose their own password.

1. Open the person's record. Their **Login** reads **No Login**.
2. Press **Send Invite** at the top of the record.
3. Check the **Employee**, then pick their **Roles**. **Staff** is already picked.
4. Press **Send Invitation**. They get an email that works once, for 72 hours.

If they lost the email or it expired, open **Login** on their record and press **Send Invite**
again. It sends a new link and the old one stops working.

> **Important:** A person who has already chosen a password signs in with it. To help someone who
> forgot it, send a reset link from [Settings · Users](/settings?tab=users).

### Archive or restore a record {#people-archive needs="people delete"}

Archive a person when they leave MyCity. Their record and history are kept, but they leave every
list and the organogram, and their login stops working at once.

1. Open the person's record and press **Archive Record**.
2. Type the **Reason**, such as `Left the company`, and press **Archive Record**.
3. To bring them back, choose **Archived** under Status on the list, open them and press
   **Restore Record**. Their login stays closed until an administrator reactivates it on
   [Settings · Users](/settings?tab=users).

### Import many people at once {#people-import needs="people create"}

1. Press **Import Staff** at the top of [People · Employees](/people?tab=employees).
2. The import opens on [Settings · Imports](/settings?tab=imports), set to employees. Follow
   [Import a spreadsheet](#settings-imports-run).

## Organogram {#people-organogram screen=people/organogram icon=users}

The whole company's structure as a tree: who reports to whom, and the open roles nobody holds yet.
People and Operations shape it here. Everyone else reads it on
[Org Chart](/ess?tab=org-chart) in Employee Self-Service.

![The Organogram](shot:people-organogram)

### Read the structure {#people-organogram-read}

1. Open [People · Organogram](/people?tab=organogram). The line under the title counts the seats,
   those filled and those open.
2. Type a name or a job in **Name or role** to mark the matching cards.
3. Press **Collapse** or **Expand** on a card to fold its team away or open it. **Expand All** opens
   every branch.
4. A solid line is the reporting line. A dashed line is a **Dotted Line**: a second manager for
   shared work, who does not approve leave, expenses or tasks. A dashed card is an open role.
5. Press a person's card to see their **Department**, who they **Reports To** and their team.
   **Open Record** opens their record; **Send Message** writes to them.
6. **Download PDF** saves the chart as a file.

On a phone, **Everyone** shows the company as a list. Tap a row to see that person in **Focus**, with
their manager, their reports and the people who share their manager.

### Change the structure {#people-organogram-change needs="people edit"}

1. To move someone, drag their card onto their new manager. The message names who they now report
   to. Or press their card, then **Change Manager**, and follow
   [Change who someone reports to](#people-reporting).
2. To add a post nobody holds yet, press **Add Role**. Type the **Role Title**, pick the
   **Department** and, if you know it, who it **Reports To**. Press **Save Role**.
3. To correct an open role, press **Edit Role** on its card.

| The field says | What to do |
|---|---|
| **Name the role** | Type the role's title |
| **Pick a department** | Pick the department it sits in |

## Attendance {#people-attendance screen=people/attendance icon=clock}

The day's attendance register: who is expected, who is in, who is late, and the punches waiting for
a decision. Operations and People see everyone. A line manager sees the people who report to them.

![People · Attendance](shot:people-attendance)

### Read the register {#people-attendance-read}

1. Open [People · Attendance](/people?tab=attendance). It opens on today. Choose another **Date**
   to see that day.
2. The figures count the day's people: **Expected**, **Present**, **Late**, **Absent**,
   **On Leave** and **Not In**, and the **Open Exceptions** waiting for a decision. Press one to see
   only those people.
3. Under **View**, keep **Register** for the day's list. Press a status chip, such as **Late**, to
   narrow it, or type in **Name or Location**.
4. Each row shows the person's **Status**, **Clock In**, **Clock Out**, **Arrangement**,
   **Location** (the place matched, and whether they were inside its circle), **Device** and
   **Review**.
5. Press a row to see the day's evidence: each punch with its **Server Time**, its **Result**, the
   **Device Time**, the reading's **Accuracy** and **Coordinates**, and its **Source**.
   ![A day's evidence](shot:people-attendance-day)
6. {needs="people export"} Press **Export**, choose the **Period** and press **Export Register** to
   save the register as a file.

### Decide an exception {#people-attendance-decide needs="people approve"}

An exception is a punch the hub could not accept on its own: outside the office's circle, a location
it could not read, an unknown device, a missing clock-out or a System Clock-Out.

1. Under **View**, choose **Exceptions**. **Open** lists those waiting; **Decided** those settled.
2. Press one. It shows the person, the punch, what was found, and their own note if they wrote one.
3. Under **Outcome**, choose **Accept** to keep the punch, **Reject** to stop it counting for the
   day, or **Add Clock-Out** with the **Clock-Out Time** the person left. For a System Clock-Out,
   **Correct Time** records when they really left.
4. Type the **Reason**, such as `Matches gate log`, and press **Record Decision**.

The punch itself never changes. Your decision is kept beside it, with your name and the time.

### Waive a deduction or decide overtime {#people-attendance-pay needs="people approve"}

1. Under **View**, choose **Deductions** or **Overtime**. Each item shows the person, the day, the
   minutes, the **Amount** and its **Status**.
2. To waive deductions, tick them, press **Waive Selected**, type the **Reason**, and press
   **Waive Deductions**. The day still counts as late; the pay is restored.
3. To decide overtime, press it. Change the **Minutes** to confirm fewer, then press **Confirm**, or
   press **Cut** with a reason.
4. To agree overtime ahead, open a person's day and press **Approve Overtime**.

**Restricted** in the Amount means your role does not see salaries. **No Salary Set** means the
person has no salary on their record yet.

## Leave {#people-leave screen=people/leave icon=calendar}

Everyone's leave requests, the decisions waiting on you, and the leave types and allowances.
Operations and People see everyone. A line manager sees the requests of the people who report to
them.

![People · Leave](shot:people-leave)

### Read the requests {#people-leave-read}

1. Open [People · Leave](/people?tab=leave).
2. The figures count those **On Leave Today**, those **Pending Approval**, those
   **Starting Soon** in the next 14 days, and those **Approved This Year**.
3. Press a chip, such as **Pending**, or type in **Name or type**.
4. Press a request. It opens beside the list, or over it on a phone, with the **Employee**,
   **Type**, **From**, **To**, **Days**, **Status**, who it is **Waiting On**, and **Also Away**: who
   else in the department is off then. On a phone, drag it down to close it.
5. **Leave Calendar** shows a month of approved and waiting leave.

### Approve or reject leave {#people-leave-decide needs="people approve"}

A request waits on the person's line manager first. Long leave then waits on Operations and People.

1. Press the request waiting on you. A request in **Need You** on your
   [Home · Overview](/home?tab=overview) opens here too.
   ![A request waiting on you](shot:people-leave-request)
2. Check **Also Away** for who else is off.
3. Press **Approve**. The message says the person has been told.
4. Or press **Reject**, type the **Reason**, and press **Reject Leave**. The person reads your reason.

### Record leave for someone {#people-leave-record needs="people create"}

For leave already agreed, such as sick leave told by phone.

1. Press **Record Leave**.
2. Pick the **Employee**, the **Leave Type**, the **First Day** and the **Last Day**. Add a **Note**
   if it helps.
3. Press **Record Leave**. It is recorded as approved, with no approval needed.

### Cancel granted leave {#people-leave-cancel needs="people edit"}

1. Press the approved request.
2. Press **Cancel Leave**, then confirm with **Cancel Leave**. The person is told.

### Set leave types and allowances {#people-leave-types needs="people edit"}

1. Press **Leave Types** to see each type with its **Allowance** and **Status**.
2. {needs="people create"} Press **Add Type**, type its **Name** and its **Days a Year** (leave it
   empty for a type with no limit, such as unpaid leave), and press **Add Type**.
3. Press a type to change it. Untick **Offered** to stop offering it on new requests.
4. Press **Allowances** to see each person's days for the year. Press **Set**, type the **Days**,
   and press **Save Allowance**. Leave it empty to use the type's usual allowance.

## Devices {#people-devices screen=people/devices icon=phone}

Every device staff have clocked in from, with its status. A person registers their own on
[My Devices](/ess?tab=my-devices).

![People · Devices](shot:people-devices)

1. Open [People · Devices](/people?tab=devices).
2. Press **Registered**, **New** or **Removed** to narrow the list, or type in **Device or Person**.
3. Each row shows the **Employee**, the **Device**, its **Status**, when it was **First Seen**, and
   its **Last Punch**.
4. {needs="people edit"} To take a device off, for a lost phone, press it, then **Remove Device**,
   type the **Reason** and confirm. The person can register a new one.

## Worksites {#people-worksites screen=people/worksites icon=pin}

The offices staff clock in at, each a centre and a circle around it, and the temporary sites people
work at for a few days.

![People · Worksites](shot:people-worksites)

### Read the worksites {#people-worksites-read}

1. Open [People · Worksites](/people?tab=worksites). **Permanent** lists the offices: their
   **Code**, **Address**, **Radius**, how many people are **Assigned**, and their **Status**.
2. Press **In Use**, **Retired** or **All**, or type in **Name or Address**.
3. Press a worksite to see its map, its circle and its **Assigned People**.
4. **Temporary** lists the temporary sites, those **Awaiting Approval** first.

### Add or change a worksite {#people-worksites-add needs="people create"}

1. Press **Add Worksite**.
   ![Add Worksite](shot:people-add-worksite)
2. Type its **Name**, such as `Lekki Office`.
3. Start typing the **Address** and pick it from the list. It fills **Latitude** and **Longitude**.
   Or press **Drop a Pin** and pin it on the map.
4. Set the **Radius, Metres**: a punch within it counts as on site. MyCity's offices use about 100.
5. Press **Add Worksite**. The message **Worksite added** confirms it.
6. {needs="people edit"} To change one, open it and press **Edit Worksite**, then **Save Worksite**.
   **Assign Employee** adds the people who work there. **Retire Worksite** stops its use;
   **Restore Worksite** brings it back.

A radius from 25 to 1,000 metres is allowed. Outside that, the field says **Too short** or
**Too long**.

### Decide a temporary site {#people-worksites-temporary needs="people approve"}

When someone asks to work elsewhere with **Add Work Site**, it waits here for approval.

1. Choose **Temporary**, then press a site **Awaiting Approval**.
2. Read its **Purpose**, days, addresses on the map, **People** and **Description**.
3. Press **Approve**, or **Reject** with a reason. The people on it are told.
4. For a site in force, **Cancel Site** ends it early, and **Take Off** on a person removes them.
5. {needs="people approve"} **Add Temporary Site** sends people out yourself, with no approval
   needed: the same form as **Add Work Site**, with **Save Site**.

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

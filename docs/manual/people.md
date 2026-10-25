---
title: People
module: people
milestones: M0
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

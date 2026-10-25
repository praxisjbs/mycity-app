---
title: Quick Start
kind: quick-start
summary: The few things each person does first, one card each.
icon: spark
---

## Sign In {#qs-sign-in role="Everyone" icon=lock}

![The sign-in screen](shot:qs-sign-in)

1. Open the hub and type your work email and password.
2. Press **Sign In**.
3. If it asks to **Enter Code**, type the six digits from your authenticator app.
4. Forgot your password? Press **Forgot Password**. Read
   [Signing In](#start-sign-in) for every case.

## Find Anything {#qs-search role="Everyone" icon=srch}

![Search, open](shot:qs-search)

1. Press Ctrl and K (⌘ and K on a Mac), or **Search** on a phone.
2. Type a name, a screen or something to do.
3. Press the result to open it. Read [Search](#start-search).

## Read Your Notifications {#qs-notifications role="Everyone" icon=bell}

![The notifications panel](shot:qs-notifications)

1. Press the bell, **Notifications**.
2. Press a notification to open what it is about.
3. **Mark All Read** clears them all. Read [Notifications](#start-notifications).

## Get Help Anywhere {#qs-help role="Everyone" icon=help}

1. On a phone, press the round button with a plus at the bottom right, then **Help**.
2. On a computer, press your name at the foot of the menu, then **User Guide**.
3. The guide opens at the screen you were on. Read [Using This Guide](#start-user-guide).

## Add an Employee {#qs-add-employee role="People & HR" icon=users needs="people create"}

![Add Employee, first step](shot:qs-add-employee)

1. Open [People · Employees](/people?tab=employees) and press **Add Employee**.
2. Fill in **Person**, **Job**, **Pay and Bank** and **Next of Kin**, pressing **Next** after each.
3. Pick a **Worksite** for anyone On Site or Hybrid.
4. Press **Add Employee**. Read [Add an employee](#people-add-employee).

## Give Someone a Login {#qs-invite role="People & HR" icon=send needs="settings create"}

![Settings, Users](shot:qs-invite)

1. Open [Settings · Users](/settings?tab=users) and press **Invite User**.
2. Pick the **Employee** and their **Roles**.
3. Press **Send Invitation**. They choose their own password from the email. Read
   [Give someone a login](#settings-users-invite).

## Import a Staff List {#qs-import role="People & HR" icon=sheet needs="people create"}

1. Open [People · Employees](/people?tab=employees) and press **Import Staff**.
2. Upload the sheet, check the columns, then read the **Preview**.
3. Press **Commit Import**. Read [Import a spreadsheet](#settings-imports-run).

## Change a Role {#qs-roles role="Administrators" icon=shield screen=settings/roles-and-permissions needs="settings edit"}

![Settings, Roles & Permissions](shot:qs-roles)

1. Open [Settings · Roles & Permissions](/settings?tab=roles-and-permissions) and pick a role.
2. Press **Edit Role**, change its access, and press **Save Role**.
3. Check the review and press **Save Role** again. Read
   [Change or delete a role](#settings-roles-edit).

## Help With a Login {#qs-login-help role="Administrators" icon=key screen=settings/users needs="settings edit"}

1. Open [Settings · Users](/settings?tab=users) and press the person.
2. **Send Reset Link** for a forgotten password, **Reset Two-Step** for a lost phone,
   **Sign Out Everywhere** for a lost device.
3. Read [Help someone with their login](#settings-users-help).

## Check the System {#qs-status role="Administrators" icon=chart screen=settings/status}

![Settings, Status](shot:qs-status)

1. Open [Settings · Status](/settings?tab=status). The pill reads **All Up** when all is well.
2. Press **Open** on any check that is not up.
3. Open [Settings · Faults](/settings?tab=faults) for the errors behind it. Read
   [Work through the faults](#settings-faults-work).

```shot qs-sign-in
open: /
as: guest
marks:
  1: css #email | Your work email
  2: button "Sign In" | Sign in
```

```shot qs-search
open: /home?tab=overview
as: staff
device: desktop
do:
  - click: text "Search Anything"
  - fill: css input[aria-label="Search"] = leave
  - wait: text "Screens"
crop: modal
```

```shot qs-notifications
open: /home?tab=overview
as: staff
device: desktop
do:
  - click: button "Notifications"
  - wait: button "Mark All Read"
marks:
  1: button "Mark All Read" | Mark everything read
```

```shot qs-add-employee
open: /people?tab=employees
as: operations
do:
  - click: button "Add Employee"
  - wait: label "First Name"
crop: modal
```

```shot qs-invite
open: /settings?tab=users
as: operations
device: desktop
marks:
  1: button "Invite User" | Give someone a login
```

```shot qs-roles
open: /settings?tab=roles-and-permissions
as: admin
device: desktop
```

```shot qs-status
open: /settings?tab=status
as: admin
device: desktop
```

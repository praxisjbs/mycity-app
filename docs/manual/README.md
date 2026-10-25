# Writing the User Guide

The User Guide is the Knowledge Hub's **User Guide** tab: how to use every screen of the hub, for a
person who is not technical. This folder is its source. The API reads these files, cuts each one to
the reader's grants down to the step, and the tab shows it. The engineering guide is
`docs/guides/user-guide.md`; this page is for whoever writes a chapter, a person or an agent.

## What lives here

| File | What it is |
|---|---|
| `getting-started.md` | Signing in, the hub's layout, search, notifications, your own settings. Everyone reads it |
| `quick-start.md` | The Quick Start: short illustrated cards, grouped by role |
| `<module>.md` | One chapter per module (`people.md`, `settings.md`), in the rail's order |
| `img/<chapter>/` | The chapter's pictures, `<shot>.desktop.png` and `<shot>.phone.png`, and `shots.json` |
| `performance-guide/` | The printed Performance training guide (A4). Not part of the tab |

A file that does not start with front matter is not in the guide yet (the gate names the ones
waiting for their milestone). An empty file is a stub a later milestone fills.

## Who writes what, and when

A milestone's chapters are written once that milestone is delivered and approved, in its own pull
request (JBS Praxis, 25/10/2026): PR 1 the foundation, M0 and Settings; PR 2 Milestone 1; PR 3
Milestone 2; then one per milestone. A screen brought forward and built early (Settings, Praxis AI,
AI Control) gets its chapter as soon as it is live, without naming its milestone in `milestones`,
which would ask for that milestone's screens not built yet. Each chapter is its own file with its own pictures folder, so
two pull requests never edit the same file.

## A chapter

~~~md
---
title: People
module: people
milestones: M0
summary: The staff register, each person's record, and their login.
icon: users
---

## Employees {#people-employees screen=people/employees}

Everyone who works for MyCity, one row each.

![The Employees list](shot:people-employees)

### Add an employee {#people-add-employee needs="people create"}

1. Open [People · Employees](/people?tab=employees).
2. Press **Add Employee** at the top right.
   ![The first step of Add Employee](shot:people-add-step-1)
3. Fill in **First Name** and **Last Name**, then press **Next**.

> **Tip:** Every field marked Required must be filled before **Next** works.

```shot people-employees
open: /people?tab=employees
as: operations
marks:
  1: button "Add Employee" | Add a person
  2: searchbox | Find anyone by name or number
```
~~~

### The rules the gate holds you to (`scripts/check/user-guide.js`)

- **Front matter**: `title` and `summary` always; `module` (a module key: `people`, `settings`)
  for a module's chapter, or `order` for one that is not (Getting Started is 0); `milestones`
  names every milestone whose screens this chapter answers for. Every screen of a named milestone
  must then have a section somewhere in the guide. `covers` lists more code paths whose change
  must change this chapter (a section's screen folder is covered already). `icon` is one of the
  hub's icons.
- **Sections** are `## Title {#slug screen=<module>/<tab>}`. A section about a tab is shown only
  to people who can open that tab, exactly as the menu shows it. Slugs are lower-case words and
  hyphens, unique across the whole guide; start them with the chapter's name (`people-...`).
- **Tasks** are `### Title {#slug needs="..."}`: one job, its steps.
- **Steps** are a numbered list, one action each, in the order a person does them. A step that
  only some readers may take starts with `{needs="..."}`: the others never receive it, and the
  steps they do receive are numbered without it.
- **Bold is a name on screen**, exactly as it reads: **Add Employee**, **Next**, **Required**.
  The gate looks every bold name up in the hub's source; a button renamed later fails the chapter
  until it is corrected. Never use bold for emphasis.
- **A button that is one of ⌘K's actions** (**Add Employee**, **Invite User**) is only named in a
  step, task or section that needs its grant (`needs="people create"`).
- **Links**: `[People · Employees](/people?tab=employees)` opens a screen (write the screen's
  name as its words); `[Add an employee](#people-add-employee)` opens another part of the guide;
  `https://` opens a page outside. Link a screen wherever a step names one. Pressing a screen link
  leaves a **Back to Guide** chip that brings the reader back to the same step.
- **Notes**: `> **Tip:** ...`, `> **Important:** ...`, or a plain `> ...`.
- **Tables**: pipe tables, for a form's fields (Field, What to Enter, Needed).
- **needs** reads `"<module> <action>"` (`people create`, `settings edit`), several with commas,
  `cap <code>` for a capability (`cap home.team`), `manager` for someone with people reporting to
  them, `ceo` for the CEO.

### Pictures

`![What it shows](shot:<id>)` puts a picture on its own line, or on a step's line (or indented
under it). Its spec is a fenced `shot <id>` block anywhere in the same file:

| Key | What it says |
|---|---|
| `open` | The screen's address, `/people?tab=employees` |
| `as` | The demo account: `operations` (People), `ceo`, `manager`, `staff`, `admin` |
| `device` | `both` (the default), `desktop` or `phone` |
| `do` | Steps before the picture: `click: button "Add Employee"`, `fill: label "First Name" = Ada`, `press: Escape`, `wait: text "Saved"`, `scroll: heading "Bank"`, `lock: idle` (the lock screen, as Session Locked; `time` is Session Ended, `ended` Signed Out). A step starting `phone ` or `desktop ` runs on that device only: `phone click: button "More Actions"` |
| `marks` | Numbered marks drawn on the picture: `1: button "Add Employee" \| Add a person`. The legend under the picture lists them |
| `crop` | `page` (the default), `modal` (only the open dialog or sheet), `viewport`, or a CSS selector |
| `sources` | More files the picture depends on, beside the screen's feature folder |

A target is `button "Name"`, `link "Name"`, `tab "Name"`, `label "Field"`, `text "Words"`,
`heading "Title"`, `searchbox`, `row 1`, `role <role> "Name"` or `css <selector>`.

Take them with `npm run guide:shots` (every chapter), `-- --chapter people`, `-- --shot
people-employees` or `-- --stale` (only the ones the gate calls stale). The script builds the demo,
signs in as the account, does the steps, draws the marks and saves both files with their hashes in
`shots.json`. A picture is stale when its spec or its screen's code changed after it was taken: the
gate fails it, with no exemption, until it is retaken.

The demo's data is the staging seed's, so pictures show invented people, never a real person's
private data.

## Writing for the reader

- Write for someone who has never used the hub. Say where to go, what to press, what they will see,
  and what to do if it goes wrong.
- One action per step. Name the button and where it is ("at the top right", "at the bottom of the
  form").
- Say what each message means and what to do about it, using the message's own words in bold.
- Plain words, short sentences (at most 20 words), no dashes, day-first dates.
- Explain why only where it changes what the reader does.

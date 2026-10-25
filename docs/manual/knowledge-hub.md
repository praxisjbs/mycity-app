---
title: Knowledge Hub
module: knowledge
milestones: M1
summary: MyCity's policies: writing them, publishing new versions, and seeing who has acknowledged them.
icon: book
---

The Knowledge Hub holds what MyCity knows: its policies, and this User Guide. Everyone reads the
policies that apply to them on [Policy Updates](/ess?tab=policy-updates) in Employee
Self-Service. This chapter is for the people who write them.

## Policies {#knowledge-policies screen=knowledge/policies icon=book}

Every company policy in one place, each with its versions: what is in force today, what starts
later, and who has acknowledged it. Operations and People and the CEO write and publish them.

![Policies](shot:knowledge-policies)

### Find a policy {#knowledge-policies-find}

1. Open [Knowledge Hub · Policies](/knowledge?tab=policies).
2. Press a chip to narrow the list: **In Force**, **Awaiting Approval**, **Draft** or **Archived**.
   **All** shows every policy.
3. Type in **Search policies** to find one by name.
4. Each row shows the **Policy**, its **Type**, who it **Applies To**, the version **In Force**, its
   **State**, and how many have **Acknowledged** it, such as *22 of 24*.
5. Press a policy to open it. **All Policies** at the top goes back to the list.

### Write a new policy {#knowledge-policies-new needs="knowledge create"}

1. Press **New Policy** at the top right.
   ![New Policy](shot:knowledge-new-policy)
2. Type its **Title**, such as `Dress Code`, and press **Start Policy**. The message
   **Policy started** confirms it, and its draft opens.
3. Under **Policy Settings**, choose who it **Applies To**: **Everyone**, or **Some People** and
   then the **Departments**, **Work Patterns** or **People** it covers.
4. Keep **Needs Acknowledgement** ticked if each person must confirm they have read it. Set
   **Acknowledge Within**, the days they have after it is published.
5. Tick **Needs Approval** if it must be approved before it is published.
6. Under **Policy Text**, type the policy, or paste it from a document.
7. Press **Tidy With AI** if you want headings and lists suggested. It shows **Yours** beside
   **Tidied**, with the same words. Press **Use Tidied Text**, or **Keep Mine**.
8. Press **Save Draft**. The message **Draft saved** confirms it. Nobody is told yet.

### Change a policy in force {#knowledge-policies-change}

1. Open the policy. Its card shows its **Number**, **Type**, who it **Applies To**, and the version
   **In Force** with its first day.
   ![A policy, open](shot:knowledge-policy)
2. Change the settings or the text, then press **Save Draft**.
3. A yellow bar says the draft is saved and not published.

> **Important:** For a written policy, the **Policy Text** box starts empty, even when a version is
> in force. Paste the whole text of the new version, not only the part that changed. What you
> publish replaces the version in force.

**Discard Changes** throws the draft away.

### Publish a policy {#knowledge-policies-publish}

1. Open the policy with its draft saved.
2. Press **Publish Policy** in the yellow bar. For a policy that **Needs Approval**, it reads
   **Submit for Approval**.
3. Check the changes listed at the top.
4. Choose the **First Day** the new version applies from.
5. Add a **Note** saying what changed, such as `Grace now 10`.
6. Sign with your finger or mouse in **Your Signature**.
7. Press **Publish Policy**, or **Submit for Approval**.

Once published, everyone it applies to is asked to acknowledge it on their next sign-in, after they
clock in. A version that starts later shows a bar with its first day; press **Withdraw Version** to
take it back before then.

A version sent for approval shows **Awaiting approval** with who it waits on. The approvers find it
under **Waiting On You** on [Policy Updates](/ess?tab=policy-updates). Press
**Recall Submission** to take it back to the draft.

| The screen says | What to do |
|---|---|
| **Write the policy** | The text is empty. Type or paste it |
| **Sign in the box** | Sign in **Your Signature** before you publish |

### See who has acknowledged {#knowledge-policies-acknowledged}

1. Open the policy and press a version under **Versions**.
2. Read its text and signatures. **Download PDF** saves it with MyCity's letterhead.
3. Under **Acknowledgements**, choose **Acknowledged**, **Pending** or **Overdue** to see each
   group, or **Everyone**.

### Set the Attendance policy {#knowledge-policies-attendance}

The Attendance policy is MyCity's rules for the clock: working hours, lateness, deductions, overtime
and location checks. It applies to everyone, and it cannot be archived.

1. Open **Attendance Policy** in the list.
   ![The Attendance policy](shot:knowledge-attendance)
2. Each section is a card: **Working Hours**, **Lateness**, **Late Arrivals**, **Early Departure**,
   **Absence**, **Forgotten Clock-Outs**, **Location Flags**, **Overtime**, **Location Checks**,
   **Devices** and **Clock Prompts**.
3. Change a rule. A rule you changed is marked **Changed**. A switch that is on shows its figures.
4. Press **Save Draft**, then publish it as any policy.

A new version applies from its first day. Days before it keep the rules they were judged by.

### Archive a policy {#knowledge-policies-archive}

1. Open the policy and press **Archive Policy**.
2. Type the reason, such as `Replaced by the handbook`, and confirm.
3. The message **Policy archived** confirms it. It leaves Policy Updates, and its versions are kept.

```shot knowledge-policies
open: /knowledge?tab=policies
as: operations
sources:
  - app/src/features/policies/PoliciesHub.tsx
marks:
  1: button "New Policy" | Write a policy
  2: role group "State" | In force, drafts, archived
  3: searchbox | Find a policy
```

```shot knowledge-new-policy
open: /knowledge?tab=policies
as: operations
sources:
  - app/src/features/policies/PoliciesHub.tsx
do:
  - click: button "New Policy"
  - wait: button "Start Policy"
crop: modal
marks:
  1: label "Title" | Its title
  2: button "Start Policy" | Start its draft
```

```shot knowledge-policy
open: /knowledge?tab=policies
as: operations
sources:
  - app/src/features/policies/PoliciesHub.tsx
  - app/src/features/policies/PolicyDraft.tsx
do:
  - click: css [data-ui=page] tbody tr:has-text("Data Protection"), [data-ui=page] ul[data-copy=content] > li:has-text("Data Protection")
  - wait: button "Tidy With AI"
marks:
  1: role radiogroup "Applies To" | Who it applies to
  2: button "Tidy With AI" | Headings and lists
```

```shot knowledge-attendance
open: /knowledge?tab=policies&policy=attendance
as: operations
sources:
  - app/src/features/policies/PoliciesHub.tsx
  - app/src/features/policies/PolicyDraft.tsx
marks:
  1: heading "Working Hours" | Each day's hours
```

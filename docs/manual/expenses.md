---
title: Expenses
module: expenses
milestones: M8
summary: Asking for company money, approving it, paying it, and keeping each budget.
icon: wallet
---

Expenses is how anyone at MyCity asks for company money and gets it paid. You raise one request,
with each item on its own line. Your line manager, then Operations & People, approve it. Operations
& People group approved requests into a requisition for the CEO. Once the CEO approves, each request
is paid by bank transfer.

Your own requests are in [Employee Self-Service · My Requests](/ess?tab=my-requests). The other
screens are tabs of **Expenses** in the menu: **Requisitions**, **Approvals**, **Disbursements**,
**Projects**, **Budgets** and **Categories**. On a phone, press **More** in the bar at the bottom,
then **Expenses**.

## My Requests {#expenses-my-requests screen=ess/my-requests icon=wallet}

My Requests lists every request you raised, newest first, with who it waits on now.

![My Requests](shot:expenses-my-requests)

### Raise a request {#expenses-raise needs="expenses create"}

1. Open [Employee Self-Service · My Requests](/ess?tab=my-requests). Or open
   [Expenses · Requisitions](/expenses?tab=requisitions) or [Expenses · Approvals](/expenses?tab=approvals).
2. Press **New Request** at the top right. The request is yours, and shows on your My Requests.
   ![The New Request form](shot:expenses-new-request)
3. Write the **Purpose**: what the money is for.
4. Press **Pick Category**. Choose **Operating** or **Capital** to narrow the list, type part of a
   name to search, then press the category. Or press **Suggest Category** to have one picked from
   your purpose and items; check it before you send.
5. Pick a **Project** if the money is for one, and check the **Department**.
6. Fill in each item: what it is, its **Quantity** and **Unit Price**. Press
   **Add Line** for another item, and the bin beside an item to take it out. For a discount or an
   amount already paid, add a line with a minus before its **Unit Price** (-100,000). The
   **Total** is what the invoice asks to be paid.
7. Pick the **Payee**: **Staff**, **Vendor**, **Partner** or **Dedicated Task Team (DTT)**.
8. For yourself, tick **Use My Company Account** to be paid into the bank account on your profile.
   For anyone else, fill in **Payee Name**, **Bank**, **Account Name** and **Account Number**.
   Type the **Bank** and pick it from the list; if it is not there, press **Add** to keep it as
   typed, and it is offered to everyone from then on.
9. Attach the invoice under **Invoice**. Press **Read Invoice** to fill the payee and the items from
   it, with its discounts and anything already paid as minus lines, then check every line. If the
   message says **Invoice asks** another amount, put the lines right before you send.
10. Press **Send Request**. Or press **Save Draft** to finish it later.

> **Tip:** In [Praxis AI · Ask](/praxis-ai?tab=ask), say "Raise an expense request". It asks **What are you paying
> for? How many? How much is each?** and draws the request for you to check. To list several items,
> say so: it saves a draft, then offers **Add Another Item** and **Send Request**.

> **Tip:** **Over Budget** on a request means it is more than its department has left for that
> category this year. It is still sent; the approvers see it.

### Follow a request {#expenses-follow}

1. Open [Employee Self-Service · My Requests](/ess?tab=my-requests).
2. The tiles count **In Flight**, **Disbursed This Year**, **Average Turnaround** and **Rejected**.
   Press **In Flight** or **Disbursed This Year** to list those requests.
3. Press a request. It opens over the list with its lines, its payee and its **History**.
4. A request sent back to you says why. Press **Edit Request**, change it, then press **Send Again**.
5. Press **Cancel Request** to stop a request until Operations & People approve it, then
   **Cancel Request** again to confirm. After that, ask Operations & People to withdraw it.

```shot expenses-my-requests
open: /ess?tab=my-requests
as: staff
sources:
  - app/src/features/expenses/MyRequests.tsx
  - app/src/features/expenses/parts.tsx
marks:
  1: button "New Request" | Raise a request
```

```shot expenses-new-request
open: /ess?tab=my-requests
as: staff
sources:
  - app/src/features/expenses/MyRequests.tsx
  - app/src/features/expenses/parts.tsx
do:
  - click: button "New Request"
crop: modal
```

## Approvals {#expenses-approvals screen=expenses/approvals icon=check}

Approvals lists the requests waiting on you, the oldest first.

![Approvals](shot:expenses-approvals)

### Decide a request {#expenses-decide needs="expenses approve"}

1. Open [Expenses · Approvals](/expenses?tab=approvals).
2. The tiles count requests **With You**, their **Total Value**, the **Oldest**, and those
   **Approved This Month**. Press **With You** or **Approved This Month** to list those requests.
3. Press a request. It opens with its lines, the invoice (**Open Invoice**) and the budget it draws on.
4. **Over Budget** means it is more than the department has left for its category this year.
   **Possible Duplicate** means another request went to the same payee for the same amount within
   30 days. Press **Check Duplicate** to compare them.
5. Press **Approve**, **Send Back** or **Reject**. Send Back and Reject ask for a **Reason**.

```shot expenses-approvals
open: /expenses?tab=approvals
as: operations
sources:
  - app/src/features/expenses/index.tsx
marks:
  1: button "New Request" | Raise a request of your own
```

## Requisitions {#expenses-requisitions screen=expenses/requisitions icon=list}

Requisitions groups approved requests for the CEO. **Approved Requests** waits to be grouped.

![Requisitions](shot:expenses-requisitions)

### Group requests for the CEO {#expenses-group needs="expenses create, cap expenses.finance"}

1. Open [Expenses · Requisitions](/expenses?tab=requisitions).
2. Tick the requests under **Approved Requests**, up to 25.
3. Press **Create Requisition**. It goes to the CEO.

### Withdraw an approved request {#expenses-withdraw needs="expenses edit, cap expenses.finance"}

An approved request is taken back here until it is paid. Its requester is told why.

1. Open [Expenses · Requisitions](/expenses?tab=requisitions) and press a request under
   **Approved Requests**, or one in a requisition. On
   [Expenses · Disbursements](/expenses?tab=disbursements), press one under **Waiting to Pay**.
2. Press **Withdraw**, then **Withdraw Request** to confirm.
3. Write the **Reason**, then press **Withdraw Request**.

### Decide a requisition {#expenses-ceo needs="ceo"}

1. Open [Expenses · Requisitions](/expenses?tab=requisitions) and press a requisition.
2. Press **Remove** beside a request to take it out, write a **Reason**, then press
   **Remove Request**. It goes back to **Approved Requests**.
3. Press **Approve** to approve every request in it, or **Reject** with a **Reason**.

```shot expenses-requisitions
open: /expenses?tab=requisitions
as: operations
sources:
  - app/src/features/expenses/index.tsx
marks:
  1: button "Create Requisition" | Group the ticked requests
  2: button "New Request" | Raise a request of your own
```

## Disbursements {#expenses-disbursements screen=expenses/disbursements icon=wallet}

Disbursements lists requests the CEO approved, **Waiting to Pay**, and those **Paid**.

![Disbursements](shot:expenses-disbursements)

### Record a payment {#expenses-pay needs="expenses create, cap expenses.finance"}

1. Open [Expenses · Disbursements](/expenses?tab=disbursements).
2. The **Waiting to Pay** tile counts them; press it to list them. Press a request under
   **Waiting to Pay**. It opens with **Record Disbursement**; press it.
3. Fill in the **Bank Reference** from the bank's transfer, or attach the **Receipt**, and the
   **Paid On** day.
4. Press **Record Disbursement**.
5. With neither, **Save Without Reference?** asks first. Press **Save Anyway** to save it as
   **Reference Missing**, or **Add Reference** to go back to the **Bank Reference**.

### Add a missing reference {#expenses-reference needs="expenses edit, cap expenses.finance"}

1. Open [Expenses · Disbursements](/expenses?tab=disbursements). The **Reference Missing** tile
   counts them; press it to list them.
2. Press the payment, then **Add Reference**.
3. Fill in the **Bank Reference**, then press **Add Reference**.

### See a payment's receipt {#expenses-receipt needs="expenses view, cap expenses.finance"}

1. Open [Expenses · Disbursements](/expenses?tab=disbursements) and press a payment under **Paid**.
2. Press **Open Receipt** beside **Receipt** to check the transfer. **None** means no receipt was
   attached.

```shot expenses-disbursements
open: /expenses?tab=disbursements
as: operations
```

## Projects {#expenses-projects screen=expenses/projects icon=grid}

Projects shows each project's budget, what is committed (approved, not yet paid), spent and left.

![Projects](shot:expenses-projects)

### Raise a request for a project {#expenses-project-request needs="expenses create"}

1. Open [Expenses · Projects](/expenses?tab=projects) and press a project.
2. Press a request under **Requests** to open it.
3. Press **New Request**. The form opens with the project filled. Go on as in
   [Raise a request](#expenses-raise).

### Set a project's budget {#expenses-project-budget needs="expenses edit, cap expenses.finance"}

1. Open [Expenses · Projects](/expenses?tab=projects) and press a project.
2. Press **Set Budget**, fill in the **Budget**, then press **Set Budget**.
3. To take it away, press **Remove Budget**, then **Remove Budget** again to confirm.

```shot expenses-projects
open: /expenses?tab=projects
as: operations
```

## Budgets {#expenses-budgets screen=expenses/budgets icon=chart}

Budgets shows each department's budget for the year by category: allocated, committed, spent and
remaining. Pick the **Year** at the top.

![Budgets](shot:expenses-budgets)

### Set a department's budget {#expenses-new-budget needs="expenses create, cap expenses.finance"}

1. Open [Expenses · Budgets](/expenses?tab=budgets).
2. Press **New Budget**.
3. Pick the **Department** and the **Year**.
4. Pick a **Category** and fill in its **Amount**. Press **Add Category** for another one.
5. Press **Set Budget**.

### Change a budget {#expenses-edit-budget needs="expenses edit, cap expenses.finance"}

1. Open [Expenses · Budgets](/expenses?tab=budgets) and press a department.
2. Press **Edit Budget**, change the amounts, then press **Save Budget**.
3. Press **Budget History** to see every change, with who made it and when.

```shot expenses-budgets
open: /expenses?tab=budgets
as: operations
```

## Categories {#expenses-categories screen=expenses/categories icon=sheet}

Categories are what requests are for. Each shows its **Type** and this month's spend.

![Categories](shot:expenses-categories)

### Add the categories {#expenses-add-category needs="expenses create, cap expenses.finance"}

1. Open [Expenses · Categories](/expenses?tab=categories).
2. While there are none, press **Add Suggested Categories** to add twelve in one press.
3. Press **New Category**, fill in the **Name**, pick the **Type**, then press **Add Category**.
4. Press a category, change it, then press **Save Category**.
5. To stop offering it on new requests, press it, then **Deactivate**, and **Deactivate** again to
   confirm. **Offer Again** brings it back.

```shot expenses-categories
open: /expenses?tab=categories
as: operations
```

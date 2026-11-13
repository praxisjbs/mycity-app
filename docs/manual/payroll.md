---
title: Payroll
module: payroll
milestones: M6
summary: Paying everyone once a month: the run, payslips, deductions and advances, and the pay day.
icon: wallet
---

Payroll pays MyCity's people once a month. Operations & People open a run for the month and compute
it. They deal with anything wrong, then send it to the CEO. The CEO's approval locks the run and
publishes every payslip. Each person then reads theirs in
[Employee Self-Service · My Payslips](#ess-payslips).

Payroll is simple: monthly pay, less what attendance, fines and advances take, plus any one-off
adjustment. No tax or pension is taken while **Advanced Payroll** is off.

Payroll's screens are tabs of **Payroll** in the menu: **Payroll Runs**, **Payslips**,
**Deductions** and **Configurations**. On a phone, press **More** in the bar at the bottom, then
**Payroll**.

## Payroll Runs {#payroll-runs screen=payroll/payroll-runs icon=wallet}

Payroll Runs shows the open month's run, with what it pays and where it stands. **Run History**
lists every month; press one to show its run.

![Payroll Runs](shot:payroll-runs)

A run moves through five steps, shown under its title: **Draft**, **Computed**, **Submitted**,
**Approved** and **Paid**. Draft and Computed can still change. Approved is locked: nothing in it
changes again.

### Open a month's run {#payroll-runs-open needs="payroll create"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs).
2. Press **New Run** at the top right.
3. Pick the **Month**, then press **Open Run**. A month never has two runs, and a month still to
   come cannot be opened.

### Compute the run {#payroll-runs-compute needs="payroll edit"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs).
2. Press **Compute Run**. Everyone paid that month gets a payslip, with their pay and deductions.
3. Read **Staff in Run**, **Gross**, **Deductions** and **Net** on the run's card.
4. Press **Compute Run** again whenever something changes: a salary set, a fine accepted, a
   day waived. Adjustments and the people left out stay as they are.

### Deal with problems {#payroll-runs-problems needs="payroll edit"}

A line under the run's figures counts its problems, such as "2 blocking, 3 warnings". A blocking
problem stops **Submit for Approval** until it is fixed. A warning never stops it.

1. Press **Open** on that line. **Run Problems** lists each **Employee**, the **Problem**, the
   **Fix** and its **Severity**.
2. For **No Salary Set**, set the person's pay on
   [People · Employees](/people?tab=employees), as [Add an employee](#people-add-employee) shows.
   Or leave them out of the run.
3. For a net pay below zero, spread a deduction over more months on
   [Payroll · Deductions](/payroll?tab=deductions), or add an adjustment.
4. For no bank details, add them on the person's record. With **Bank Details Required** on, this
   is blocking.
5. For fines waiting, accept, spread or waive them on [Payroll · Deductions](/payroll?tab=deductions).
6. Press **Compute Run** again. The line goes once nothing is left.

### Leave someone out, or put them back {#payroll-runs-exclude needs="payroll edit"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs).
2. Press **Exclude**. Or press **Exclude** beside a person in **Run Problems**.
3. Pick the **Employee**, write the **Reason**, then press **Exclude Person**.
4. They are listed under **Left Out** with the reason. Press **Include** beside them to put them
   back, then **Compute Run**.

### Add an adjustment {#payroll-runs-adjust needs="payroll edit"}

An adjustment is a one-off earning or deduction for one person in this run: a bonus, or a
correction. A locked month is never changed. Its correction goes into the next run as an adjustment.

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs).
2. Press **Add Adjustment** under **Adjustments**.
   ![The Add Adjustment form](shot:payroll-add-adjustment)
3. Pick the **Employee** and the **Kind**: **Earning** or **Deduction**.
4. Write the **Label** the payslip shows, the **Amount** and the **Reason**.
5. Press **Add Adjustment**, then **Compute Run**.
6. To take one off, press the bin beside it, then **Remove Adjustment**.

### Send the run to the CEO {#payroll-runs-submit needs="payroll edit"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs) on a computed run with no blocking problem.
2. Press **Submit for Approval**. The run is computed again first.
3. If the totals changed since you last looked, you are told. Read the new figures, then press
   **Submit for Approval** again.
4. The run reads **Submitted**, and **Waiting On** names the CEO. The CEO is told.

### Approve a run {#payroll-runs-approve needs="ceo"}

1. Open the run from the notice, or from [Payroll · Payroll Runs](/payroll?tab=payroll-runs).
2. Check the figures, then press **Approve**, and **Approve Run** to confirm.
3. The run is locked and every payslip is published. Each person is told "Your payslip is ready".
4. To return it instead, press **Send Back**, write the **Reason**, then press **Send Back**. It
   goes back to Draft for Operations & People to correct.
5. Press **Reject**, write the **Reason**, then press **Reject Run** to refuse it. It also goes
   back to Draft.

### Email and download the payslips {#payroll-runs-email needs="payroll edit"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs) on an approved run.
2. Press **Email All Payslips**. Each person is emailed their own payslip at their work email.
3. Pressed again, everyone has had theirs. Press **Email Again** to send them all again, or
   **Not Now**.

### Download every payslip {#payroll-runs-download needs="payroll export"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs) on an approved run.
2. Press **Download All**. One PDF holds every payslip, a page each.

### Mark the run paid {#payroll-runs-paid needs="payroll edit"}

The CEO sends the money by bank transfer outside the hub. Then:

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs) on the approved run.
2. Press **Mark Paid**.
3. Pick the **Paid On** day, and write the bank's **Payment Reference** if you have it.
4. Press **Mark Paid**. The run reads **Paid**, and leaves Home's Payroll In Progress card.

### Discard a run {#payroll-runs-discard needs="payroll delete"}

1. Open [Payroll · Payroll Runs](/payroll?tab=payroll-runs) on a run never sent to the CEO.
2. Press **Discard**, then **Discard Run** to confirm. The month can be opened again.

```shot payroll-runs
open: /payroll?tab=payroll-runs
as: operations
sources:
  - app/src/features/payroll/parts.tsx
```

```shot payroll-add-adjustment
open: /payroll?tab=payroll-runs
as: operations
device: desktop
sources:
  - app/src/features/payroll/parts.tsx
do:
  - click: button "Add Adjustment"
crop: modal
```

## Payslips {#payroll-payslips screen=payroll/payslips icon=doc}

Payslips lists a month's payslips. Until the CEO approves the run, they are a **Preview** and staff
cannot see them. Once approved, they are **Published**.

![Payslips](shot:payroll-payslips)

### Read a payslip {#payroll-payslips-read}

1. Open [Payroll · Payslips](/payroll?tab=payslips).
2. Pick the **Month** at the top. The open run's month shows first.
3. Press a person. Their payslip opens, with its earnings, deductions and **Net Pay**.
   ![A payslip](shot:payroll-payslip)
4. A published payslip shows **Preparing** while its PDF is made, then the PDF itself.
5. **Restricted** in place of an amount means your role does not see pay.

### Download a payslip {#payroll-payslips-pdf needs="payroll edit"}

1. Open a published payslip on [Payroll · Payslips](/payroll?tab=payslips).
2. Press **Download PDF** at its foot.

### Email or download them all {#payroll-payslips-all needs="payroll edit, payroll export"}

1. Open [Payroll · Payslips](/payroll?tab=payslips) and pick an approved month.
2. Press **Email All Payslips** to email each person theirs, or **Download All** for one PDF.
   On a phone, both are under the three dots at the top.

```shot payroll-payslips
open: /payroll?tab=payslips
as: operations
sources:
  - app/src/features/payroll/parts.tsx
```

```shot payroll-payslip
open: /payroll?tab=payslips
as: operations
sources:
  - app/src/features/payroll/parts.tsx
do:
  - click: row 1
crop: modal
```

## Deductions {#payroll-deductions screen=payroll/deductions icon=sheet}

Deductions lists everything taken from pay: attendance deductions, fines from upheld queries, and
advances being recovered.

![Deductions](shot:payroll-deductions)

The figures count **Pending Fines**, **Pending Attendance**, **Active** and **Recovered This Year**.
Press one to list them. Pick a status, **Pending**, **Active**, **Settled** or **Waived**, and a
source: **All**, **Attendance**, **Fines** or **Advances**.

Attendance deductions go into the run by themselves. To waive one, press it, then
**Open Attendance**, as [Waive deductions](#people-attendance-waive) shows.

### Take a fine from pay {#payroll-deductions-fine needs="payroll edit"}

Nobody can accept, waive or release their own fine.

1. Open [Payroll · Deductions](/payroll?tab=deductions) and press a pending fine.
2. Press **Accept This Month** to take it whole from the open month's run.
3. Or press **Spread Over Months**. Pick the **Months**, from 2 to 12, and the **Start Month**,
   then press **Spread Fine**. The shares are equal.
4. Or press **Waive**, write the **Reason**, then press **Waive Fine**. Nothing is taken, and the
   person is told.
5. Press **Compute Run** on [Payroll · Payroll Runs](/payroll?tab=payroll-runs) to bring it into the run.

### Release an accepted fine {#payroll-deductions-release needs="payroll edit"}

1. Open [Payroll · Deductions](/payroll?tab=deductions) and press an active fine.
2. Press **Release**, write the **Reason**, then press **Release Fine**. It waits again.
3. Once any month of it is in a run, it can no longer be released.

### Record an advance {#payroll-deductions-advance needs="payroll create"}

An advance is pay the CEO sends a person before pay day, outside the hub. Recording it recovers it
from their next payslips.

1. Open [Payroll · Deductions](/payroll?tab=deductions).
2. Press **Record Advance** at the top right.
   ![The Record Advance form](shot:payroll-record-advance)
3. Pick the **Employee**, and fill in the **Amount** and the **Paid On** day.
4. Pick the **Months** to recover it over and the **Start Month**.
5. Write the **Reason**, then press **Record Advance**. The person is told.
6. Each month's share shows on their payslip as Salary Advance Repayment.

### Cancel an advance {#payroll-deductions-cancel needs="payroll edit"}

1. Open [Payroll · Deductions](/payroll?tab=deductions) and press the advance.
2. Press **Cancel Advance**, write the **Reason**, then press **Cancel Advance**.
3. Once any month of it is in a run, it can no longer be cancelled.

```shot payroll-deductions
open: /payroll?tab=deductions
as: operations
sources:
  - app/src/features/payroll/parts.tsx
```

```shot payroll-record-advance
open: /payroll?tab=deductions
as: operations
device: desktop
do:
  - click: button "Record Advance"
crop: modal
```

## Configurations {#payroll-configurations screen=payroll/configurations icon=cog}

Configurations holds how payroll works for everyone: the pay day, whether bank details are
required, and the statutory figures for **Advanced Payroll**.

![Configurations](shot:payroll-configurations)

### Set the pay day {#payroll-configurations-pay-day needs="cap payroll.configure"}

The pay day is one day for every month. It is the 30th until you change it. In a shorter month,
the month's last day is paid.

1. Open [Payroll · Configurations](/payroll?tab=configurations).
2. Press **Set Pay Day** beside **Pay Day**.
   ![The Set Pay Day form](shot:payroll-set-pay-day)
3. Pick the **Pay Day**, from 1 to 30, or **Last Day of Month**.
4. Pick the **Effective From** day, then press **Set Pay Day**.
5. A change still to come shows beside **Pay Day** with its day.

### Require bank details {#payroll-configurations-bank needs="cap payroll.configure"}

1. Open [Payroll · Configurations](/payroll?tab=configurations).
2. Turn **Bank Details Required** on. A person with no bank details then blocks **Submit for Approval**.
3. Turn it off to let a run go without them. It is then only a warning.

### Remove a change still to come {#payroll-configurations-remove needs="cap payroll.configure"}

A change saved for a later day can be taken off before that day. One already in force is replaced
by saving a new one from a day.

1. Open [Payroll · Configurations](/payroll?tab=configurations).
2. Press **Remove Change** on **Payroll Options**, then **Remove Change** to confirm. Today's
   setting stays.
3. For a statutory figure, open its row and press **Remove Change** at the foot of its form.

### Enter a statutory figure {#payroll-configurations-items needs="cap payroll.configure"}

MyCity takes no statutory deduction yet. Operations & People enter each figure, with the law it
comes from, before **Advanced Payroll** is switched on. Nothing updates a figure by itself.

**Statutory Items** lists **PAYE**, **Employee Pension**, **Employer Pension**, **NHF**, **ITF**,
**NSITF**, **Rent Relief** and **Minimum Wage**. Each shows its **Figure**, **Base**, **Source** and
**Status**: **In Force**, a day it starts or changes, or **Not Set**.

1. Open [Payroll · Configurations](/payroll?tab=configurations) and press an item.
   ![Entering a statutory figure](shot:payroll-statutory-item)
2. Fill in the **Rate**. Rent Relief also takes its **Cap a Year**. Minimum Wage takes its
   **Monthly Amount**.
3. Pick the **Base** where the item offers two.
4. Pick the **Effective From** day.
5. Fill in the **Source**: the law's title, its **Section**, a **Link** or the **Document**, and the
   **Checked On** day.
6. A company rule with no law behind it: tick **No Legal Source** and write the **Reason**.
7. Press **Save Rate**.

### Set the PAYE bands {#payroll-configurations-bands needs="cap payroll.configure"}

Enter the bands for the year exactly as the law publishes them. Each month takes its share.

1. Open [Payroll · Configurations](/payroll?tab=configurations).
2. Press **Set Bands** on **PAYE Bands**.
3. Fill in each band's range and rate. Press **Add Band** for another, or **Remove Band**.
4. Fill in the **Source** as for any figure, or tick **No Legal Source**.
5. Pick the **Effective From** day, then press **Save Bands**.

### Switch on Advanced Payroll {#payroll-configurations-advanced needs="cap payroll.configure"}

**Advanced Payroll** stays **Off** until Operations & People have entered every figure with its
source. From its day, runs compute PAYE, pension, NHF, ITF and NSITF. Locked runs never change.

1. Open [Payroll · Configurations](/payroll?tab=configurations).
2. Turn **Advanced Payroll** on.
3. Pick the **Effective From** day, today or later, then press **Switch On**.
4. Without a figure in force that day, it is refused. Enter the figures first.
5. Once on, **Grades** and **Pay Components** appear. Press a person under **Pay Components** for
   **Place Person**, **Set Prior Pay** and **Set Pay Components**.
6. To switch it off, turn **Advanced Payroll** off, pick the day, then press **Switch Off**.

Each person's Tax ID, Pension PIN, NHF choice and State are entered on their record, as
[Add an employee](#people-add-employee) shows. Their declared rent is on their **Tax and Pension**
tab, as [Declare someone's rent](#people-rent) shows.

```shot payroll-configurations
open: /payroll?tab=configurations
as: operations
sources:
  - app/src/features/payroll/parts.tsx
marks:
  1: button "Set Pay Day" | One day for every month
```

```shot payroll-set-pay-day
open: /payroll?tab=configurations
as: operations
device: desktop
do:
  - click: button "Set Pay Day"
crop: modal
```

```shot payroll-statutory-item
open: /payroll?tab=configurations
as: operations
device: desktop
do:
  - click: text "Employee Pension"
crop: modal
```

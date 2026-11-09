# Payroll Samples

Drafts for MyCity App Ltd to approve before M6 builds the real documents. They use a fictional person and
fictional figures; nothing here is real pay data, and this repository is public, so none ever should be
(JBS Praxis, 08/11/2026).

| Sample | Becomes | Needed by |
|---|---|---|
| [payslip-sample.html](payslip-sample.html) | `templates/documents/payslip.html`, the payslip PDF (`docs/guides/payroll.md` §6.10) | PR 4, once MyCity signs it off |

Open `payslip-sample.html` in any browser; print it to PDF to see the A4 page. It is the simple payroll's
payslip: one Monthly Pay line, no tax or pension wording (staff are contractors and consultants who handle their
own, 12 October), the lines of the guide's worked example (`docs/guides/payroll.md` §6.14). In advanced mode the
real payslip adds the statutory lines under Deductions; that variant is drawn when MyCity switches it on.

**What MyCity is asked to confirm** (TB shows Cynthia; the answers go in `docs/guides/payroll.md` §13):

1. The wording of each line (Monthly Pay, Overtime, Lateness, Absence, Unpaid Leave, Fine, Salary Advance Repayment).
2. The person's block: Name, Staff Number, Job Title, Department, Bank, Account (last four digits only), Pay Date,
   Days Paid. Anything to add or take off.
3. Whether the footer should carry the company's address, phone or email (it reads from Settings · Organisation).
4. Whether MyCity wants a signature or an approver's name on the page (the sample has none).

A chat that receives MyCity's answers updates the sample, and PR 4 builds the template from the approved version.

# Attendance

This guide explains the end-to-end attendance workflow demonstrated in demo.html. The demo date is 9 October 2026 and all times are shown in Africa/Lagos.

## 1. Roles and connected modules

Attendance connects these parts of MyCity App:

- **Dashboard / header:** shows the employee's current Clock In or Clock Out action and opens the attendance modal.
- **Employee Self-Service (ESS) → My Attendance:** shows today's expected location, shift, punches, matched location, hours, attendance status, and review cases.
- **ESS → Work Location Requests:** lets an employee request a temporary home location, remote-day exception, client-site visit, field correction, or office-day exception.
- **ESS → My Devices:** shows enrolled and pending devices used for attendance.
- **ESS → Policy Updates:** shows published attendance policies and requests an acknowledgment when HR requires one.
- **People → Attendance:** gives HR the daily register, field assignments, work-location requests, manager view, and Reconcile workflow.
- **People → Employees:** shows an essential employee list and an authorised detail modal containing the attendance setup and registered home address.
- **People → Devices:** lets HR enrol, block, or revoke devices.
- **Settings → Attendance Policy:** controls location, device, time, exception, deduction-tier, overtime-tier, publication, and acknowledgment rules.
- **Notifications and Alerts:** links a recipient to the relevant attendance record, request, device review, policy, or reconciliation case.
- **Payroll / Deductions and Queries & Sanctions:** receive only reviewed outcomes. Attendance does not automatically deduct pay or decide discipline.

## 2. Employee clock-in workflow

1. The employee signs in.
2. The app checks the employee record before showing any attendance action:
   - A **suspended employee is denied access to the whole app**, including an existing in-app session or direct navigation.
   - An employee on **approved leave covering today may use permitted app features but cannot clock in or out**.
3. If the employee is eligible and has not clocked in today, the Clock In modal opens automatically.
4. The modal identifies today's work arrangement, shift, expected location, geofence, applicable policy, device status, system time, and location-verification result.
5. A fresh location reading is evaluated for that action. The app does not reuse the previous clock-in or clock-out coordinates.
6. The employee confirms once. The action is protected from repeat clicks, and the attendance state is checked again before saving so a second clock-in cannot be created for an already open session.
7. On success, ESS and the dashboard update immediately and the employee receives a notification that opens My Attendance.

Clock Out uses the same workflow. It requires an open clock-in, takes a new location reading, shows gross time, break, net time, early departure or overtime, and prevents a duplicate or unmatched clock-out.

## 3. Location selected for the day

The system selects the expected location in this order:

1. An approved field assignment for the date.
2. An approved client-site or field-correction request.
3. The employee's work arrangement and hybrid schedule.
4. An approved work-location exception that is effective on the date.
5. The normal office or registered home location.

An approved temporary home applies only from its start date through its end date. After expiry, the system automatically returns to the registered permanent home. Both locations remain in the history.

### Remote and WFH employees

- The employee's registered home address and saved coordinates are the default location.
- The geofence is **fixed at 100 metres** for clock-in and clock-out.
- The same mandatory 100 m radius applies to an approved temporary home.
- Employees cannot request a different home radius, and HR cannot edit it.
- If the home coordinates are missing, the app does not fall back to an office and does not silently approve attendance. The employee sees an explicit failure and must contact People.

### Hybrid employees

- Office days use the assigned office fence. MTN Head Office is configured at 100 m.
- Remote days use the registered or currently approved temporary home at the fixed 100 m radius.
- Being at home on a scheduled office day is treated as a location-and-schedule mismatch unless an effective exception has been approved.

### Field employees and marketing assignments

- An approved assignment contains the employee, client or purpose, permitted site coordinates, date, time window, radius, approver, and reason.
- The assignment location overrides the normal office or home for its approved period.
- A client-site request or field-correction request can provide a temporary approved location.
- When there is no active assignment, the employee's configured base rules apply; an off-site attempt is not silently treated as compliant.

## 4. Geofence and GPS decisions

The demo calculates straight-line distance between the captured coordinates and the approved coordinates. A punch is inside the fence when the calculated distance is less than or equal to the applicable radius. Exactly 100 m is therefore inside a 100 m home fence; anything greater is outside.

The policy defines:

- **Good accuracy:** 50 m or better by default.
- **Warning accuracy:** worse than 50 m but no worse than 100 m.
- **Retry:** worse than 100 m. No geofence decision is made.

The following conditions are always explicit:

- **Permission denied:** coordinates are not captured and the attendance is rejected as unverified.
- **Location unavailable:** no compliance decision is made; the employee is asked to retry.
- **Insufficient accuracy:** the employee retries. After repeated failures, the modal can create a review case with an explanation and evidence label.
- **Missing home coordinates:** the punch is rejected as unverified; the registered home must be corrected by People.
- **Outside a mandatory fence:** the original attempt, coordinates, accuracy, distance, expected location, and device evidence are retained as non-compliant and pending HR review.

Unverified attendance is never labelled compliant.

## 5. Outside-geofence and exception workflow

1. The employee attempts to clock in or out.
2. The system stores the original evidence as a non-compliant attempt.
3. A reconciliation case is opened automatically as **Awaiting HR**.
4. The employee sees the case reference and can add a concise explanation and supporting-evidence label in the modal.
5. HR and the employee receive actionable notifications. A line manager may receive a recommendation request where applicable.
6. Until HR decides, the attempt is shown as **Pending HR review** and is not payroll-ready.
7. HR opens People → Attendance → Reconcile and compares:
   - original system time and device time;
   - captured coordinates and GPS accuracy;
   - expected and matched locations;
   - calculated distance and radius;
   - work arrangement, schedule, assignment, request, and policy version;
   - employee explanation, manager recommendation, and evidence.
8. HR approves, rejects, requests more information, attaches a valid assignment, adjusts a missing or incorrect punch, or escalates the matter.
9. The system keeps the original event and adds any HR adjustment. It records the decision, reviewer, timestamp, reason, evidence, and before/after result in the case and audit history.
10. The employee receives an actionable outcome notification.

Reconcile does not erase source evidence, make an automatic deduction, or decide disciplinary action.

## 6. Planned work-location exceptions

Before working somewhere else, the employee uses ESS → Work Location Requests:

1. Select the request type and effective dates.
2. Enter the permitted address and drop the simulated pin.
3. Provide a reason and optional evidence label.
4. Submit to the line manager, then HR.
5. HR reviews the employee, location, coordinates, dates, reason, evidence, and manager recommendation.
6. On approval, only the approved dates and location become valid.
7. At the end of the approved period, the normal registered home or office becomes applicable automatically.

Home requests always use 100 m. Client-site and field requests use the configured field radius; the employee does not choose a radius.

## 7. HR policy configuration

Changes in Settings → Attendance Policy first create a draft. HR reviews the old and new values, supplies an effective date and employee-facing summary, then publishes a new version.

On publication:

- affected employees receive an in-app policy update;
- the notification opens ESS → Policy Updates;
- the employee sees the effective date, summary, full policy, and acknowledgment action;
- acknowledgment progress appears to HR;
- older attendance records retain the policy version used when they were created and are not recalculated.

### Deduction tiers

The Deduction tiers toggle controls whether the existing attendance deduction tiers can be proposed for future reviewed outcomes. Turning it off preserves the tier configuration. Automatic deductions remain disabled, and an authorised person must accept or waive every proposed deduction.

### Overtime tiers

The Overtime tiers toggle controls whether configured overtime-tier rules apply. Turning it off still retains recorded overtime time but does not apply a tier. Turning it on still requires the configured manager approval. MyCity has not supplied monetary overtime rates, so the demo records that calculation as pending instead of inventing a value.

The two toggles are independent and persist with the published policy version.

## 8. Manager workflow

Managers see attendance only for their team in the manager view. They can:

- see who is expected, clocked in, remote, assigned, late, or missing a punch;
- review planned location requests and recommend approval or rejection;
- review attendance cases and add a recommendation or escalate to People;
- receive actionable notifications for requests and cases involving their team.

Final attendance reconciliation and policy publication remain People/HR actions in this demo.

## 9. Troubleshooting

- **The Clock In modal does not open:** confirm the employee is active, not on approved leave today, and has not already clocked in.
- **The app says the account is suspended:** People must reactivate the employee; refreshing or using a direct link does not bypass the restriction.
- **Home coordinates are missing:** People should open the employee detail, edit the home location, enter the full address, and drop the pin.
- **GPS permission is denied:** enable location permission for the browser or app, then retry.
- **GPS is unavailable:** enable device location services, move to an open area or near a window, and retry.
- **Accuracy is worse than the policy threshold:** retry until a usable reading is available; repeated failures can be sent to HR for review.
- **The employee is outside the fence:** do not change the evidence. Add exception details to the automatically created case, or submit a planned work-location request before the next off-site workday.
- **A temporary location is no longer selected:** check its end date. Expired approvals correctly revert to the permanent location.
- **A notification does not open a record:** the destination is permission-aware. The signed-in user must have access to that employee or HR module.

## 10. Demo limitations

This is a browser-only functional demo, not a production attendance service:

- State is stored in browser localStorage; it is device- and browser-specific and can be reset from Attendance Policy.
- Authentication uses demo identities and front-end checks. Production must enforce suspension, leave, permissions, session invalidation, and attendance rules on a trusted server.
- GPS scenarios, accuracy, device identity, maps, email delivery, server time, and uploads are simulated. A production build must use secure browser/mobile geolocation, trusted server timestamps, authenticated APIs, and durable evidence storage.
- Coordinates are derived from demo data and simulated pins. No real geocoding service is called.
- Notifications work inside the demo state; no push-notification or email provider is contacted.
- The demo prevents duplicate submissions in the interface and rechecks local attendance state. Production also needs database uniqueness, transactions, idempotency keys, and concurrency controls.
- Role visibility is demonstrated in attendance-specific views, but production authorization must be enforced for every API and record, not only hidden in the interface.
- Payroll and query outcomes are explanatory integrations. The demo does not post money, run payroll, or impose a sanction.

# Deal Merchant Agreement (redacted)

Source: a signed Deal Merchant Agreement with an event organiser, 5 November 2026, three pages (the third
blank), on MyCityApp letterhead with the logo at the top right. The partner's details are placeholders;
MyCity's standard wording is as written. Each placeholder's field is in the table at the end.

---

MyCityAPP                                                        Date: [Date]

Business Name: [Business Name]

Address: [Address]

Phone number: [Phone numbers]

Email: [Email]

Contact person: [Contact person]

Deal Title: [Deal title, e.g. Exclusive Event Attendance Activation]

Deals Description:

Option 1

Event Title is: [Event title]
[What attendees do, e.g. all the attendees of the event are expected to download MyCityApp Ng as part
of event registration and a ticket access to the event]

Option 2

[e.g. Expected event attendees are [number]+]

Option 3

[About the event: who it brings together, where, what it is expected to attract, its highlights]

Financials:

| Original Price | Option 1 | Option 2 | Option 3 | Option 4 | Option 5 |
|---|---|---|---|---|---|
| Discount (%) | [ ] | [ ] | [ ] | [ ] | [ ] |
| Deal Price | [ ] | [ ] | [ ] | [ ] | [ ] |
| MyCityAPP's Commission (Per sale) | [ ] | [ ] | [ ] | [ ] | [ ] |
| Merchant's take (Per sales) | [ ] | [ ] | [ ] | [ ] | [ ] |

(In the sample every option read Discount "Free Event", Deal Price "App Download", and NA for the
commission and the merchant's take: a free event whose price is an app download. This is why a deal
option carries a `price_note` beside its money fields, `docs/guides/partnerships.md` §6.6.)

Deal Validity: 30 Days [ ]
               60 Days [ ]
Others:        [n] Day(s) [ ]   ([Date the deal ends])

---

In detail, explain what is included in the deal for Fine Print & Highlights:

1. Platform and technical partnership: Event registration on MyCityApp NG platform, with our team
   supporting the setup so attendees move smoothly from sign up to check-in.

2. Amplification: Our marketing team will push the event across our channels, as we have an established
   pool of 10,000+ network and community.

3. Branded presence and souvenirs: MyCityApp NG branded souvenir items distributed to attendees.

4. Documentation: Our on-ground team will join the media team to cover the event highlights from
   attendee interviews to special presentations.

5. Ember to Remember Calendar listing: With this partnership, the event will be featured on the
   MyCityApp NG Ember to Remember national content calendar, which has been recognized and approved by the
   Federal Government of Nigeria, with support from MTN Nigeria. This gives the event the visibility it
   deserves beyond [State], across Nigeria and Africa, attracting investors, relevant stakeholders,
   sponsors and a larger audience attendance for the event now and for future editions.

How long is the service:

[e.g. For the period of the event, which is built up to event date, during event day and supported
highlights after the event.]

If the deal is the bundle, please explain the breakdown of the original price:
[Breakdown, or None Applicable]

How should customers make bookings?

[e.g. Through MyCityApp download link for the event]

Opening hours for MyCityApp customers: [e.g. 24hrs]

Will Merchant send pictures?    Yes    No

Acceptance of Agreement

The Company shall remit payment for coupons to the Merchant based on redeemed coupons as per agreed days
interval till deal expiration.

The above prices, specifications and conditions are hereby accepted. The Company is authorized to
execute the project as outlined in this Agreement.

Business Name: [Business Name]

Name of Representative: [Name of representative]

Title of Representative: [Title of representative]

Date Signed: [Date signed]

Signature: [Signature]

---

## The placeholders and their fields

How PR 2 rebuilds this as the Events category's template (`docs/guides/partnerships.md` §6.8). "Ask" is
a value the person gives when generating; "Signing" is filled by the signing service (§6.9).

| Placeholder | Field |
|---|---|
| Date | `today` (the generation date), day-first |
| Business Name | `partner.name` (or the lead's name) |
| Address | `partner.headquarters`, else the region's first city |
| Phone numbers, Email, Contact person | `contact.phones`, `contact.email`, `contact.full_name` (the signatory contact) |
| Deal title | `deal.title` |
| Event title | `deal.event_title` |
| Options 1 to 3 (the description) | Ask: three optional paragraphs, prefilled from `deal.objective`, `deal.expected_attendance` and `deal.comments` |
| Financials | `deal.options` as the table: Original Price, Discount %, Deal Price (or its price note), MyCity's Commission per sale, the Merchant's Take per sale, one column per option |
| Deal Validity | `deal.validity_label` and `deal.valid_until` (30 days, 60 days, or Others with the date) |
| Fine Print and Highlights | The category's delivery checklist (§6.7), each item as a numbered clause; [State] is the deal's region |
| How long is the service | Ask, with the sample's sentence as its default |
| Bundle breakdown | Ask, default None Applicable |
| How customers make bookings | Ask, default the sample's sentence |
| Opening hours | Ask, default 24hrs |
| Will Merchant send pictures | Ask (Yes or No) |
| Acceptance clause | Template wording, as written |
| Name, Title, Date Signed, Signature of representative | Signing: the signer's name, title, signing time and drawn or typed signature, stamped into this block |

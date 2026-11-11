# Training Samples

Drafts for MyCity App Ltd to approve before M10 builds the real documents. They use a fictional person,
signer and number; nothing here is a real record, and this repository is public, so none ever should be.

| Sample | Becomes | Needed by |
|---|---|---|
| [certificate-sample.html](certificate-sample.html) | `templates/documents/training-certificate.html`, the certificate of completion PDF (`docs/guides/knowledge.md` §6.9) | PR 4, once MyCity signs it off |

Open `certificate-sample.html` in any browser; print it to PDF (A4, landscape, background graphics on) to
see the page. It is one page: MyCity's wordmark (the real one prints the logo from Settings ·
Organisation), Certificate of Completion, the person's full name, the course, its items and length, the
completion date, the publisher's signature (drawn or typed once when the course was published, K7), the
seal, the certificate number, the issue date and the QR code that opens the certificate on Verify a
Document. The sample's QR is drawn, not scannable, and its two typefaces load from Google Fonts; the real
template embeds them, so the PDF never reaches out.

**What MyCity is asked to confirm** (TB shows Cynthia; the answers go in `docs/guides/knowledge.md` §13):

1. The wording: "Certificate of Completion", "This is to certify that", "has successfully completed the
   training", "Published this training".
2. The line under the wordmark ("Learning & Development"), or another, or none.
3. Whether the seal's ring reads "MyCity App Ltd · Certified Training".
4. Whether one signature (the publisher's) is enough, or the CEO's should be printed beside it.

A chat that receives MyCity's answers updates the sample, and PR 4 builds the template from the approved
version.

import type { GalleryEntry } from "../testing/gallery";
import { EmailFrame } from "./EmailFrame";

/** A notice laid out for a 600 px desktop client, the way hosting panels and newsletters send them. */
const WIDE = `
<table width="600" border="1" cellpadding="12" cellspacing="0">
  <tr><th colspan="2" align="left">Secure SSL/TLS Settings (Recommended)</th></tr>
  <tr><td width="200">Username:</td><td>jbspraxis@mycityapp.io</td></tr>
  <tr><td>Incoming Server:</td><td>mycityapp.io<br>IMAP Port: 993 &nbsp; POP3 Port: 995</td></tr>
  <tr><td>Outgoing Server:</td><td>mycityapp.io<br>SMTP Port: 465</td></tr>
</table>`;

/** A notice that paints its own white page, blue header and grey labels, as a hosting panel sends it. */
const PAINTED = `
<table width="600" cellpadding="12" cellspacing="0" style="background:white;border:1px solid rgb(200, 210, 225)">
  <tr><td colspan="2" style="background:rgb(86, 137, 199);color:white;font-weight:bold">Secure SSL/TLS Settings (Recommended)</td></tr>
  <tr><td width="200" style="color:rgb(150, 160, 170)">Username:</td><td style="color:rgb(60, 60, 60)">jbspraxis@mycityapp.io</td></tr>
  <tr><td style="color:rgb(150, 160, 170)">Outgoing Server:</td><td style="color:rgb(60, 60, 60)">mycityapp.io<br>SMTP Port: 465</td></tr>
</table>`;

const REPLY = `<p>Thanks, the venue is confirmed for Monday.</p><p>Best regards,<br>Bola</p>
<blockquote><p>On 17/10/2026, Amaka wrote:</p><p>Can you confirm the venue?</p></blockquote>`;

export default {
  component: "EmailFrame",
  states: {
    "Plain Reply": () => <EmailFrame title="Re: Venue confirmations" html={REPLY} />,
    "Wider Than The Column": () => (
      <div className="max-w-80">
        <EmailFrame title="Client configuration settings" html={WIDE} />
      </div>
    ),
    "Painted White Page": () => (
      <div className="max-w-80">
        <EmailFrame title="Client configuration settings" html={PAINTED} />
      </div>
    ),
  },
} satisfies GalleryEntry;

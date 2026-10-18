import { describe, expect, it } from "vitest";
import { prepareEmail, referencedCids, splitQuoted } from "./email-body";

describe("prepareEmail: remote content", () => {
  it("holds back every way a body can fetch from the web, quoted or not, and counts each", () => {
    const html = [
      "<img src=https://track.example/p.gif>",
      '<img srcset="cid:a 1x, https://track.example/b.png 2x">',
      '<video poster="https://track.example/v.jpg"></video>',
      '<table background="https://track.example/bg.png"><tr><td>x</td></tr></table>',
      '<div style="background-image: url(\'https://track.example/c.png\'); color: red">y</div>',
    ].join("");
    const out = prepareEmail(html, { showRemote: false });
    expect(out.blocked).toBe(5);
    expect(out.html).not.toContain("track.example");
    expect(out.html).toContain("color: red");
    expect(out.html).toContain("<td>x</td>");
  });

  it("keeps what is already local, and holds nothing once images are allowed", () => {
    const local = '<img src="cid:logo1"><img src="data:image/png;base64,AA">';
    expect(prepareEmail(local, { showRemote: false }).blocked).toBe(0);
    const remote = '<img src="https://partner.example/logo.png">';
    expect(prepareEmail(remote, { showRemote: true })).toEqual({ html: remote, blocked: 0 });
  });

  it("strips scripts, handlers and script links whatever the server let through", () => {
    const out = prepareEmail('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://a.example">a</a>', { showRemote: true });
    expect(out.html).not.toMatch(/script|onclick|javascript/);
    expect(out.html).toContain('target="_blank"');
  });
});

describe("prepareEmail: inline parts", () => {
  it("draws each cid: from its part, matching the id whatever its case or brackets", () => {
    const html = '<img src="cid:Logo1@Partner.test"><img src="cid:missing">';
    expect(referencedCids(html)).toEqual(["logo1@partner.test", "missing"]);
    const out = prepareEmail(html, { showRemote: false, inline: { "logo1@partner.test": "blob:local/1" } });
    expect(out.html).toContain('src="blob:local/1"');
    expect(out.html).toContain('src="cid:missing"');
  });
});

describe("splitQuoted", () => {
  it("folds from the first blockquote after the reply", () => {
    const s = splitQuoted("<p>Confirmed for Monday.</p><blockquote><p>Can you confirm?</p><blockquote><p>Older</p></blockquote></blockquote>");
    expect(s.visible).toBe("<p>Confirmed for Monday.</p>");
    expect(s.quoted).toContain("Can you confirm?");
    expect(s.quoted).toContain("Older");
  });

  it("folds the attribution line above a blockquote with it", () => {
    const s = splitQuoted("<p>Yes, Monday.</p><p>On 14/10/2026, Amaka wrote:</p><blockquote><p>Monday?</p></blockquote>");
    expect(s.visible).toBe("<p>Yes, Monday.</p>");
    expect(s.quoted).toContain("Amaka wrote:");
  });

  it("does not fold a forward that is nothing but the quotation", () => {
    const html = "<div><blockquote><p>The original</p></blockquote></div>";
    expect(splitQuoted(html)).toEqual({ visible: html, quoted: null });
  });

  it("folds a plain-text reply at its attribution line, inside the paragraph, in English and French", () => {
    const en = splitQuoted("<p>Thanks.</p><p>On Mon, 13 Oct 2026, Amaka wrote:<br>&gt; Can you confirm?</p>");
    expect(en.visible).toContain("Thanks.");
    expect(en.visible).not.toContain("wrote");
    expect(en.quoted).toContain("Can you confirm?");
    const fr = splitQuoted("<p>Merci.<br>Le lun. 13 oct. 2026, Amaka a écrit :<br>&gt; Pouvez-vous confirmer ?</p>");
    expect(fr.visible).toContain("Merci.");
    expect(fr.quoted).toContain("a écrit");
  });

  it("folds a trailing run of quoted lines, but not a reply written between quoted lines", () => {
    expect(splitQuoted("<p>Yes.<br>&gt; Is it Monday?<br>&gt; At 10?</p>").quoted).toContain("Is it Monday?");
    const between = "<p>&gt; Is it Monday?<br>Yes.<br>&gt; At 10?<br>No, 11.</p>";
    expect(splitQuoted(between).quoted).toBeNull();
  });

  it("leaves a message with no history whole", () => {
    expect(splitQuoted("<p>On Tuesday we wrote: the plan.</p>")).toEqual({ visible: "<p>On Tuesday we wrote: the plan.</p>", quoted: null });
  });
});

"use strict";
/**
 * A signature drawn in a signature box, as a person draws one (docs/runbooks/training-videos.md
 * §6.15): joined loops that shrink as they go, then an underline. A sine wave reads as a scribble.
 * On desktop the pointer glides to the box first; on a phone the finger simply draws.
 *
 * @param {object} s    the hands a line's `do` receives (film.js)
 * @param {import("playwright").Locator} pad  the signature box (its canvas)
 */
async function sign(s, pad) {
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  const W = box.width * 0.62;
  const H = box.height * 0.3;
  const x0 = box.x + box.width * 0.16;
  const y0 = box.y + box.height * 0.42;
  const at = (t) => {
    const k = t * 8 * Math.PI;
    const r = 1 - 0.45 * t;
    return { x: x0 + W * (t + (r * Math.sin(k)) / 9), y: y0 + H * 0.7 * r * Math.cos(k) * (0.6 + 0.4 * (1 - t)) };
  };
  if (!s.phone) await s.hover(pad);
  const a = at(0);
  await s.page.mouse.move(a.x, a.y, { steps: 6 });
  await s.page.mouse.down();
  for (let i = 1; i <= 110; i++) {
    const p = at(i / 110);
    await s.page.mouse.move(p.x, p.y, { steps: 2 });
  }
  await s.page.mouse.up();
  // The underline.
  await s.page.mouse.move(x0 - W * 0.04, y0 + H * 1.15, { steps: 5 });
  await s.page.mouse.down();
  await s.page.mouse.move(x0 + W * 0.95, y0 + H * 1.0, { steps: 18 });
  await s.page.mouse.up();
  await s.wait(0.3);
}

module.exports = { sign };

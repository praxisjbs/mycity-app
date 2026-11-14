"use strict";
/**
 * Keeps a copy of each email the hub sends while a video is filmed (docs/runbooks/training-videos.md
 * §4.5). Filming has no mail server, so the hub captures its mail and nothing leaves the machine;
 * the queue job is the copy a scene reads (`mail.message`), except for an invitation or a password
 * reset, whose job is dropped the moment it is sent because its link is a secret. This keeps each
 * captured message as JSON in VIDEO_MAIL_CAUGHT, so a scene can open the invitation Aaron really
 * received (`mail.caught`). Preloaded into the worker on a filming machine only:
 *
 *   VIDEO_MAIL_CAUGHT=/tmp/video/caught node -r ./scripts/video/mail-catcher.js src/worker.js
 *
 * Only the capturing transport is wrapped; a mailbox's own SMTP is untouched. Refused anywhere but
 * development.
 */
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.VIDEO_MAIL_CAUGHT;
if (dir && process.env.APP_ENV === "development") {
  const nodemailer = require("nodemailer");
  const create = nodemailer.createTransport;
  nodemailer.createTransport = function createTransport(options, ...rest) {
    const transport = create.call(this, options, ...rest);
    if (!options || !options.jsonTransport) return transport;
    const send = transport.sendMail.bind(transport);
    transport.sendMail = async (mail, ...more) => {
      const info = await send(mail, ...more);
      fs.mkdirSync(dir, { recursive: true });
      const message = typeof info.message === "string" ? JSON.parse(info.message) : info.message;
      fs.writeFileSync(path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(message));
      return info;
    };
    return transport;
  };
}

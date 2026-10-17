"use strict";
/**
 * create-admin's terminal: the password prompts stay on screen and nothing typed is echoed.
 *
 * The prompts used to be erased by readline's redraw (first column, clear below) once the echo was
 * muted, so on a phone's narrow terminal the password and repeat prompts vanished and the script
 * looked frozen. These tests drive the terminal with a fake TTY and read back what it wrote.
 */
const { PassThrough } = require("node:stream");
const { makeTerminal } = require("../../../scripts/db/create-admin");

/** A fake TTY: what the person types goes into `input`, what the script writes is in `screen()`. */
function fakeTty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = jest.fn();
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 38; // a phone
  let written = "";
  output.on("data", (d) => {
    written += d.toString();
  });
  return { input, output, screen: () => written };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("create-admin terminal", () => {
  test("a password prompt stays on screen and the password is not echoed", async () => {
    const tty = fakeTty();
    const term = makeTerminal(tty);
    const answer = term.askHidden("Password (at least 8 characters)");
    await tick();
    tty.input.write("Secr3t!pw\r");
    await expect(answer).resolves.toBe("Secr3t!pw");
    expect(tty.screen()).toBe("Password (at least 8 characters): \n");
    expect(tty.input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(tty.input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  test("the whole flow shows every prompt: email, password, repeat", async () => {
    const tty = fakeTty();
    const term = makeTerminal(tty);
    const email = term.ask("Work email");
    await tick();
    tty.input.write("a@b.co\r");
    await expect(email).resolves.toBe("a@b.co");

    const first = term.askHidden("Password");
    await tick();
    tty.input.write("Secr3t!pw\r");
    await expect(first).resolves.toBe("Secr3t!pw");

    const repeat = term.askHidden("Repeat password");
    await tick();
    tty.input.write("Secr3t!pw\r");
    await expect(repeat).resolves.toBe("Secr3t!pw");

    const screen = tty.screen();
    expect(screen).toContain("Work email: ");
    expect(screen).toMatch(/Password: \nRepeat password: \n$/);
    expect(screen).not.toContain("Secr3t!pw");
  });

  test("Backspace removes a character; a paste with its newline is read whole", async () => {
    const tty = fakeTty();
    const term = makeTerminal(tty);
    const answer = term.askHidden("Password");
    await tick();
    tty.input.write("Secr3t!pwX");
    tty.input.write("\u007f");
    tty.input.write("\r\n");
    await expect(answer).resolves.toBe("Secr3t!pw");
  });

  test("escape sequences (arrows, bracketed paste) never become part of the password", async () => {
    const tty = fakeTty();
    const term = makeTerminal(tty);
    const answer = term.askHidden("Password");
    await tick();
    tty.input.write("\x1b[200~Secr3t!pw\x1b[201~\x1b[D\r");
    await expect(answer).resolves.toBe("Secr3t!pw");
  });

  test("Ctrl+C cancels and leaves the terminal as it was", async () => {
    const tty = fakeTty();
    const term = makeTerminal(tty);
    const answer = term.askHidden("Password");
    await tick();
    tty.input.write("abc\u0003");
    await expect(answer).rejects.toThrow("Cancelled. Nothing was written.");
    expect(tty.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(tty.input.listenerCount("data")).toBe(0);
  });
});

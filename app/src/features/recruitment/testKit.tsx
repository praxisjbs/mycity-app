/**
 * What the Recruitment tests share: the app's providers around the screen, signing in on the mock,
 * waiting for every request a press starts, and the copy rules the screen gates hold a screen to.
 * Each test file mocks `@/api/mock/core` (vi.mock is per file) so `settled` can wait on dispatch.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import { ModalProvider } from "@mycity/ui";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Recruitment from "./index";

/** Waits for every request the screen started, and those their answers start. */
export async function settled() {
  const sent = () => vi.mocked(dispatch).mock.results;
  await act(() => new Promise((r) => setTimeout(r, 300)));
  for (let answered = -1; answered < sent().length; ) {
    answered = sent().length;
    await act(async () => {
      await Promise.allSettled(sent().map((r) => r.value));
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "recruitment" ? <Recruitment tab={location.tab ?? "vacancies"} id={location.id} /> : null;
}
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Screen /> : null;
}
const app = (show: boolean) => (
  <RouterProvider>
    <AuthProvider>
      <ModalProvider>
        <ScreenActionProvider>
          <Harness show={show} />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock and opens the address. */
export async function openAs(email: string, address: string) {
  window.history.replaceState(null, "", address);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
  await settled();
}

/** The copy rules the screen gates hold a screen to, read from what is rendered. */
export function copyProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = [];
  const read = (selector: string, limit: number, chrome: boolean) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      const word = chrome ? copy.titleCaseViolation(t) : null;
      if (word) problems.push(`${selector} not Title Case at "${word}": "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="title"]', copy.LIMITS.title, true);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("label", copy.LIMITS.fieldLabel, false);
  return problems;
}

/** The dialog on top. */
export const dialog = () => screen.getAllByRole("dialog").at(-1)!;

/** Presses the button named `name` inside `root`, and waits for what it starts. */
export async function press(root: HTMLElement, name: string | RegExp) {
  fireEvent.click(within(root).getAllByRole("button", { name })[0]!);
  await settled();
}

/**
 * Opens `root`'s More Actions: a pointer menu on a computer, an action sheet on a phone (a tap opens
 * it, its rows are plain buttons). Gives back its items by name, and the element each is.
 */
async function openMore(root: HTMLElement): Promise<Array<{ name: string; el: HTMLElement }>> {
  const trigger = within(root).getAllByRole("button", { name: "More Actions" })[0]!;
  if (window.matchMedia("(max-width: 760px)").matches) {
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: /Actions$/ });
    return within(sheet.querySelector("ul")!).getAllByRole("button").map((el) => ({ name: el.textContent ?? "", el }));
  }
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  return (await screen.findAllByRole("menuitem")).map((el) => ({ name: el.textContent ?? "", el }));
}

/** Opens `root`'s More Actions and chooses `name` from it (a record's actions behind its main button). */
export async function choose(root: HTMLElement, name: string) {
  const item = (await openMore(root)).find((x) => x.name === name);
  if (!item) throw new Error(`More Actions has no ${name}`);
  fireEvent.click(item.el);
  await settled();
}

/** What `root`'s More Actions holds, by name; the menu is closed again after. */
export async function moreActions(root: HTMLElement): Promise<string[]> {
  const names = (await openMore(root)).map((x) => x.name);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await settled();
  return names;
}

/** Types into the field labelled `label` inside `root`. */
export const type = (root: HTMLElement, label: string | RegExp, value: string) => fireEvent.change(within(root).getByLabelText(label), { target: { value } });

/** Opens the row or card reading `text`, and waits for its sheet. */
export async function openRow(text: string | RegExp) {
  fireEvent.click((await screen.findAllByText(text, undefined, { timeout: 8000 }))[0]!);
  await settled();
  return dialog();
}

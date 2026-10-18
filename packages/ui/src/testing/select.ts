/**
 * Tests that drive a SelectMenu (SelectField, FilterSelect, InlineSelect) as a
 * person does: open the list, press an option by its words. jsdom has no
 * pointer capture or scrolling, which the desktop listbox calls, so the first
 * use fills them in. The trigger carries the chosen value as `value` and each
 * option its own as `data-value`, so a test reads them where it read a native
 * select's.
 */
import { fireEvent, screen, within } from "@testing-library/react";

function installSelectEnv(): void {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

/** The open list: the desktop listbox, or the phone sheet's. */
async function openList(trigger: HTMLElement): Promise<HTMLElement> {
  installSelectEnv();
  fireEvent.click(trigger);
  return screen.findByRole("listbox");
}

/** Opens the select and presses the option with these words. */
export async function chooseOption(trigger: HTMLElement, label: string | RegExp): Promise<void> {
  const list = await openList(trigger);
  fireEvent.click(within(list).getByRole("option", { name: label }));
}

/** Opens the select and presses the option holding this value (where a native select took `change`). */
export async function chooseValue(trigger: HTMLElement, value: string): Promise<void> {
  const list = await openList(trigger);
  const option = within(list)
    .getAllByRole("option")
    .find((o) => o.getAttribute("data-value") === value);
  if (!option) throw new Error(`No option with the value "${value}"`);
  fireEvent.click(option);
}

async function readOptions(trigger: HTMLElement, read: (o: HTMLElement) => string): Promise<string[]> {
  const list = await openList(trigger);
  const out = within(list).getAllByRole("option").map(read);
  fireEvent.keyDown(list, { key: "Escape" });
  return out;
}

/** The words of every option, top to bottom; the list closes again. */
export const optionLabels = (trigger: HTMLElement) => readOptions(trigger, (o) => (o.textContent ?? "").trim());

/** The value of every option, top to bottom; the list closes again. */
export const optionValues = (trigger: HTMLElement) => readOptions(trigger, (o) => o.getAttribute("data-value") ?? "");

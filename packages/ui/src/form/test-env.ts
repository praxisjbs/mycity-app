/**
 * What jsdom lacks for the rich text editor's tests. ProseMirror reads the
 * layout to place a caret and decide what a key does: `getClientRects`,
 * `getBoundingClientRect` on a Range, and `elementFromPoint`. jsdom has no
 * layout at all, so these answer with empty boxes, which is enough for the
 * editor to mount, take content and run its commands.
 *
 * Tests call it in beforeAll. What needs real layout (dragging a selection,
 * a click landing between two characters) is exercised by the screen gates
 * and the gallery in Chromium instead.
 */
const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;

export function installEditorTestEnv(): void {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => EMPTY_RECT;
  Element.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  document.elementFromPoint ??= () => null;
}

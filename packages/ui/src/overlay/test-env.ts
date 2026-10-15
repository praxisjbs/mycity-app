/**
 * What jsdom lacks for the overlay tests: pointer capture and scrollIntoView
 * (Radix menus, the sheet's drag), and a computed `transform` (the sheet reads
 * it when a press ends). Tests call it in beforeAll; testing/setup.ts can take
 * it over for every test.
 */
export function installOverlayTestEnv(): void {
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => undefined;
  // jsdom answers "" for a computed transform and its webkit name; the sheet then reads the moz name.
  if (!("mozTransform" in CSSStyleDeclaration.prototype)) {
    Object.defineProperty(CSSStyleDeclaration.prototype, "mozTransform", {
      configurable: true,
      get(this: CSSStyleDeclaration) {
        return this.transform || "none";
      },
    });
  }
}

/**
 * Every public site test file (vite.config.ts `test.setupFiles`). The pages run on the in-browser
 * mock, which answers each request after 90 to 250 ms as a network would, and a CV's simulated
 * upload takes about a second, so Testing Library waits up to 4 seconds for what a page shows.
 * jsdom lacks what Radix and the media hooks need (matchMedia, ResizeObserver, pointer capture);
 * they are stood in for here, as the staff app's and @mycity/ui's own setup do.
 */
import { afterEach, beforeEach, expect } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";

configure({ asyncUtilTimeout: 4000 });
expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
window.scrollTo = () => undefined;

beforeEach(() => setViewport(1440));
afterEach(() => cleanup());

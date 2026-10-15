import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { axeMatchers } from "./axe";
import { installMatchMedia, setViewport } from "./viewport";

expect.extend(axeMatchers);

/* jsdom lacks these; Radix and the media hooks need them. */
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  try {
    localStorage.clear();
  } catch {
    /* storage can be blocked */
  }
});

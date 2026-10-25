/**
 * Every app test file (vite.config.ts `test.setupFiles`): Testing Library waits up to 4 seconds
 * for what a screen shows after a request. The in-browser mock answers each request after 90 to
 * 250 ms, as a network would, and a save that reloads its list makes two or three, so under the
 * whole suite's load the default second ran out (Alerts' "Rule switched on", 25/10/2026). It only
 * sets how long a lookup may wait before it fails; a passing test is not slower.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 4000 });

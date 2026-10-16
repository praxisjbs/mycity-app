"use strict";
/**
 * "Chrome on Windows": what a person reads for a session or a device, from the
 * browser's User-Agent. A label, never a security decision: a User-Agent is
 * whatever the browser chooses to say.
 */

const BROWSERS = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * @param {string|null|undefined} userAgent
 * @returns {string}  "Chrome on Windows", "Safari on iPhone", "Unknown device"
 */
function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  const browser = (BROWSERS.find(([re]) => re.test(ua)) || [])[1];
  const system = (SYSTEMS.find(([re]) => re.test(ua)) || [])[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || "Unknown device";
}

/** The platform alone ("Windows", "iPhone"), or null. */
function platformOf(userAgent) {
  const ua = String(userAgent || "");
  return (SYSTEMS.find(([re]) => re.test(ua)) || [])[1] || null;
}

module.exports = { deviceLabel, platformOf };

/*
 * Before first paint, in the staff app: the staging marks, and the theme, density, text size and
 * Settings · Appearance this device kept (lib/environment.ts, lib/preferences.ts and
 * lib/appearance.ts in @mycity/ui keep these keys). A file, not inline, because the security
 * policy runs scripts from the app's own origin only (script-src 'self').
 */
(function () {
  var html = document.documentElement;
  if (/(^|\.)staging\./.test(location.hostname)) {
    html.setAttribute("data-env", "staging");
    var icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = "/favicon-staging.svg";
  }
  try {
    var theme = localStorage.getItem("mc-theme");
    var density = localStorage.getItem("mc-density");
    var size = localStorage.getItem("mc-text-size");
    var defaults = JSON.parse(localStorage.getItem("mc-appearance-defaults") || "null") || {};
    if (!theme && (defaults.theme === "light" || defaults.theme === "dark")) theme = defaults.theme;
    if (!density && defaults.density === "comfortable") density = "comfortable";
    if (theme) html.setAttribute("data-theme", theme);
    if (density) html.setAttribute("data-density", density);
    if (size) html.setAttribute("data-text-size", size);
    var css = localStorage.getItem("mc-appearance-css");
    if (css) {
      var style = document.createElement("style");
      style.id = "mc-appearance";
      style.textContent = css;
      document.head.appendChild(style);
    }
  } catch (e) {
    /* storage can be blocked: the shipped look, until the app applies the saved one */
  }
})();

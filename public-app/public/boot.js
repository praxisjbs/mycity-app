/*
 * Before first paint, on the public site: the staging marks, and the theme the visitor chose with
 * the header's toggle (lib/environment.ts and lib/preferences.ts in @mycity/ui keep these; the key
 * is mc-public-theme). A file, not inline, because the security policy runs scripts from the site's
 * own origin only (script-src 'self'); an inline script never ran, so every reload fell back to
 * the device's theme.
 */
(function () {
  var html = document.documentElement;
  if (/(^|\.)staging\./.test(location.hostname)) {
    html.setAttribute("data-env", "staging");
    var icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = "/favicon-staging.svg";
  }
  try {
    var theme = localStorage.getItem("mc-public-theme");
    if (theme === "light" || theme === "dark") html.setAttribute("data-theme", theme);
  } catch (e) {
    /* storage can be blocked: the device's theme, until the visitor chooses one */
  }
})();

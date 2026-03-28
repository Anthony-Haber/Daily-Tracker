/**
 * theme-loader.js — shared theme applicator for all renderer windows.
 *
 * Include via:  <script src="../../theme-loader.js"></script>
 * Then call:    applyTheme(themeName)
 *
 * Usage in each renderer:
 *   window.tracker.theme.getActive().then(name => {
 *     applyTheme(name);
 *     window.tracker.theme.onChange(applyTheme);
 *   });
 */
(function () {
  'use strict';

  // Capture script src synchronously (document.currentScript is only valid
  // during synchronous execution of the script tag).
  const _scriptSrc = (document.currentScript || {}).src || '';
  // Strip the filename to get the directory (e.g. "file:///…/src/")
  const _scriptDir = _scriptSrc ? _scriptSrc.replace(/\/[^/]+$/, '/') : '';

  /**
   * Apply a theme by name.  Fetches src/themes/<name>/theme.css and injects
   * (or replaces) the <link id="theme-stylesheet"> element in <head>.
   * Falls back to the default theme if the requested one does not exist.
   *
   * @param {string} themeName
   */
  async function applyTheme(themeName) {
    // Ensure there is a <link> element to update.
    let linkEl = document.getElementById('theme-stylesheet');
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.id = 'theme-stylesheet';
      linkEl.rel = 'stylesheet';
      // Insert before all other stylesheets so window styles can override.
      const firstLink = document.head.querySelector('link[rel="stylesheet"]');
      if (firstLink) {
        document.head.insertBefore(linkEl, firstLink);
      } else {
        document.head.appendChild(linkEl);
      }
    }

    const base = _scriptDir || '../../';
    const url  = `${base}themes/${themeName}/theme.css`;
    const fallback = `${base}themes/default/theme.css`;

    let href = url;
    try {
      const res = await fetch(url);
      if (!res.ok) href = fallback;
    } catch (_) {
      href = fallback;
    }

    if (linkEl.getAttribute('href') !== href) {
      linkEl.href = href;
    }

  }

  // Expose globally so renderer scripts can call applyTheme(name).
  window.applyTheme = applyTheme;
})();

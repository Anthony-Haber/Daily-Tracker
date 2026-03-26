'use strict';

/**
 * settings.js
 *
 * Central store for all user-configurable preferences.
 * Uses the same electron-store file as db.js (daily-tracker-config.json)
 * so every module reads/writes the same backing JSON.
 *
 * Also owns the cross-platform auto-launch logic:
 *  • Windows / macOS — app.setLoginItemSettings()
 *  • Linux          — writes / removes a .desktop file in ~/.config/autostart/
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { app } = require('electron');
const Store   = require('electron-store');

const store = new Store({ name: 'daily-tracker-config' });

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  remindersEnabled:  true,
  reminderStartHour: 8,
  reminderEndHour:   21,
  checkinInterval:   60,
};

// ── Settings access ───────────────────────────────────────────────────────────

/**
 * Returns a snapshot of all user settings.
 * launchOnStartup is read from the OS, not the store, so it always
 * reflects the true system state.
 */
function getSettings() {
  return {
    remindersEnabled:  store.get('remindersEnabled',  DEFAULTS.remindersEnabled),
    reminderStartHour: store.get('reminderStartHour', DEFAULTS.reminderStartHour),
    reminderEndHour:   store.get('reminderEndHour',   DEFAULTS.reminderEndHour),
    checkinInterval:   store.get('checkinInterval',   DEFAULTS.checkinInterval),
    launchOnStartup:   getAutoLaunch(),
    dbFolder:          store.get('dbFolder', null),
  };
}

/**
 * Persist a single setting by key.
 * @param {string} key
 * @param {*}      value
 */
function setSetting(key, value) {
  store.set(key, value);
}

// ── Auto-launch ───────────────────────────────────────────────────────────────

/** Full path to the Linux autostart .desktop file. */
function linuxAutostartPath() {
  const cfg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(cfg, 'autostart', 'daily-tracker.desktop');
}

/** Content of the .desktop file used for Linux autostart. */
function desktopContent() {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Daily Tracker',
    `Exec=${process.execPath} --no-sandbox`,
    'Hidden=false',
    'NoDisplay=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/**
 * Enable or disable launch-on-login.
 *
 * Windows / macOS: delegates to Electron's app.setLoginItemSettings().
 * Linux:           writes or removes ~/.config/autostart/daily-tracker.desktop.
 *
 * @param {boolean} enabled
 */
function setAutoLaunch(enabled) {
  if (process.platform === 'linux') {
    const dest = linuxAutostartPath();
    if (enabled) {
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, desktopContent(), 'utf8');
    } else {
      try { fs.unlinkSync(dest); } catch (_) { /* already absent */ }
    }
  } else {
    // Works on both Windows (registry) and macOS (LaunchAgent plist)
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

/**
 * Returns true if the app is currently configured to launch on login.
 * Reads the actual OS state rather than a cached setting.
 */
function getAutoLaunch() {
  if (process.platform === 'linux') {
    return fs.existsSync(linuxAutostartPath());
  }
  return app.getLoginItemSettings().openAtLogin;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { getSettings, setSetting, setAutoLaunch, getAutoLaunch };

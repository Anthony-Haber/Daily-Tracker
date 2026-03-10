'use strict';

/**
 * scheduler.js
 *
 * Aligns to the next full clock hour, then fires every 60 minutes.
 *
 * Each tick:
 *  • Checks user settings: remindersEnabled, reminderStartHour, reminderEndHour
 *  • Shows an OS notification "Time to log your activity!" within the active window
 *  • Opens the hourly prompt window
 *  • Between 20:00 – 21:00 additionally triggers the evening reflection (once per day)
 *
 * Cross-platform notifications:
 *  • Windows 10/11  — Action Center toast  (requires AppUserModelId in main.js)
 *  • macOS          — Notification Center
 *  • Linux          — libnotify / D-Bus via Electron; falls back to notify-send
 *                     if Electron's Notification is not supported (some distros
 *                     require the libnotify-bin package to be installed)
 *
 * Exported controls: start, stop, pause, resume, isPaused
 */

const { Notification } = require('electron');
const { execFile }     = require('child_process');
const settings         = require('./settings');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Evening reflection fires at this hour regardless of the active-hour window. */
const REFLECTION_HOUR = 20;
const APP_NAME        = 'Daily Tracker';

// ── State ─────────────────────────────────────────────────────────────────────

let hourTimer           = null;   // setTimeout → setInterval handle
let paused              = false;  // session-level quick-pause (not persisted)
let reflectionFiredDate = null;   // YYYY-MM-DD of last reflection trigger
let _callbacks          = { onPrompt: null, onReflection: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Milliseconds until the start of the next clock hour. */
function msUntilNextHour() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return next - now;
}

/** YYYY-MM-DD for today in local time. */
function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Fire an OS notification.
 *
 * Primary:  Electron's built-in Notification API.
 * Fallback: notify-send CLI (Linux only) when Electron's API is unsupported.
 *           Requires libnotify-bin: `sudo apt install libnotify-bin`
 *
 * onClick is only supported via the primary path; notify-send has no callback.
 *
 * @param {string}       title
 * @param {string}       body
 * @param {()=>void}     [onClick]
 */
function notify(title, body, onClick) {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: false });
    if (onClick) n.on('click', onClick);
    n.show();
    return;
  }

  // Linux fallback — args passed as array to avoid shell-injection risk.
  if (process.platform === 'linux') {
    execFile('notify-send', [title, body], (err) => {
      if (err) {
        console.warn(
          '[scheduler] notify-send failed (install libnotify-bin to enable notifications):',
          err.message,
        );
      }
    });
  }
}

// ── Core tick ─────────────────────────────────────────────────────────────────

function tick() {
  // Session-level quick-pause (tray toggle).
  if (paused) return;

  // Persistent preference from settings.
  const s = settings.getSettings();
  if (!s.remindersEnabled) return;

  const hour  = new Date().getHours();
  const today = todayStr();

  // ── Hourly activity prompt (within user-configured active window) ──────────
  if (hour >= s.reminderStartHour && hour <= s.reminderEndHour) {
    notify(
      APP_NAME,
      'Time to log your activity!',
      () => _callbacks.onPrompt(),
    );
    _callbacks.onPrompt();
  }

  // ── Evening reflection (once per day at REFLECTION_HOUR) ──────────────────
  if (hour === REFLECTION_HOUR && reflectionFiredDate !== today) {
    reflectionFiredDate = today;

    // Small delay so the activity window settles first.
    setTimeout(() => {
      notify(
        APP_NAME,
        'Time for your evening reflection — how was your day?',
        () => _callbacks.onReflection(),
      );
      _callbacks.onReflection();
    }, 2500);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the scheduler.  Aligns to the next clock-hour boundary before the
 * first tick so prompts always appear at :00 of each hour.
 *
 * @param {{ onPrompt: ()=>void, onReflection: ()=>void }} callbacks
 */
function start({ onPrompt, onReflection }) {
  _callbacks = { onPrompt, onReflection };

  const delay = msUntilNextHour();

  // Fire once at the next hour boundary, then repeat every 60 minutes.
  hourTimer = setTimeout(() => {
    tick();
    hourTimer = setInterval(tick, 60 * 60 * 1000);
  }, delay);
}

/** Temporarily pause notifications without stopping the underlying timer. */
function pause() {
  paused = true;
}

/** Resume notifications after a session-level pause. */
function resume() {
  paused = false;
}

/** Returns true when the scheduler is session-paused. */
function isPaused() {
  return paused;
}

/** Stop all timers — call on app quit. */
function stop() {
  if (hourTimer !== null) {
    clearTimeout(hourTimer);
    clearInterval(hourTimer);
    hourTimer = null;
  }
}

module.exports = { start, stop, pause, resume, isPaused };

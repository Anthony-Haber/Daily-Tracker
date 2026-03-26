/* global tracker */
'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

/** Format an hour integer (0-23) as "8:00 AM" / "9:00 PM". */
function fmtHour(h) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

/** Populate both hour <select> elements with 0-23 options. */
function buildHourOptions() {
  const startSel = $('sel-start-hour');
  const endSel   = $('sel-end-hour');

  for (let h = 0; h < 24; h++) {
    const label = fmtHour(h);
    startSel.appendChild(new Option(label, h));
    endSel.appendChild(new Option(label, h));
  }
}

/** Briefly show the "Saved" badge. */
let _statusTimer = null;
function showStatus(msg = 'Saved') {
  const el = $('status-msg');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 2000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  buildHourOptions();

  // ── Load current values ──────────────────────────────────────────────────
  const [s, dbPath] = await Promise.all([
    tracker.getSettings(),
    tracker.getDbPath(),
  ]);

  $('db-path').textContent            = dbPath || 'Not configured';
  $('toggle-reminders').checked       = s.remindersEnabled;
  $('sel-start-hour').value           = s.reminderStartHour;
  $('sel-end-hour').value             = s.reminderEndHour;
  $('sel-checkin-interval').value     = s.checkinInterval || 60;
  $('toggle-startup').checked         = s.launchOnStartup;

  // ── Close / Done ─────────────────────────────────────────────────────────
  $('btn-close').addEventListener('click', () => tracker.closeWindow());
  $('btn-done').addEventListener('click',  () => tracker.closeWindow());

  // ── Database folder ───────────────────────────────────────────────────────
  $('btn-change-db').addEventListener('click', async () => {
    const newFolder = await tracker.changeDbFolder();
    if (newFolder) {
      // Show the expected new DB path (actual reconnect happens on restart).
      $('db-path').textContent = newFolder + (
        newFolder.endsWith('/') || newFolder.endsWith('\\') ? '' : '/'
      ) + 'daily-tracker.db';
      showStatus('Folder updated — restart to apply');
    }
  });

  // ── Reminders toggle ─────────────────────────────────────────────────────
  $('toggle-reminders').addEventListener('change', async (e) => {
    await tracker.setSetting('remindersEnabled', e.target.checked);
    showStatus();
  });

  // ── Active hours ─────────────────────────────────────────────────────────
  $('sel-start-hour').addEventListener('change', async (e) => {
    await tracker.setSetting('reminderStartHour', parseInt(e.target.value, 10));
    showStatus();
  });

  $('sel-end-hour').addEventListener('change', async (e) => {
    await tracker.setSetting('reminderEndHour', parseInt(e.target.value, 10));
    showStatus();
  });

  // ── Check-in interval ────────────────────────────────────────────────────
  $('sel-checkin-interval').addEventListener('change', async (e) => {
    await tracker.setSetting('checkinInterval', parseInt(e.target.value, 10));
    showStatus();
  });

  // ── Launch on startup ─────────────────────────────────────────────────────
  $('toggle-startup').addEventListener('change', async (e) => {
    await tracker.setAutoLaunch(e.target.checked);
    showStatus();
  });
}

init();

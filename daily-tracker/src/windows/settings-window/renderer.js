/* global tracker, applyTheme, triggerShipLog, playSound */
'use strict';

// ── Theme ──────────────────────────────────────────────────────────────────────
window.tracker.theme.getActive().then(name => {
  applyTheme(name);
  window.tracker.theme.onChange(applyTheme);
});

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

/** Mark the correct theme card as active and show/hide the custom editor and dark mode row. */
function setActiveThemeCard(themeName) {
  document.querySelectorAll('.theme-card[data-theme]').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === themeName);
  });
  const editor = $('custom-theme-editor');
  if (editor) editor.classList.toggle('hidden', themeName !== 'user-custom');
}

/** Update the custom theme swatch preview. */
function updateCustomSwatch() {
  const bg     = $('custom-bg')?.value     || '#f0f2f5';
  const accent = $('custom-accent')?.value || '#4f63d2';
  const swBg     = $('swatch-custom-bg');
  const swAccent = $('swatch-custom-accent');
  if (swBg)     swBg.style.background     = bg;
  if (swAccent) swAccent.style.background = accent;
}

/** Load default-preset tracks for reassignment to user-custom. */
async function loadCustomMusicTracks() {
  const container = $('custom-music-tracks');
  if (!container) return;

  const [focusTracks, breakTracks] = await Promise.all([
    tracker.music.getTracks('default', 'focus'),
    tracker.music.getTracks('default', 'break'),
  ]);
  const allTracks = [...(focusTracks || []), ...(breakTracks || [])];

  if (allTracks.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="section-heading" style="margin-top:4px">Default Preset Tracks</div>';
  allTracks.forEach(t => {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `
      <span class="setting-desc">${t.displayName} <small>(${t.pool || 'focus'})</small></span>
      <button class="btn btn-ghost btn-sm">→ Custom</button>
    `;
    row.querySelector('button').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled    = true;
      btn.textContent = 'Moving…';
      try {
        await tracker.music.saveTrack('user-custom', t.pool || 'focus', t.filePath, t.displayName);
        await tracker.music.deleteTrack('default', t.pool || 'focus', t.filename);
        btn.textContent = 'Moved ✓';
        setTimeout(() => loadCustomMusicTracks(), 600);
      } catch {
        btn.disabled    = false;
        btn.textContent = '→ Custom';
      }
    });
    container.appendChild(row);
  });
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
  $('btn-close').addEventListener('click', async () => { try { await playSoundAndWait('close'); } catch (_) {} tracker.closeWindow(); });
  $('btn-done').addEventListener('click',  async () => { try { await playSoundAndWait('close'); } catch (_) {} tracker.closeWindow(); });

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

  // ── Theme selector ────────────────────────────────────────────────────────
  const activeTheme = await tracker.theme.getActive();
  setActiveThemeCard(activeTheme);
  if (activeTheme === 'user-custom') loadCustomMusicTracks();

  document.querySelectorAll('.theme-card[data-theme]').forEach(card => {
    card.addEventListener('click', async () => {
      const themeName = card.dataset.theme;
      const displayName = themeName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Disable all cards so the user can't trigger another switch mid-transition
      document.querySelectorAll('.theme-card[data-theme]').forEach(c => {
        c.style.pointerEvents = 'none';
      });

      showStatus(`Switching to ${displayName}… restarting app 🔄`);

      setTimeout(async () => {
        const result = await tracker.theme.restartWithTheme(themeName);
        if (result?.devHotSwap) {
          // Dev mode: app stayed open — update UI and show appropriate message
          applyTheme(themeName);
          setActiveThemeCard(themeName);
          document.querySelectorAll('.theme-card[data-theme]').forEach(c => {
            c.style.pointerEvents = '';
          });
          showStatus('Theme applied! (Restart skipped in dev mode)');
        }
        // In production app.exit(0) was called — nothing runs after this point
      }, 800);
    });
  });

  // ── UI Sounds toggle ──────────────────────────────────────────────────────
  const uiSoundsEnabled = await tracker.sound.getUiEnabled(activeTheme);
  $('toggle-ui-sounds').checked = uiSoundsEnabled;

  $('toggle-ui-sounds').addEventListener('change', async (e) => {
    await tracker.sound.setUiEnabled(activeTheme, e.target.checked);
    showStatus();
  });


  // ── Custom theme editor ───────────────────────────────────────────────────
  $('custom-bg')?.addEventListener('input',      updateCustomSwatch);
  $('custom-accent')?.addEventListener('input',  updateCustomSwatch);

  $('btn-save-custom-theme')?.addEventListener('click', async () => {
    const font = $('custom-font')?.value || "'Segoe UI', system-ui, sans-serif";
    const variables = {
      '--theme-bg-primary':          $('custom-bg')?.value      || '#f0f2f5',
      '--theme-bg-secondary':        $('custom-surface')?.value || '#ffffff',
      '--theme-bg-tertiary':         $('custom-bg')?.value      || '#f0f2f5',
      '--theme-accent-primary':      $('custom-accent')?.value  || '#4f63d2',
      '--theme-accent-secondary':    $('custom-accent')?.value  || '#3d4fb8',
      '--theme-text-primary':        $('custom-text')?.value    || '#111827',
      '--theme-text-secondary':      '#6b7280',
      '--theme-text-on-accent':      '#ffffff',
      '--theme-border-color':        '#dde1e7',
      '--theme-timer-color':         $('custom-accent')?.value  || '#4f63d2',
      '--theme-button-primary-bg':   $('custom-accent')?.value  || '#4f63d2',
      '--theme-button-primary-text': '#ffffff',
      '--theme-font-display':        font,
      '--theme-font-body':           font,
      '--theme-shadow':              '0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)',
      '--theme-radius':              '8px',
    };

    await tracker.theme.saveCustom(variables);
    await tracker.theme.setActive('user-custom');
    applyTheme('user-custom');
    setActiveThemeCard('user-custom');
    showStatus('Custom theme saved');
  });
}

init();

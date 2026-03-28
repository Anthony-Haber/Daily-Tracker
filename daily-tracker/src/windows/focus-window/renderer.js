/* global tracker, applyTheme, triggerShipLog, playThemeSound, playSound */
'use strict';

console.log('[renderer-init] tracker.sound:', typeof window.tracker?.sound?.play);
console.log('[renderer-init] tracker.music:', typeof window.tracker?.music?.getPreBreakTrack);

if (window.tracker?.sound?.play) {
  console.log('[sound-renderer] sound API available');
} else {
  console.warn('[sound-renderer] sound API NOT available - check preload.js');
}

// ── Theme ──────────────────────────────────────────────────────────────────────
window.tracker.theme.getActive().then(name => {
  applyTheme(name);
  window.tracker.theme.onChange(async (newTheme) => {
    applyTheme(newTheme);
    await reloadMusicForTheme(newTheme);
  });
});

// ── Constants ──────────────────────────────────────────────────────────────────

const MODES = {
  pomodoro:      { label: 'Pomodoro',    minutes: 25, dbMode: 'pomodoro'    },
  'short-break': { label: 'Short Break', minutes: 5,  dbMode: 'short_break' },
  'long-break':  { label: 'Long Break',  minutes: 15, dbMode: 'long_break'  },
};

const DB_MODE_TO_UI = {
  pomodoro:    'pomodoro',
  short_break: 'short-break',
  long_break:  'long-break',
};

const LS_KEY = 'focus_session_tasks';

// ── State ──────────────────────────────────────────────────────────────────────

let currentMode      = 'pomodoro';
let totalSeconds     = MODES.pomodoro.minutes * 60;
let remainingSeconds = totalSeconds;
let timerId          = null;
let isRunning        = false;
let cycleCount       = 1;   // 1–4; increments only on natural Pomodoro completion

/** Sessions loaded from / saved to the DB. Each entry is a DB row. */
let sessions = [];

/** All tasks loaded from the DB. */
let allTasks = [];

/**
 * Session-local ordering of task IDs added to the focus window.
 * The first entry is the "active" focused task shown near the timer.
 * Persisted to localStorage (key: focus_session_tasks).
 */
let inProgressOrder = [];

/** ID of the card currently being dragged. */
let dragSrcId = null;

/**
 * Session-local pomodoro count per task: { [taskId]: { completed, original } }
 * original = pomodoro_estimate at the moment of first decrement.
 */
let taskPomodoros = {};

// ── DOM refs ───────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elDisplay         = $('timer-display');
const elCount           = $('session-count');
const elPlural          = $('session-plural');
const elLog             = $('session-log');
const elEmpty           = $('log-empty');
const elTaskLabel       = $('task-active-label');
const elInprogressList  = $('inprogress-list');
const elInprogressEmpty = $('inprogress-empty');
const elPendingDropdown = $('pending-dropdown');
const elPendingList     = $('pending-list');
const elPendingEmpty    = $('pending-empty');
const btnStart          = $('btn-start');
const btnSkip           = $('btn-skip');
const btnAddTask        = $('btn-add-task');
const tabs              = document.querySelectorAll('.tab');

// ── Cycle-dots display (created dynamically so index.html stays unchanged) ─────

const elCycleDots = document.createElement('div');
elCycleDots.id = 'cycle-dots';

const _cycleStyle = document.createElement('style');
_cycleStyle.textContent = `
  #cycle-dots {
    text-align: center;
    font-size: 13px;
    letter-spacing: 5px;
    color: var(--text-light, #aaa);
    margin-top: 2px;
  }
  #cycle-dots .dot-filled { color: var(--accent, #4f63d2); }
`;
document.head.appendChild(_cycleStyle);

// Insert after .session-counter, before #task-active-label
elCount.closest('.session-counter').insertAdjacentElement('afterend', elCycleDots);

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function fmtTimestamp(isoStr) {
  const d = new Date(isoStr);
  let h = d.getHours();
  const m    = d.getMinutes();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function pomodoroCount() {
  return sessions.filter(s => s.mode === 'pomodoro' && s.completed).length;
}

function pomodoroLabel(task) {
  const entry = taskPomodoros[task.id];
  if (!entry) return `🍅 0/${task.pomodoro_estimate || 1}`;
  return `🍅 ${entry.completed}/${entry.original}`;
}

function estimatedFinishTime(task) {
  const entry    = taskPomodoros[task.id];
  const original = entry ? entry.original : (task.pomodoro_estimate || 1);
  const completed = entry ? entry.completed : 0;
  const remaining = Math.max(0, original - completed);
  if (remaining === 0) return null;
  const ms   = remaining * 25 * 60 * 1000;
  const then = new Date(Date.now() + ms);
  let h = then.getHours();
  const m    = then.getMinutes();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `Est. finish ~${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadFocusSessionFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed.date !== todayStr()) {
      localStorage.removeItem(LS_KEY);
      return [];
    }
    return Array.isArray(parsed.taskIds) ? parsed.taskIds : [];
  } catch {
    return [];
  }
}

function saveFocusSessionToStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      date: todayStr(),
      taskIds: inProgressOrder,
    }));
  } catch {
    // Storage unavailable — silently skip
  }
}


// ── Render ─────────────────────────────────────────────────────────────────────

function renderDisplay() {
  elDisplay.textContent = formatTime(remainingSeconds);
}

function renderCounter() {
  const count = pomodoroCount();
  elCount.textContent  = count;
  elPlural.textContent = count === 1 ? '' : 's';
}

function renderLog() {
  [...elLog.querySelectorAll('.log-item')].forEach(el => el.remove());

  if (sessions.length === 0) {
    elEmpty.style.display = '';
    return;
  }
  elEmpty.style.display = 'none';

  [...sessions].reverse().forEach(row => {
    const uiMode   = DB_MODE_TO_UI[row.mode] || 'pomodoro';
    const modeInfo = MODES[uiMode];

    const li    = document.createElement('li');
    li.className = 'log-item';

    const dot = document.createElement('span');
    dot.className = `log-item-dot ${uiMode}`;

    const time = document.createElement('span');
    time.className   = 'log-item-time';
    time.textContent = fmtTimestamp(row.created_at);

    const label = document.createElement('span');
    label.className   = 'log-item-label';
    label.textContent = row.task_label || modeInfo.label;

    const type = document.createElement('span');
    type.className   = 'log-item-type';
    type.textContent = modeInfo.label;

    li.append(dot, time, label, type);
    elLog.appendChild(li);
  });
}

function renderCycleDots() {
  // cycleCount is the *next* pomo number (1 = none done yet, 4 = 3 done)
  const completed = cycleCount - 1;
  elCycleDots.textContent = [1, 2, 3, 4].map(i => i <= completed ? '●' : '○').join(' ');
}

function renderModeUI() {
  document.body.className = `mode-${currentMode}`;
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === currentMode));
  btnSkip.textContent = currentMode === 'pomodoro' ? 'Skip' : 'Skip Break';
}

// ── Active task label (timer chip) ─────────────────────────────────────────────

/**
 * Always reflects the topmost task in the focus window list.
 */
function updateActiveTaskLabel() {
  const topId   = inProgressOrder[0];
  const topTask = topId != null ? allTasks.find(t => t.id === topId) : null;

  elTaskLabel.hidden = !topTask;
  if (topTask) {
    elTaskLabel.textContent = topTask.title;
    elTaskLabel.classList.remove('task-done');
  }
}

// ── In-progress task list ──────────────────────────────────────────────────────

function renderInProgressList() {
  [...elInprogressList.querySelectorAll('.task-card')].forEach(el => el.remove());

  const tasks = inProgressOrder
    .map(id => allTasks.find(t => t.id === id))
    .filter(Boolean);

  if (tasks.length === 0) {
    elInprogressEmpty.hidden = false;
    updateActiveTaskLabel();
    return;
  }

  elInprogressEmpty.hidden = true;

  tasks.forEach(task => {
    const li      = document.createElement('li');
    li.className  = 'task-card';
    li.dataset.id = task.id;
    li.draggable  = true;

    const handle       = document.createElement('span');
    handle.className   = 'task-card-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-hidden', 'true');

    const name       = document.createElement('span');
    name.className   = 'task-card-title';
    name.textContent = task.title;

    const pomo       = document.createElement('span');
    const entry      = taskPomodoros[task.id];
    const isDone     = entry && entry.completed >= entry.original;
    pomo.className   = 'task-card-pomo' + (isDone ? ' pomo-done' : '');
    pomo.textContent = pomodoroLabel(task);

    const done       = document.createElement('button');
    done.className   = 'btn btn-success btn-sm task-card-done';
    done.textContent = '✓ Done';
    done.dataset.id  = task.id;
    done.draggable   = false;

    li.append(handle, name, pomo, done);

    const finishStr = estimatedFinishTime(task);
    if (finishStr && task.id === inProgressOrder[0]) {
      const finish       = document.createElement('div');
      finish.className   = 'task-card-finish';
      finish.textContent = finishStr;
      li.appendChild(finish);
    }

    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover',  onDragOver);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop',      onDrop);
    li.addEventListener('dragend',   onDragEnd);

    elInprogressList.appendChild(li);
  });

  updateActiveTaskLabel();
}

// ── Drag-and-drop handlers ─────────────────────────────────────────────────────

function clearDropIndicators() {
  [...elInprogressList.querySelectorAll('.task-card')].forEach(el =>
    el.classList.remove('drop-above', 'drop-below')
  );
}

function onDragStart(e) {
  if (e.target.closest('.task-card-done')) {
    e.preventDefault();
    return;
  }
  dragSrcId = parseInt(e.currentTarget.dataset.id, 10);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragSrcId));
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const card = e.currentTarget;
  const id   = parseInt(card.dataset.id, 10);
  if (id === dragSrcId) return;

  const rect   = card.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;

  clearDropIndicators();
  card.classList.add(before ? 'drop-above' : 'drop-below');
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drop-above', 'drop-below');
  }
}

function onDrop(e) {
  e.preventDefault();

  const card     = e.currentTarget;
  const targetId = parseInt(card.dataset.id, 10);
  if (targetId === dragSrcId) return;

  const rect   = card.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;

  const fromIdx = inProgressOrder.indexOf(dragSrcId);
  if (fromIdx === -1) return;
  inProgressOrder.splice(fromIdx, 1);

  const toIdx = inProgressOrder.indexOf(targetId);
  if (toIdx === -1) {
    inProgressOrder.push(dragSrcId);
  } else {
    inProgressOrder.splice(before ? toIdx : toIdx + 1, 0, dragSrcId);
  }

  saveFocusSessionToStorage();
  renderInProgressList();
}

function onDragEnd() {
  [...elInprogressList.querySelectorAll('.task-card')].forEach(el =>
    el.classList.remove('dragging', 'drop-above', 'drop-below')
  );
  dragSrcId = null;
}

// ── Pending task dropdown ──────────────────────────────────────────────────────

function renderPendingDropdown() {
  elPendingList.innerHTML = '';

  // Show pending OR in_progress tasks not already in the focus list
  const available = allTasks.filter(t =>
    (t.status === 'pending' || t.status === 'in_progress') &&
    !inProgressOrder.includes(t.id)
  );

  if (available.length === 0) {
    elPendingEmpty.hidden = false;
    return;
  }
  elPendingEmpty.hidden = true;

  available.forEach(task => {
    const li       = document.createElement('li');
    li.className   = 'pending-item';
    li.dataset.id  = task.id;
    li.textContent = task.title;
    elPendingList.appendChild(li);
  });
}

function openPendingDropdown() {
  renderPendingDropdown();
  elPendingDropdown.hidden = false;
  btnAddTask.classList.add('active');
}

function closePendingDropdown() {
  elPendingDropdown.hidden = true;
  btnAddTask.classList.remove('active');
}

// ── Task helpers ───────────────────────────────────────────────────────────────

async function loadTasksFromDB() {
  try {
    allTasks = await tracker.tasks.getAll() || [];
  } catch {
    allTasks = [];
  }

  // Restore session-local list from localStorage (not from DB status)
  inProgressOrder = loadFocusSessionFromStorage();
  // Drop stale IDs that no longer exist in the DB
  inProgressOrder = inProgressOrder.filter(id => allTasks.some(t => t.id === id));

  renderInProgressList();
}

// ── Pomodoro estimate tracking ────────────────────────────────────────────────

async function decrementTopTaskEstimate() {
  const topId   = inProgressOrder[0];
  const topTask = topId != null ? allTasks.find(t => t.id === topId) : null;
  if (!topTask) return;

  // Init tracking entry if first pomodoro for this task
  if (!taskPomodoros[topId]) {
    taskPomodoros[topId] = { completed: 0, original: topTask.pomodoro_estimate || 1 };
  }
  taskPomodoros[topId].completed += 1;

  // Decrement estimate in DB (floor at 0)
  const newEstimate = Math.max(0, topTask.pomodoro_estimate - 1);
  topTask.pomodoro_estimate = newEstimate;
  try {
    await tracker.updateTask(topId, { pomodoro_estimate: newEstimate });
  } catch (err) {
    console.error('[focus] updateTask estimate failed:', err);
  }

  renderInProgressList();
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function loadSessionsFromDB() {
  try {
    sessions = await tracker.focus.getSessions(todayStr()) || [];
  } catch {
    sessions = [];
  }
  renderCounter();
  renderLog();
}

async function persistSession() {
  const mode = MODES[currentMode];
  const topId   = inProgressOrder[0];
  const topTask = topId != null ? allTasks.find(t => t.id === topId) : null;
  const label   = topTask?.title ?? null;

  try {
    await tracker.focus.saveSession({
      date:             todayStr(),
      task_label:       label,
      mode:             mode.dbMode,
      duration_minutes: mode.minutes,
      completed:        1,
    });
  } catch (err) {
    console.error('[focus] saveSession failed:', err);
  }
  await loadSessionsFromDB();
}

// ── Pre-break music ────────────────────────────────────────────────────────────

/** Dedicated Audio element for the pre-break track (not looped). */
const preBreakAudio = new Audio();
let preBreakPlaying = false;

/**
 * Fades out current break music over ~2 s, then plays the pre-break track.
 * Safe to call even when no break music is playing.
 */
async function playPreBreakMusic() {
  console.log('[pre-break] playPreBreakMusic called');
  console.log('[pre-break] starting pre-break music at 2:00 remaining');

  let filePath;
  try {
    filePath = await window.tracker.music.getPreBreakTrack(musicActiveTheme);
    console.log('[pre-break] received path:', filePath);
  } catch (err) {
    console.error('[pre-break] getPreBreakTrack failed:', err);
    return;
  }
  if (!filePath) {
    console.warn('[pre-break] no file returned from IPC');
    return;
  }

  // Fade out break music over 2 s
  const FADE_MS   = 2000;
  const STEPS     = 40;
  const startVol  = musicAudio.paused ? 0 : musicAudio.volume;
  const stepDelay = FADE_MS / STEPS;

  if (!musicAudio.paused && startVol > 0) {
    let step = 0;
    const fadeId = setInterval(() => {
      step++;
      musicAudio.volume = Math.max(0, startVol * (1 - step / STEPS));
      if (step >= STEPS) {
        clearInterval(fadeId);
        musicStop();
        musicAudio.volume = parseFloat(musicVolume.value); // restore for later
      }
    }, stepDelay);
  }

  // Play the pre-break track (starts immediately; fade runs in parallel)
  const normalized = filePath.replace(/\\/g, '/');
  const url        = encodeURI('file:///' + normalized).replace(/#/g, '%23');
  console.log('[pre-break] playing url:', url);

  preBreakAudio.src    = url;
  preBreakAudio.loop   = false;
  preBreakAudio.volume = parseFloat(musicVolume.value);
  preBreakAudio.addEventListener('error', () => {
    console.error('[audio] failed to load:', url, preBreakAudio.error?.code, preBreakAudio.error?.message);
  }, { once: true });
  preBreakAudio.play().then(() => {
    console.log('[audio] playing successfully');
    preBreakPlaying = true;
  }).catch(e => {
    console.error('[audio] play() failed:', e.message);
  });
}

/** Stop and reset the pre-break audio (called when break ends or mode changes). */
function stopPreBreakMusic() {
  preBreakAudio.pause();
  preBreakAudio.src = '';
  preBreakPlaying   = false;
}

// ── Timer control ──────────────────────────────────────────────────────────────

function tick() {
  if (remainingSeconds <= 0) {
    completeSession();
    return;
  }
  remainingSeconds -= 1;
  renderDisplay();

  // Trigger pre-break music 2 minutes before pomodoro ends
  if (currentMode === 'pomodoro' && !preBreakPlaying) {
    if (remainingSeconds === 120 || (remainingSeconds < 120 && remainingSeconds === totalSeconds - 1)) {
      playPreBreakMusic();
    }
  }
}

async function startTimer() {
  if (isRunning) return;
  isRunning = true;
  btnStart.textContent = 'Pause';
  timerId = setInterval(tick, 1000);
  musicPlayForCurrentMode();
}

function pauseTimer() {
  if (!isRunning) return;
  isRunning = false;
  btnStart.textContent = 'Resume';
  clearInterval(timerId);
  timerId = null;
  musicStop();
}

async function skipTimer() {
  clearInterval(timerId);
  timerId   = null;
  isRunning = false;

  musicClear();

  let nextMode;
  if (currentMode === 'pomodoro') {
    if (cycleCount < 4) {
      nextMode = 'short-break';
      cycleCount++;
    } else {
      nextMode = 'long-break';
      cycleCount = 1;
    }
    renderCycleDots();
  } else {
    nextMode = 'pomodoro';
  }

  currentMode      = nextMode;
  totalSeconds     = MODES[nextMode].minutes * 60;
  remainingSeconds = totalSeconds;
  btnStart.textContent = 'Start';
  renderModeUI();
  renderDisplay();

  await startTimer();
}

async function completeSession() {
  clearInterval(timerId);
  timerId   = null;
  isRunning = false;
  btnStart.textContent = 'Start';
  remainingSeconds = 0;
  renderDisplay();

  const completedMode = currentMode;

  if (completedMode === 'pomodoro') {
    // ── Pomodoro completed ─────────────────────────────────────────────────────
    await decrementTopTaskEstimate();
    musicClear();
    triggerShipLog();
    try { console.log('[sound-renderer] trigger fired: pomo-complete'); playSound('pomo-complete'); } catch (_) {}
    await persistSession();

    // Advance cycle counter and pick break type
    let nextMode;
    if (cycleCount < 4) {
      nextMode = 'short-break';
      cycleCount++;
    } else {
      nextMode = 'long-break';
      cycleCount = 1;
    }
    renderCycleDots();

    // Brief pause to show 00:00 before auto-starting the break
    setTimeout(async () => {
      switchMode(nextMode);
      await startTimer();
    }, 1500);

  } else {
    // ── Break completed ────────────────────────────────────────────────────────
    try { console.log('[sound-renderer] trigger fired: checkin'); playSound('checkin'); } catch (_) {}
    await persistSession();

    // Return to Pomodoro and auto-start
    setTimeout(async () => {
      switchMode('pomodoro');
      await startTimer();
    }, 1500);
  }
}

// ── Mode switching ─────────────────────────────────────────────────────────────

function switchMode(mode) {
  if (isRunning) pauseTimer();
  stopPreBreakMusic();
  currentMode          = mode;
  totalSeconds         = MODES[mode].minutes * 60;
  remainingSeconds     = totalSeconds;
  btnStart.textContent = 'Start';
  renderModeUI();
  renderDisplay();
  musicClear();
}

// ── Event listeners ────────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  if (isRunning) pauseTimer();
  else startTimer();
});

btnSkip.addEventListener('click', () => skipTimer());

tabs.forEach(tab => {
  tab.addEventListener('click', () => switchMode(tab.dataset.mode));
});

$('btn-close')?.addEventListener('click', async () => { try { await playSoundAndWait('close'); } catch (_) {} tracker.closeWindow(); });

// In-progress list "✓ Done" — event delegation
elInprogressList.addEventListener('click', async e => {
  const btn = e.target.closest('.task-card-done');
  if (!btn) return;

  const id = parseInt(btn.dataset.id, 10);
  try {
    await tracker.tasks.updateStatus(id, 'done');
    tracker.notifyTasksChanged();
    const t = allTasks.find(t => t.id === id);
    if (t) t.status = 'done';
    const idx = inProgressOrder.indexOf(id);
    if (idx !== -1) inProgressOrder.splice(idx, 1);
    saveFocusSessionToStorage();
    renderInProgressList();
  } catch (err) {
    console.error('[focus] markDone failed:', err);
  }
});

// "+ Add Task" toggle
btnAddTask.addEventListener('click', e => {
  e.stopPropagation();
  if (elPendingDropdown.hidden) openPendingDropdown();
  else closePendingDropdown();
});

// Pending item selection — event delegation
elPendingList.addEventListener('click', async e => {
  const item = e.target.closest('.pending-item');
  if (!item) return;

  const id = parseInt(item.dataset.id, 10);
  closePendingDropdown();

  const task = allTasks.find(t => t.id === id);
  if (!task) return;

  try {
    if (task.status === 'pending') {
      await tracker.tasks.updateStatus(id, 'in_progress');
      tracker.notifyTasksChanged();
      task.status = 'in_progress';
    }
    if (!inProgressOrder.includes(id)) inProgressOrder.push(id);
    saveFocusSessionToStorage();
    renderInProgressList();
  } catch (err) {
    console.error('[focus] addTask failed:', err);
  }
});

// Close dropdown on outside click
document.addEventListener('click', () => {
  if (!elPendingDropdown.hidden) closePendingDropdown();
});

// ── Init ───────────────────────────────────────────────────────────────────────

renderModeUI();
renderDisplay();
renderCycleDots();
loadSessionsFromDB();
loadTasksFromDB();

// ── Music player ───────────────────────────────────────────────────────────────

const musicAudio        = $('music-audio');
const musicPlayPause    = $('music-play-pause');
const musicSkip         = $('music-skip');
const musicVolume       = $('music-volume');
const musicPlaylist     = $('music-playlist');
const musicBody         = $('music-body');
const musicToggleBtn    = $('music-toggle');
const musicToggleArrow  = $('music-toggle-arrow');
const musicNowPlaying   = $('music-now-playing');
const musicTrackName    = $('music-track-name');
const musicUploadBtn    = $('music-upload');
const musicFileInput    = $('music-file-input');

let musicTracks            = [];        // { filename, displayName, filePath, pool }
let musicCurrentIdx        = -1;        // index into musicTracks of current track (-1 = none)
let musicIsPlaying         = false;
let musicActivePool        = null;      // 'focus' | 'break' | null
let musicLastFocusFilename = null;      // last played focus track (for repeat avoidance)
let musicLastBreakFilename = null;      // last played break track
let musicUploadPool        = 'focus';   // pool assigned to next upload batch
let musicActiveTheme       = 'default'; // theme whose music is loaded

// ── Music helpers ──────────────────────────────────────────────────────────────

function musicPoolTracks(pool) {
  return musicTracks.filter(t => (t.pool || 'focus') === pool);
}

function musicPickRandom(pool) {
  const tracks = musicPoolTracks(pool);
  if (tracks.length === 0) return null;
  if (tracks.length === 1) return tracks[0];
  const lastName = pool === 'focus' ? musicLastFocusFilename : musicLastBreakFilename;
  const candidates = tracks.filter(t => t.filename !== lastName);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function musicUpdateControls() {
  const hasTracks = musicTracks.length > 0;
  musicPlayPause.disabled = !hasTracks;
  musicSkip.disabled      = !hasTracks;
  musicPlayPause.textContent = musicIsPlaying ? '⏸ Pause' : '▶ Play';
}

function musicRenderPlaylist() {
  musicPlaylist.innerHTML = '';
  musicTracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'music-track-item' + (i === musicCurrentIdx && musicIsPlaying ? ' playing' : '');

    const pool = t.pool || 'focus';
    const badge       = document.createElement('span');
    badge.className   = `music-pool-badge music-pool-badge--${pool}`;
    badge.textContent = pool === 'break' ? 'B' : 'F';

    const name = document.createElement('span');
    name.className   = 'music-track-item-name';
    name.textContent = t.displayName;
    name.addEventListener('click', () => musicPlaySpecific(i));

    const del = document.createElement('button');
    del.className   = 'music-track-item-del';
    del.textContent = '✕';
    del.title = 'Remove track';
    del.addEventListener('click', async () => {
      await tracker.music.deleteTrack(musicActiveTheme, t.pool || 'focus', t.filename);
      if (musicCurrentIdx === i) {
        musicAudio.pause();
        musicAudio.src = '';
        musicIsPlaying = false;
        musicActivePool = null;
        musicCurrentIdx = -1;
        musicNowPlaying.hidden = true;
      } else if (musicCurrentIdx > i) {
        musicCurrentIdx--;
      }
      musicTracks.splice(i, 1);
      musicRenderPlaylist();
      musicUpdateControls();
    });

    li.append(badge, name, del);
    musicPlaylist.appendChild(li);
  });
}

// ── Core playback ─────────────────────────────────────────────────────────────

function musicStop() {
  musicAudio.pause();
  musicIsPlaying = false;
  musicUpdateControls();
  musicRenderPlaylist();
}

function musicClear() {
  musicAudio.pause();
  musicAudio.src   = '';
  musicIsPlaying   = false;
  musicActivePool  = null;
  musicCurrentIdx  = -1;
  musicNowPlaying.hidden = true;
  musicUpdateControls();
  musicRenderPlaylist();
}

function musicPlayFromPool(pool) {
  const poolTracks = musicPoolTracks(pool);
  if (poolTracks.length === 0) return;

  // Resume if the same pool is already loaded and just paused
  if (musicActivePool === pool && musicCurrentIdx >= 0 && musicAudio.paused && musicAudio.src) {
    musicAudio.volume = parseFloat(musicVolume.value);
    musicAudio.play().catch(() => {});
    musicIsPlaying = true;
    musicUpdateControls();
    musicRenderPlaylist();
    return;
  }

  const track = musicPickRandom(pool);
  if (!track) return;

  if (pool === 'focus') musicLastFocusFilename = track.filename;
  else                  musicLastBreakFilename = track.filename;

  musicActivePool = pool;
  musicCurrentIdx = musicTracks.indexOf(track);

  musicAudio.src    = `file://${track.filePath}`;
  musicAudio.volume = parseFloat(musicVolume.value);
  musicAudio.play().catch(() => {});
  musicIsPlaying = true;
  musicTrackName.textContent = track.displayName;
  musicNowPlaying.hidden     = false;
  musicRenderPlaylist();
  musicUpdateControls();
}

function musicPlayForCurrentMode() {
  musicPlayFromPool(currentMode === 'pomodoro' ? 'focus' : 'break');
}

function musicPlaySpecific(idx) {
  const track = musicTracks[idx];
  if (!track) return;
  const pool = track.pool || 'focus';
  musicActivePool = pool;
  musicCurrentIdx = idx;
  if (pool === 'focus') musicLastFocusFilename = track.filename;
  else                  musicLastBreakFilename = track.filename;
  musicAudio.src    = `file://${track.filePath}`;
  musicAudio.volume = parseFloat(musicVolume.value);
  musicAudio.play().catch(() => {});
  musicIsPlaying = true;
  musicTrackName.textContent = track.displayName;
  musicNowPlaying.hidden     = false;
  musicRenderPlaylist();
  musicUpdateControls();
}

function musicSkipInPool() {
  const pool       = musicActivePool || (currentMode === 'pomodoro' ? 'focus' : 'break');
  const poolTracks = musicPoolTracks(pool);
  if (poolTracks.length === 0) return;

  const lastName   = pool === 'focus' ? musicLastFocusFilename : musicLastBreakFilename;
  const candidates = poolTracks.length > 1 ? poolTracks.filter(t => t.filename !== lastName) : poolTracks;
  const track      = candidates[Math.floor(Math.random() * candidates.length)];

  if (pool === 'focus') musicLastFocusFilename = track.filename;
  else                  musicLastBreakFilename = track.filename;

  musicActivePool = pool;
  musicCurrentIdx = musicTracks.indexOf(track);
  musicAudio.src    = `file://${track.filePath}`;
  musicAudio.volume = parseFloat(musicVolume.value);
  musicAudio.play().catch(() => {});
  musicIsPlaying = true;
  musicTrackName.textContent = track.displayName;
  musicNowPlaying.hidden     = false;
  musicRenderPlaylist();
  musicUpdateControls();
}

// ── Music theme helpers ────────────────────────────────────────────────────────

function applyThemePomodoroMinutes(themeName) {
  MODES.pomodoro.minutes = themeName === 'outer-wilds' ? 22 : 25;
  // If we're on pomodoro and not running, reset to new duration
  if (currentMode === 'pomodoro' && !isRunning) {
    totalSeconds     = MODES.pomodoro.minutes * 60;
    remainingSeconds = totalSeconds;
    renderDisplay();
  }
}

async function reloadMusicForTheme(themeName) {
  musicActiveTheme = themeName;
  applyThemePomodoroMinutes(themeName);
  musicClear();
  try {
    const [focusTracks, breakTracks] = await Promise.all([
      tracker.music.getActiveThemeTracks('focus'),
      tracker.music.getActiveThemeTracks('break'),
    ]);
    musicTracks = [...(focusTracks || []), ...(breakTracks || [])];
  } catch { musicTracks = []; }
  musicRenderPlaylist();
  musicUpdateControls();
}

// ── Event listeners ────────────────────────────────────────────────────────────

musicAudio.addEventListener('ended', () => {
  if (musicActivePool) musicPlayFromPool(musicActivePool);
});

musicPlayPause.addEventListener('click', () => {
  if (musicIsPlaying) musicStop();
  else musicPlayForCurrentMode();
});

musicSkip.addEventListener('click', () => musicSkipInPool());

musicVolume.addEventListener('input', () => {
  musicAudio.volume = parseFloat(musicVolume.value);
});

musicToggleBtn.addEventListener('click', () => {
  const open = musicBody.hidden;
  musicBody.hidden = !open;
  musicToggleArrow.classList.toggle('open', open);
});

// Pool selector for upload
document.querySelectorAll('.music-pool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.music-pool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    musicUploadPool = btn.dataset.pool;
  });
});

musicUploadBtn.addEventListener('click', () => musicFileInput.click());

musicFileInput.addEventListener('change', async () => {
  const files = Array.from(musicFileInput.files);
  for (const file of files) {
    const saved = await tracker.music.saveTrack(
      musicActiveTheme,
      musicUploadPool,
      file.path,
      file.name.replace(/\.[^.]+$/, ''),
    );
    if (saved) musicTracks.push(saved);
  }
  musicFileInput.value = '';
  musicRenderPlaylist();
  musicUpdateControls();
});

// Load existing tracks on init (no auto-play)
(async () => {
  try {
    musicActiveTheme = await tracker.theme.getActive() || 'default';
    applyThemePomodoroMinutes(musicActiveTheme);

    const [focusTracks, breakTracks] = await Promise.all([
      tracker.music.getActiveThemeTracks('focus'),
      tracker.music.getActiveThemeTracks('break'),
    ]);
    musicTracks = [...(focusTracks || []), ...(breakTracks || [])];

  } catch { musicTracks = []; }
  musicRenderPlaylist();
  musicUpdateControls();
})();

// ── Dev panel (development mode only) ─────────────────────────────────────────

(async () => {
  const isDev = await window.tracker.app.isDev();
  if (!isDev) return;

  $('dev-panel').style.display = '';

  // Set timer to any value in seconds
  $('dev-set-timer-btn').addEventListener('click', () => {
    const secs = parseInt($('dev-timer-input').value, 10);
    if (!Number.isNaN(secs) && secs >= 0) {
      remainingSeconds = secs;
      renderDisplay();
    }
  });

  // Force pomodoro completion — triggers decrementTopTaskEstimate, ShipLog, sound, persistSession
  $('dev-force-pomo').addEventListener('click', async () => {
    if (currentMode !== 'pomodoro') switchMode('pomodoro');
    await completeSession();
  });

  // Force break completion — triggers break persistSession
  $('dev-force-break').addEventListener('click', async () => {
    if (currentMode === 'pomodoro') switchMode('short-break');
    await completeSession();
  });

  // Test any sound type individually
  $('dev-sound-play').addEventListener('click', () => {
    playSound($('dev-sound-select').value);
  });

  // Test pre-break music directly
  const _devPreBreakRow = document.createElement('div');
  _devPreBreakRow.className = 'dev-row';
  const _devPreBreakBtn = document.createElement('button');
  _devPreBreakBtn.textContent = '▶ Test Pre-Break Music';
  _devPreBreakBtn.addEventListener('click', () => { console.log('[dev] test pre-break button clicked'); playPreBreakMusic(); });
  _devPreBreakRow.appendChild(_devPreBreakBtn);
  $('dev-panel').appendChild(_devPreBreakRow);

  // Reset cycle counter
  const _devResetRow = document.createElement('div');
  _devResetRow.className = 'dev-row';
  const _devResetBtn = document.createElement('button');
  _devResetBtn.textContent = '↺ Reset Cycle';
  _devResetBtn.addEventListener('click', () => {
    cycleCount = 1;
    renderCycleDots();
  });
  _devResetRow.appendChild(_devResetBtn);
  $('dev-panel').appendChild(_devResetRow);
})();

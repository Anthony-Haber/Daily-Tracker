/* global tracker */
'use strict';

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

// ── Web Audio notification ─────────────────────────────────────────────────────

function playCompletionSound() {
  try {
    const ctx = new AudioContext();
    const notes = [
      { freq: 880, startAt: 0,    duration: 0.18 },
      { freq: 660, startAt: 0.22, duration: 0.22 },
      { freq: 880, startAt: 0.48, duration: 0.30 },
    ];
    notes.forEach(({ freq, startAt, duration }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // Audio unavailable — silently skip
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

// ── Timer control ──────────────────────────────────────────────────────────────

function tick() {
  if (remainingSeconds <= 0) {
    completeSession();
    return;
  }
  remainingSeconds -= 1;
  renderDisplay();
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
    nextMode = pomodoroCount() % 4 === 3 ? 'long-break' : 'short-break';
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

  if (currentMode === 'pomodoro') {
    await decrementTopTaskEstimate();
    musicClear();
  }

  playCompletionSound();
  await persistSession();

  setTimeout(() => {
    remainingSeconds = totalSeconds;
    renderDisplay();
  }, 1500);
}

// ── Mode switching ─────────────────────────────────────────────────────────────

function switchMode(mode) {
  if (isRunning) pauseTimer();
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

$('btn-close')?.addEventListener('click', () => tracker.closeWindow());

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
      await tracker.music.deleteTrack(t.filename);
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
      file.path,
      file.name.replace(/\.[^.]+$/, ''),
      musicUploadPool,
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
    musicTracks = await tracker.music.getTracks() || [];
  } catch { musicTracks = []; }
  musicRenderPlaylist();
  musicUpdateControls();
})();

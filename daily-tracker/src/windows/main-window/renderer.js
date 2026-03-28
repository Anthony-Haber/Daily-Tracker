/* global tracker, applyTheme, triggerShipLog, playSound */
'use strict';

if (window.tracker?.sound?.play) {
  console.log('[sound-renderer] sound API available');
} else {
  console.warn('[sound-renderer] sound API NOT available - check preload.js');
}

// ── Theme ──────────────────────────────────────────────────────────────────────
window.tracker.theme.getActive().then(name => {
  applyTheme(name);
  window.tracker.theme.onChange(applyTheme);
});

// ── Utilities ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateLabel(ds) {
  if (ds === todayStr()) return 'Today';
  const d = new Date(ds + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

const MOOD_EMOJI = { 1: '😴', 2: '😐', 3: '🙂', 4: '😊', 5: '🔥' };

const CAT_LABELS = {
  work: 'Work', personal: 'Personal', health: 'Health',
  learning: 'Learning', other: 'Other', break: 'Break', exercise: 'Exercise',
};

const MEAL_ICONS = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' };

// ── State ─────────────────────────────────────────────────────────────────────

let activePanelId      = 'today';
let allTasks           = [];
let taskFilterDate     = null;
let editingTaskId      = null;
let mealsDate          = todayStr();
let calYear            = new Date().getFullYear();
let calMonth           = new Date().getMonth();
let selectedHistoryDate = null;
let activeDatesSet     = new Set();
let mealTypeSelected   = null;

// ── Navigation ────────────────────────────────────────────────────────────────

function setupNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const panelId = btn.dataset.panel;
      if (panelId === activePanelId) return;

      // Stop history sound if leaving that panel
      if (activePanelId === 'history' && typeof stopLastSound === 'function') stopLastSound();

      // Hide old panel
      document.getElementById('panel-' + activePanelId).classList.add('hidden');
      document.getElementById('panel-' + activePanelId).classList.remove('active');

      // Show new panel
      const newPanel = document.getElementById('panel-' + panelId);
      newPanel.classList.remove('hidden');
      newPanel.classList.add('active');

      // Update nav active state
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePanelId = panelId;

      // Load section data
      if (panelId === 'today')        await loadTodayPanel();
      else if (panelId === 'tasks')   { await loadTasksPanel(); setupKanbanDrop(); }
      else if (panelId === 'meals')   await loadMealsPanel();
      else if (panelId === 'history') { playSound('history'); await loadHistoryPanel(); }
      else if (panelId === 'finance') await loadFinancePanel();
      else if (panelId === 'themes')  await loadThemesPanel();
      else if (panelId === 'settings') await loadSettingsPanel();
    });
  });

  $('btn-focus').addEventListener('click', () => tracker.openWindow('focus'));
  $('btn-reflection').addEventListener('click', () => tracker.openReflectionWindow());
  $('btn-log-activity').addEventListener('click', () => tracker.openPromptWindow());
}

// ── TODAY section ─────────────────────────────────────────────────────────────

async function loadTodayPanel() {
  $('today-title').textContent = 'Today';
  $('today-subtitle').textContent = formatFullDate(todayStr());

  const [logs, tasks, meals, activeDates] = await Promise.all([
    tracker.getLogsByDate(todayStr()),
    tracker.getTasks(),
    tracker.getMealsByDate(todayStr()),
    tracker.getActiveDates(),
  ]);

  // Stats
  const moodLogs = logs.filter(l => l.mood);
  const avgMood  = moodLogs.length
    ? moodLogs.reduce((s, l) => s + l.mood, 0) / moodLogs.length
    : null;
  const tasksDone = tasks.filter(t => t.status === 'done').length;
  const totalCal  = meals.reduce((s, m) => s + (m.calories || 0), 0);

  $('stat-logs').textContent       = logs.length;
  $('stat-avg-mood').textContent   = avgMood ? (MOOD_EMOJI[Math.round(avgMood)] || '—') : '—';
  $('stat-tasks-done').textContent = tasks.length ? `${tasksDone}/${tasks.length}` : '—';
  $('stat-calories').textContent   = totalCal > 0 ? totalCal.toLocaleString() : '—';

  // Streak
  const streak = calcStreak(activeDates);
  $('sidebar-streak').textContent = streak > 0 ? `🔥 ${streak} day streak` : '';

  renderTodayTimeline(logs);
  renderTodayTasks(tasks);
  renderTodayMeals(meals);
}

function calcStreak(activeDates) {
  const s = new Set(activeDates);
  let streak = 0;
  const d = new Date();
  while (s.has(localDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderTodayTimeline(logs) {
  const el    = $('today-timeline');
  const empty = $('today-no-logs');

  if (!logs.length) {
    el.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  el.innerHTML = sorted.map((l, i) => `
    <div class="tl-entry">
      <div class="tl-time">${escapeHtml(formatTimestamp(l.timestamp))}</div>
      <div class="tl-connector">
        <div class="tl-dot"></div>
        ${i < sorted.length - 1 ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-card">
        <div class="tl-card-top">
          <span class="tl-activity">${escapeHtml(l.activity)}</span>
          ${l.mood ? `<span class="tl-mood">${MOOD_EMOJI[l.mood] || ''}</span>` : ''}
        </div>
        ${l.category ? `<span class="cat-badge cat-${escapeHtml(l.category)}">${escapeHtml(CAT_LABELS[l.category] || l.category)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTodayTasks(tasks) {
  const el = $('today-tasks');
  if (!tasks.length) {
    el.innerHTML = '<p class="empty-hint">No tasks yet.</p>';
    return;
  }
  const active    = tasks.filter(t => t.status !== 'done').slice(0, 6);
  const doneCount = tasks.filter(t => t.status === 'done').length;

  el.innerHTML = active.map(t => `
    <div class="summary-item">
      <span class="summary-status status-${escapeHtml(t.status)}"></span>
      <span class="summary-text">${escapeHtml(t.title)}</span>
      ${t.due_date ? `<span class="summary-meta">${escapeHtml(t.due_date)}</span>` : ''}
    </div>
  `).join('') + (doneCount ? `<p class="summary-footer">+ ${doneCount} done</p>` : '');
}

function renderTodayMeals(meals) {
  const el = $('today-meals');
  if (!meals.length) {
    el.innerHTML = '<p class="empty-hint">No meals logged yet.</p>';
    return;
  }
  el.innerHTML = meals.map(m => `
    <div class="summary-item">
      <span class="meal-icon">${MEAL_ICONS[m.meal_type] || '🍽'}</span>
      <span class="summary-text">${escapeHtml(m.description)}</span>
      ${m.calories ? `<span class="summary-meta">${m.calories} cal</span>` : ''}
    </div>
  `).join('');
}

// ── TASKS section ─────────────────────────────────────────────────────────────

async function loadTasksPanel() {
  allTasks = await tracker.getTasks();
  renderKanban(allTasks, taskFilterDate);
}

function renderKanban(tasks, filterDate) {
  const groups = { pending: [], in_progress: [], done: [] };

  for (const t of tasks) {
    if (filterDate && t.due_date !== filterDate) continue;
    if (groups[t.status]) groups[t.status].push(t);
  }

  for (const status of ['pending', 'in_progress', 'done']) {
    const container = $('kcards-' + status);
    const countEl   = $('kcount-' + status);
    countEl.textContent = groups[status].length;
    container.innerHTML = '';
    for (const task of groups[status]) {
      container.appendChild(makeTaskCard(task));
    }
  }
}

function makeTaskCard(task) {
  if (editingTaskId === task.id) {
    return makeTaskEditCard(task);
  }

  const card = document.createElement('div');
  card.className  = 'task-card';
  card.draggable  = true;
  card.dataset.taskId = task.id;

  const dueDateStr = task.due_date
    ? `<span class="tc-due ${isOverdue(task.due_date, task.status) ? 'tc-due-overdue' : ''}">${escapeHtml(task.due_date)}</span>`
    : '';
  const catBadge = task.category
    ? `<span class="cat-badge cat-${escapeHtml(task.category)}">${escapeHtml(CAT_LABELS[task.category] || task.category)}</span>`
    : '';

  const statusBtns = task.status === 'pending'
    ? `<button class="tc-btn tc-start">▶ Start</button>`
    : task.status === 'in_progress'
      ? `<button class="tc-btn tc-pause">⏸ Pause</button><button class="tc-btn tc-complete">✓ Done</button>`
      : `<button class="tc-btn tc-undo">↩ Undo</button>`;

  const estimate = task.pomodoro_estimate ?? 1;
  const pomoBadge = `<span class="tc-pomos" title="Pomodoro estimate">🍅 ${estimate}</span>`;

  card.innerHTML = `
    <div class="tc-title">${escapeHtml(task.title)}</div>
    ${task.notes ? `<div class="tc-notes">${escapeHtml(task.notes)}</div>` : ''}
    <div class="tc-meta">
      ${catBadge}
      ${dueDateStr}
      ${pomoBadge}
    </div>
    <div class="tc-actions">
      ${statusBtns}
      <button class="tc-btn tc-edit">Edit</button>
      <button class="tc-btn tc-delete">Delete</button>
    </div>
  `;

  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(task.id));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  if (task.status === 'pending') {
    card.querySelector('.tc-start').addEventListener('click', e => {
      e.stopPropagation();
      changeTaskStatus(task.id, 'in_progress');
    });
  } else if (task.status === 'in_progress') {
    card.querySelector('.tc-pause').addEventListener('click', e => {
      e.stopPropagation();
      changeTaskStatus(task.id, 'pending');
    });
    card.querySelector('.tc-complete').addEventListener('click', e => {
      e.stopPropagation();
      changeTaskStatus(task.id, 'done');
    });
  } else if (task.status === 'done') {
    card.querySelector('.tc-undo').addEventListener('click', e => {
      e.stopPropagation();
      changeTaskStatus(task.id, 'pending');
    });
  }

  card.querySelector('.tc-edit').addEventListener('click', e => {
    e.stopPropagation();
    editingTaskId = task.id;
    renderKanban(allTasks, taskFilterDate);
  });

  card.querySelector('.tc-delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${task.title}"?`)) return;
    await tracker.deleteTask(task.id);
    await loadTasksPanel();
  });

  return card;
}

function makeTaskEditCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card task-card-editing';

  const catOptions = ['work', 'personal', 'health', 'learning', 'other'].map(c =>
    `<option value="${c}" ${task.category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`
  ).join('');

  card.innerHTML = `
    <input class="form-input te-title" type="text" value="${escapeHtml(task.title)}" maxlength="200" />
    <textarea class="form-input form-textarea te-notes" rows="2" maxlength="1000">${escapeHtml(task.notes || '')}</textarea>
    <div class="form-row-2">
      <input class="form-input te-due" type="date" value="${escapeHtml(task.due_date || '')}" />
      <select class="form-select te-category">
        <option value="">Category</option>
        ${catOptions}
      </select>
    </div>
    <div class="form-row-inline" style="margin-bottom:8px;">
      <label class="form-inline-label" style="margin-right:6px;">Pomos</label>
      <input class="form-input form-input-pomos te-pomos" type="number" value="${task.pomodoro_estimate ?? 1}" min="1" max="10" />
    </div>
    <div class="form-btns">
      <button class="btn btn-ghost btn-sm te-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm te-save">Save</button>
    </div>
  `;

  card.querySelector('.te-cancel').addEventListener('click', () => {
    try { playSound('close'); } catch (_) {}
    editingTaskId = null;
    renderKanban(allTasks, taskFilterDate);
  });

  card.querySelector('.te-save').addEventListener('click', async () => {
    const title = card.querySelector('.te-title').value.trim();
    if (!title) return;
    const pomos = parseInt(card.querySelector('.te-pomos').value, 10);
    await tracker.updateTask(task.id, {
      title,
      notes:             card.querySelector('.te-notes').value.trim() || null,
      due_date:          card.querySelector('.te-due').value || null,
      category:          card.querySelector('.te-category').value || null,
      pomodoro_estimate: Number.isFinite(pomos) && pomos >= 1 ? pomos : 1,
    });
    editingTaskId = null;
    await loadTasksPanel();
  });

  return card;
}

async function changeTaskStatus(taskId, newStatus) {
  await tracker.updateTask(taskId, { status: newStatus });
  const idx = allTasks.findIndex(t => t.id === taskId);
  if (idx !== -1) allTasks[idx] = { ...allTasks[idx], status: newStatus };
  renderKanban(allTasks, taskFilterDate);
}

function isOverdue(due_date, status) {
  if (status === 'done' || !due_date) return false;
  return due_date < todayStr();
}

function setupKanbanDrop() {
  $$('.kcol-body').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      if (isNaN(taskId)) return;
      const newStatus = col.dataset.status;
      await tracker.updateTask(taskId, { status: newStatus });
      await loadTasksPanel();
    });
  });
}

function setupTaskForm() {
  $('btn-add-task').addEventListener('click', () => {
    const form = $('task-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) $('tf-title').focus();
  });

  $('btn-tf-cancel').addEventListener('click', () => {
    try { playSound('close'); } catch (_) {}
    $('task-form').classList.add('hidden');
  });

  $('btn-tf-save').addEventListener('click', async () => {
    const title = $('tf-title').value.trim();
    if (!title) return;
    const pomos = parseInt($('tf-pomos').value, 10);
    await tracker.insertTask({
      title,
      notes:             $('tf-notes').value.trim() || null,
      due_date:          $('tf-due').value || null,
      category:          $('tf-category').value || null,
      status:            'pending',
      pomodoro_estimate: Number.isFinite(pomos) && pomos >= 1 ? pomos : 1,
    });
    $('tf-title').value    = '';
    $('tf-notes').value    = '';
    $('tf-due').value      = '';
    $('tf-category').value = '';
    $('tf-pomos').value    = '1';
    $('task-form').classList.add('hidden');
    triggerShipLog();
    try { await playSoundAndWait('ship-log'); } catch (_) {}
    try { playSound('checkin'); } catch (_) {}
    await loadTasksPanel();
  });

  $('task-filter-date').addEventListener('change', e => {
    taskFilterDate = e.target.value || null;
    renderKanban(allTasks, taskFilterDate);
  });

  $('btn-clear-filter').addEventListener('click', () => {
    taskFilterDate = null;
    $('task-filter-date').value = '';
    renderKanban(allTasks, null);
  });
}

// ── MEALS section ─────────────────────────────────────────────────────────────

async function loadMealsPanel(date) {
  if (date !== undefined) mealsDate = date;
  $('meals-date-label').textContent   = formatDateLabel(mealsDate);
  $('btn-meals-next').disabled        = mealsDate >= todayStr();

  const meals = await tracker.getMealsByDate(mealsDate);
  renderMealsList(meals);
}

function renderMealsList(meals) {
  const list   = $('meals-list');
  const empty  = $('meals-empty');
  const banner = $('calorie-banner');

  if (!meals.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    banner.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');

  const totalCal = meals.reduce((s, m) => s + (m.calories || 0), 0);
  if (totalCal > 0) {
    banner.textContent = `Daily total: ${totalCal.toLocaleString()} calories`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  list.innerHTML = meals.map(m => `
    <div class="meal-card" data-id="${m.id}">
      <div class="mc-icon">${MEAL_ICONS[m.meal_type] || '🍽'}</div>
      <div class="mc-body">
        <div class="mc-desc">${escapeHtml(m.description)}</div>
        <div class="mc-meta">
          ${m.meal_type ? `<span class="type-badge">${escapeHtml(m.meal_type)}</span>` : ''}
          <span class="mc-time">${escapeHtml(formatTimestamp(m.timestamp))}</span>
          ${m.calories ? `<span class="mc-cal">${m.calories} cal</span>` : ''}
        </div>
      </div>
      <button class="tc-btn tc-delete meal-delete" data-id="${m.id}" title="Delete">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.meal-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await tracker.deleteMeal(parseInt(btn.dataset.id));
      await loadMealsPanel();
    });
  });
}

function setupMealForm() {
  $('btn-add-meal').addEventListener('click', () => {
    const form = $('meal-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      const h    = new Date().getHours();
      const auto = h < 11 ? 'breakfast' : h < 14 ? 'lunch' : h < 18 ? 'snack' : 'dinner';
      selectMealType(auto);
      $('mf-time').value = new Date().toTimeString().slice(0, 5);
      $('mf-desc').focus();
    }
  });

  $$('#meal-type-row .type-pill').forEach(btn => {
    btn.addEventListener('click', () => selectMealType(btn.dataset.type));
  });

  $('btn-mf-cancel').addEventListener('click', () => {
    try { playSound('close'); } catch (_) {}
    $('meal-form').classList.add('hidden');
    mealTypeSelected = null;
    $$('#meal-type-row .type-pill').forEach(b => b.classList.remove('selected'));
  });

  $('btn-mf-save').addEventListener('click', async () => {
    const desc = $('mf-desc').value.trim();
    if (!desc) return;
    const cal     = parseInt($('mf-calories').value);
    const timeVal = $('mf-time').value;
    const ts      = buildTimestamp(mealsDate, timeVal);

    await tracker.insertMeal({
      description: desc,
      meal_type:   mealTypeSelected,
      calories:    Number.isFinite(cal) && cal > 0 ? cal : null,
      timestamp:   ts,
    });

    $('mf-desc').value     = '';
    $('mf-calories').value = '';
    $('mf-time').value     = '';
    mealTypeSelected = null;
    $$('#meal-type-row .type-pill').forEach(b => b.classList.remove('selected'));
    $('meal-form').classList.add('hidden');
    try { playSound('meal-log'); } catch (_) {}
    await loadMealsPanel();
  });

  $('btn-meals-prev').addEventListener('click', () => {
    const d = new Date(mealsDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    loadMealsPanel(localDateStr(d));
  });

  $('btn-meals-next').addEventListener('click', () => {
    if (mealsDate >= todayStr()) return;
    const d = new Date(mealsDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    loadMealsPanel(localDateStr(d));
  });
}

function selectMealType(type) {
  mealTypeSelected = type;
  $$('#meal-type-row .type-pill').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === type);
  });
}

function buildTimestamp(dateStr, timeStr) {
  if (!timeStr) return new Date().toISOString();
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

// ── HISTORY section ───────────────────────────────────────────────────────────

async function loadHistoryPanel() {
  activeDatesSet = new Set(await tracker.getActiveDates());
  renderCalendar(calYear, calMonth);
  if (selectedHistoryDate) {
    await loadHistoryDay(selectedHistoryDate);
  }
}

function renderCalendar(year, month) {
  $('cal-month').textContent = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long', year: 'numeric',
  });

  const grid = $('cal-grid');
  grid.innerHTML = '';

  // Day headers
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
    const h = document.createElement('div');
    h.className   = 'cal-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = todayStr();

  // Leading blank cells
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day other-month';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds   = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className   = 'cal-day';
    cell.textContent = d;

    if (ds === today)                  cell.classList.add('today');
    if (activeDatesSet.has(ds))        cell.classList.add('has-data');
    if (ds === selectedHistoryDate)    cell.classList.add('selected');

    cell.addEventListener('click', async () => {
      selectedHistoryDate = ds;
      renderCalendar(calYear, calMonth);
      await loadHistoryDay(ds);
    });

    grid.appendChild(cell);
  }
}

async function loadHistoryDay(date) {
  const detail = $('history-detail');
  detail.innerHTML = '<p class="empty-hint">Loading…</p>';

  const [logs, meals, reflection, allTasksData] = await Promise.all([
    tracker.getLogsByDate(date),
    tracker.getMealsByDate(date),
    tracker.getReflectionByDate(date),
    tracker.getTasks(),
  ]);

  const dayTasks = allTasksData.filter(t => t.due_date === date);

  let html = `<h2 class="detail-date">${escapeHtml(formatFullDate(date))}</h2>`;

  // Activities
  html += `<div class="detail-section">
    <div class="detail-section-title">Activities (${logs.length})</div>`;
  if (logs.length) {
    html += [...logs]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(l => `
        <div class="detail-entry">
          <span class="de-time">${escapeHtml(formatTimestamp(l.timestamp))}</span>
          <span class="de-text">${escapeHtml(l.activity)}</span>
          ${l.mood ? `<span class="de-mood">${MOOD_EMOJI[l.mood] || ''}</span>` : ''}
          ${l.category ? `<span class="cat-badge cat-${escapeHtml(l.category)}">${escapeHtml(CAT_LABELS[l.category] || l.category)}</span>` : ''}
        </div>
      `).join('');
  } else {
    html += '<p class="empty-hint">No activities logged.</p>';
  }
  html += '</div>';

  // Meals
  html += `<div class="detail-section">
    <div class="detail-section-title">Meals (${meals.length})</div>`;
  if (meals.length) {
    html += meals.map(m => `
      <div class="detail-entry">
        <span class="de-time">${escapeHtml(MEAL_ICONS[m.meal_type] || '🍽')} ${escapeHtml(formatTimestamp(m.timestamp))}</span>
        <span class="de-text">${escapeHtml(m.description)}</span>
        ${m.calories ? `<span class="mc-cal">${m.calories} cal</span>` : ''}
      </div>
    `).join('');
  } else {
    html += '<p class="empty-hint">No meals logged.</p>';
  }
  html += '</div>';

  // Tasks due this day
  if (dayTasks.length) {
    html += `<div class="detail-section">
      <div class="detail-section-title">Tasks Due (${dayTasks.length})</div>`;
    html += dayTasks.map(t => `
      <div class="detail-entry">
        <span class="status-dot status-${escapeHtml(t.status)}" style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${t.status === 'done' ? 'var(--success)' : t.status === 'in_progress' ? 'var(--warning)' : 'var(--text-light)'}"></span>
        <span class="de-text">${escapeHtml(t.title)}</span>
        ${t.category ? `<span class="cat-badge cat-${escapeHtml(t.category)}">${escapeHtml(CAT_LABELS[t.category] || t.category)}</span>` : ''}
      </div>
    `).join('');
    html += '</div>';
  }

  // Reflection
  if (reflection) {
    html += `<div class="detail-section">
      <div class="detail-section-title">Evening Reflection</div>
      <div class="reflection-card">
        ${reflection.mood ? `<div class="rc-mood">${MOOD_EMOJI[reflection.mood] || ''} Mood ${reflection.mood}/10</div>` : ''}
        ${reflection.highlights ? `<div class="rc-field"><span class="rc-label">Highlights</span><p>${escapeHtml(reflection.highlights)}</p></div>` : ''}
        ${reflection.challenges ? `<div class="rc-field"><span class="rc-label">Challenges</span><p>${escapeHtml(reflection.challenges)}</p></div>` : ''}
        ${reflection.gratitude ? `<div class="rc-field"><span class="rc-label">Gratitude</span><p>${escapeHtml(reflection.gratitude)}</p></div>` : ''}
        ${reflection.tomorrow_goals ? `<div class="rc-field"><span class="rc-label">Tomorrow</span><p>${escapeHtml(reflection.tomorrow_goals)}</p></div>` : ''}
      </div>
    </div>`;
  }

  detail.innerHTML = html;
}

// Calendar navigation
function setupCalNav() {
  $('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(calYear, calMonth);
  });

  $('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(calYear, calMonth);
  });
}

// ── FINANCE section ───────────────────────────────────────────────────────────

/* global Chart */

let financeChart        = null;
let financeTypeSelected = 'expense';

const INCOME_CATEGORIES  = ['salary', 'freelance', 'investment', 'gift', 'other'];
const EXPENSE_CATEGORIES = ['food', 'rent', 'transport', 'utilities', 'healthcare', 'entertainment', 'shopping', 'other'];

function formatCurrency(amount) {
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadFinancePanel() {
  await Promise.all([
    loadFinanceSummary(),
    loadFinanceChart(),
    loadNetBalanceGraph(),
    loadFinanceList(),
  ]);
}

async function loadFinanceSummary() {
  const now     = new Date();
  const summary = await tracker.getMonthlyFinanceSummary(now.getFullYear(), now.getMonth() + 1);

  let income = 0, expense = 0;
  for (const row of summary) {
    if (row.type === 'income')  income  = row.total;
    if (row.type === 'expense') expense = row.total;
  }
  const net = income - expense;

  $('fin-month-income').textContent  = formatCurrency(income);
  $('fin-month-expense').textContent = formatCurrency(expense);

  const netEl = $('fin-month-net');
  netEl.textContent = formatCurrency(net);
  netEl.className   = 'fin-summary-value ' + (net >= 0 ? 'fin-positive' : 'fin-negative');
}

async function loadFinanceChart() {
  const rows = await tracker.getFinancesLast30Days();

  // Build ordered list of the last 30 dates
  const dates = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(localDateStr(d));
  }

  const incomeByDate  = {};
  const expenseByDate = {};
  for (const row of rows) {
    if (row.type === 'income')  incomeByDate[row.date]  = row.total;
    if (row.type === 'expense') expenseByDate[row.date] = row.total;
  }

  const labels      = dates.map(d => d.slice(5));   // MM-DD
  const incomeData  = dates.map(d => incomeByDate[d]  || 0);
  const expenseData = dates.map(d => expenseByDate[d] || 0);

  const ctx = $('finance-chart').getContext('2d');

  if (financeChart) {
    financeChart.data.labels            = labels;
    financeChart.data.datasets[0].data  = incomeData;
    financeChart.data.datasets[1].data  = expenseData;
    financeChart.update();
    return;
  }

  financeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:           'Income',
          data:            incomeData,
          borderColor:     '#10B981',
          backgroundColor: 'rgba(16,185,129,.12)',
          fill:            true,
          tension:         0.35,
          pointRadius:     3,
          pointHoverRadius:5,
          borderWidth:     2,
        },
        {
          label:           'Expenses',
          data:            expenseData,
          borderColor:     '#EF4444',
          backgroundColor: 'rgba(239,68,68,.10)',
          fill:            true,
          tension:         0.35,
          pointRadius:     3,
          pointHoverRadius:5,
          borderWidth:     2,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 12, family: "'Segoe UI', system-ui, sans-serif" }, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid:  { color: 'rgba(0,0,0,.04)' },
          ticks: { font: { size: 11 }, maxTicksLimit: 10, color: '#6B7280' },
        },
        y: {
          beginAtZero: true,
          grid:  { color: 'rgba(0,0,0,.04)' },
          ticks: { font: { size: 11 }, color: '#6B7280', callback: v => '$' + v.toLocaleString() },
        },
      },
    },
  });
}

async function loadFinanceList() {
  const transactions = await tracker.getFinances({ limit: 50 });
  renderFinanceList(transactions);
}

function renderFinanceList(transactions) {
  const list = $('finance-list');

  if (!transactions.length) {
    list.innerHTML = '<p class="empty-hint">No transactions yet. Add your first income or expense above.</p>';
    return;
  }

  list.innerHTML = transactions.map(t => `
    <div class="finance-item">
      <div class="fi-date">${escapeHtml(t.date)}</div>
      <span class="fi-type-badge fi-type-${escapeHtml(t.type)}">${t.type === 'income' ? 'Income' : 'Expense'}</span>
      <div class="fi-body">
        <span class="fi-category">${escapeHtml(t.category || '—')}</span>
        ${t.description ? `<span class="fi-desc">${escapeHtml(t.description)}</span>` : ''}
      </div>
      <span class="fi-amount ${t.type === 'income' ? 'fi-amount-income' : 'fi-amount-expense'}">
        ${t.type === 'income' ? '+' : '−'}${formatCurrency(t.amount)}
      </span>
      <button class="tc-btn tc-delete fi-delete" data-id="${t.id}" title="Delete">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.fi-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await tracker.deleteFinance(parseInt(btn.dataset.id));
      await loadFinancePanel();
    });
  });
}

function selectFinanceType(type) {
  financeTypeSelected = type;
  $$('#finance-type-row .type-pill').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === type);
  });

  const cats   = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const select = $('ff-category');
  select.innerHTML = '<option value="">Category</option>' +
    cats.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
}

function setupFinanceForm() {
  $('btn-add-finance').addEventListener('click', () => {
    const form = $('finance-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      $('ff-date').value = todayStr();
      selectFinanceType('expense');
      $('ff-amount').focus();
    }
  });

  $$('#finance-type-row .type-pill').forEach(btn => {
    btn.addEventListener('click', () => selectFinanceType(btn.dataset.type));
  });

  $('btn-ff-cancel').addEventListener('click', () => {
    try { playSound('close'); } catch (_) {}
    $('finance-form').classList.add('hidden');
  });

  $('btn-ff-save').addEventListener('click', async () => {
    const amount = parseFloat($('ff-amount').value);
    if (!amount || amount <= 0) { $('ff-amount').focus(); return; }

    await tracker.insertFinance({
      date:        $('ff-date').value || todayStr(),
      type:        financeTypeSelected,
      amount,
      category:    $('ff-category').value || null,
      description: $('ff-desc').value.trim() || null,
    });

    $('ff-amount').value   = '';
    $('ff-category').value = '';
    $('ff-desc').value     = '';
    $('finance-form').classList.add('hidden');
    try { playSound('finance-log'); } catch (_) {}
    await loadFinancePanel();
  });
}

// ── Net Balance Over Time graph ───────────────────────────────────────────────

async function loadNetBalanceGraph() {
  const rows = await tracker.getAllFinancesForGraph();

  // Aggregate daily net per date
  const dailyNet = {};
  for (const row of rows) {
    dailyNet[row.date] = (dailyNet[row.date] || 0) +
      (row.type === 'income' ? row.total : -row.total);
  }

  // Build date range from earliest record to today
  const txDates = Object.keys(dailyNet).sort();
  if (txDates.length === 0) {
    drawNetBalanceGraph([]);
    return;
  }

  const allDates = [];
  const cur = new Date(txDates[0] + 'T00:00:00');
  const end = new Date(localDateStr(new Date()) + 'T00:00:00');
  while (cur <= end) {
    allDates.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }

  let running = 0;
  const points = allDates.map(date => {
    running += dailyNet[date] || 0;
    return { date, balance: running, hasTx: !!dailyNet[date] };
  });

  drawNetBalanceGraph(points);
}

function drawNetBalanceGraph(points) {
  const canvas  = $('net-balance-canvas');
  const tooltip = $('nb-tooltip');
  if (!canvas) return;

  const dpr  = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth;
  const cssH = canvas.offsetHeight;

  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const font = `11px 'Segoe UI', system-ui, sans-serif`;

  if (points.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = `13px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No finance data yet — add a transaction to see your balance history.', cssW / 2, cssH / 2);
    return;
  }

  const padL = 72, padR = 16, padT = 12, padB = 30;
  const drawW = cssW - padL - padR;
  const drawH = cssH - padT - padB;
  const n = points.length;

  const balances = points.map(p => p.balance);
  const rawMin   = Math.min(...balances, 0);
  const rawMax   = Math.max(...balances, 0);
  const spread   = Math.max(rawMax - rawMin, 1);
  const bMin     = rawMin - spread * 0.08;
  const bMax     = rawMax + spread * 0.08;

  const toX = i  => padL + (n < 2 ? drawW / 2 : i / (n - 1) * drawW);
  const toY = b  => padT + (bMax - b) / (bMax - bMin) * drawH;
  const zeroY    = toY(0);

  // ── Fills ──
  // Pre-compute pixel coordinates once so both fill and stroke share them.
  const px = points.map((p, i) => ({ x: toX(i), y: toY(p.balance) }));

  function tracePath() {
    ctx.beginPath();
    ctx.moveTo(px[0].x, px[0].y);
    for (let i = 1; i < n; i++) {
      const prev2 = px[Math.max(0, i - 2)];
      const prev1 = px[i - 1];
      const cur   = px[i];
      const next  = px[Math.min(n - 1, i + 1)];
      const cp1x  = prev1.x + (cur.x  - prev2.x) / 6;
      const cp1y  = prev1.y + (cur.y  - prev2.y) / 6;
      const cp2x  = cur.x  - (next.x  - prev1.x) / 6;
      const cp2y  = cur.y  - (next.y  - prev1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, cur.x, cur.y);
    }
  }

  const firstX = toX(0);
  const lastX  = toX(n - 1);
  const clipedZeroY = Math.max(padT, Math.min(padT + drawH, zeroY));

  // Green above zero
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, drawW, clipedZeroY - padT);
  ctx.clip();
  tracePath();
  ctx.lineTo(lastX, clipedZeroY);
  ctx.lineTo(firstX, clipedZeroY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(16,185,129,0.12)';
  ctx.fill();
  ctx.restore();

  // Red below zero
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, clipedZeroY, drawW, padT + drawH - clipedZeroY);
  ctx.clip();
  tracePath();
  ctx.lineTo(lastX, clipedZeroY);
  ctx.lineTo(firstX, clipedZeroY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(239,68,68,0.12)';
  ctx.fill();
  ctx.restore();

  // ── Y axis grid + labels ──
  const yTickCount = 5;
  ctx.font = font;
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= yTickCount; k++) {
    const b = bMin + (bMax - bMin) * k / yTickCount;
    const y = toY(b);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + drawW, y);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
    const label = (b >= 0 ? '' : '−') + '$' + Math.abs(b).toLocaleString(undefined, { maximumFractionDigits: 0 });
    ctx.fillText(label, padL - 6, y);
  }

  // ── Zero line ──
  if (zeroY >= padT && zeroY <= padT + drawH) {
    ctx.beginPath();
    ctx.moveTo(padL, zeroY);
    ctx.lineTo(padL + drawW, zeroY);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── X axis labels ──
  const xTickCount = Math.min(7, n);
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let k = 0; k < xTickCount; k++) {
    const i = Math.round(k / Math.max(xTickCount - 1, 1) * (n - 1));
    ctx.fillText(points[i].date.slice(5), toX(i), padT + drawH + 6);
  }

  // ── Main line ──
  tracePath();
  ctx.strokeStyle = '#4F46E5';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.stroke();

  // ── Dots on transaction days ──
  for (let i = 0; i < n; i++) {
    if (!points[i].hasTx) continue;
    const x = toX(i);
    const y = toY(points[i].balance);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = points[i].balance >= 0 ? '#10b981' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Hover tooltip ──
  canvas._nbPoints = points;
  canvas._nbGeom   = { padL, drawW, padT, drawH, n, toX, toY };
}

// Attach tooltip handler once; re-uses data stored on canvas element
(function attachNbTooltip() {
  // defer until DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const canvas  = $('net-balance-canvas');
    const tooltip = $('nb-tooltip');
    if (!canvas || !tooltip) return;
    _setupNbTooltip(canvas, tooltip);
  });

  // also run immediately in case DOM is already ready
  const canvas  = $('net-balance-canvas');
  const tooltip = $('nb-tooltip');
  if (canvas && tooltip) _setupNbTooltip(canvas, tooltip);
}());

function _setupNbTooltip(canvas, tooltip) {
  canvas.addEventListener('mousemove', e => {
    const pts  = canvas._nbPoints;
    const geom = canvas._nbGeom;
    if (!pts || !pts.length || !geom) { tooltip.hidden = true; return; }

    const rect  = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    const { padL, drawW, n } = geom;
    const relX  = Math.max(0, Math.min(1, (mouseX - padL) / drawW));
    const idx   = Math.round(relX * (n - 1));
    const pt    = pts[idx];
    if (!pt) { tooltip.hidden = false; return; }

    const sign = pt.balance >= 0 ? '+' : '−';
    const abs  = Math.abs(pt.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tooltip.textContent = `${pt.date}   ${sign}$${abs}`;
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top  = `${e.clientY - 10}px`;
  });

  canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}

// ── SETTINGS section ──────────────────────────────────────────────────────────

let _settingsInitialized = false;

/** Format hour integer (0-23) as "8:00 AM". */
function fmtHour(h) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

// ── Themes panel ───────────────────────────────────────────────────────────────

function setActiveThemeCard(themeName) {
  document.querySelectorAll('#panel-themes .theme-card[data-theme]').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === themeName);
  });
}

async function loadThemesPanel() {
  const activeTheme = await tracker.theme.getActive();
  setActiveThemeCard(activeTheme);

  document.querySelectorAll('#panel-themes .theme-card[data-theme]').forEach(card => {
    // Remove any previously attached listener by cloning
    const fresh = card.cloneNode(true);
    card.parentNode.replaceChild(fresh, card);
    fresh.addEventListener('click', async () => {
      const themeName = fresh.dataset.theme;
      await tracker.theme.setActive(themeName);
      applyTheme(themeName);
      setActiveThemeCard(themeName);
    });
  });
}

async function loadSettingsPanel() {
  if (!_settingsInitialized) {
    await setupSettingsPanel();
    _settingsInitialized = true;
  }

  // Refresh live values every time panel is opened
  const [s, dbPath] = await Promise.all([
    tracker.getSettings(),
    tracker.getDbPath(),
  ]);

  $('sp-toggle-reminders').checked       = s.remindersEnabled;
  $('sp-sel-start').value                = s.reminderStartHour;
  $('sp-sel-end').value                  = s.reminderEndHour;
  $('sp-sel-checkin-interval').value     = s.checkinInterval || 60;
  $('sp-toggle-startup').checked         = s.launchOnStartup;
  $('sp-db-path').textContent            = dbPath || 'Not configured';

}

async function setupSettingsPanel() {
  // Populate hour selects
  const startSel = $('sp-sel-start');
  const endSel   = $('sp-sel-end');
  for (let h = 0; h < 24; h++) {
    const label = fmtHour(h);
    startSel.appendChild(new Option(label, h));
    endSel.appendChild(new Option(label, h));
  }

  // Load app version
  const version = await tracker.appGetVersion();
  $('sp-version').textContent = version || '—';

  // Reminders toggle
  $('sp-toggle-reminders').addEventListener('change', async (e) => {
    await tracker.setSetting('remindersEnabled', e.target.checked);
  });

  // Hour selects
  $('sp-sel-start').addEventListener('change', async (e) => {
    await tracker.setSetting('reminderStartHour', parseInt(e.target.value, 10));
  });

  $('sp-sel-end').addEventListener('change', async (e) => {
    await tracker.setSetting('reminderEndHour', parseInt(e.target.value, 10));
  });

  // Check-in interval
  $('sp-sel-checkin-interval').addEventListener('change', async (e) => {
    await tracker.setSetting('checkinInterval', parseInt(e.target.value, 10));
  });

  // Startup toggle
  $('sp-toggle-startup').addEventListener('change', async (e) => {
    await tracker.setAutoLaunch(e.target.checked);
  });


  // Change DB folder
  $('sp-btn-change-db').addEventListener('click', async () => {
    const newFolder = await tracker.changeDbFolder();
    if (newFolder) {
      const sep = newFolder.endsWith('/') || newFolder.endsWith('\\') ? '' : '/';
      $('sp-db-path').textContent = newFolder + sep + 'daily-tracker.db';
    }
  });

  // Check for updates
  $('sp-btn-check-updates').addEventListener('click', async () => {
    const btn = $('sp-btn-check-updates');
    btn.disabled    = true;
    btn.textContent = 'Checking…';
    await tracker.updaterCheckNow();
    setTimeout(() => {
      btn.disabled    = false;
      btn.textContent = 'Check for Updates';
      const msg = $('sp-update-msg');
      msg.textContent = 'Update check complete. You\'ll be notified if an update is available.';
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 4000);
    }, 2000);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  setupNav();
  setupTaskForm();
  setupMealForm();
  setupCalNav();
  setupFinanceForm();
  await loadTodayPanel();
}

init();

// ── Cross-window task refresh ─────────────────────────────────────────────────

tracker.onTasksChanged(() => {
  if (activePanelId === 'tasks') {
    loadTasksPanel().then(() => setupKanbanDrop());
  } else if (activePanelId === 'today') {
    loadTodayPanel();
  }
});

// ── Auto-updater banner ───────────────────────────────────────────────────────

(function setupUpdateBanner() {
  const banner      = $('update-banner');
  const bannerText  = $('update-banner-text');
  const progressWrap= $('update-progress-bar-wrap');
  const progressBar = $('update-progress-bar');
  const actionBtn   = $('update-action-btn');
  const dismissBtn  = $('update-dismiss-btn');

  let downloaded = false;

  function showBanner() { banner.classList.remove('hidden'); }

  // Update available — show banner with download button
  window.api.onUpdateAvailable((info) => {
    bannerText.textContent = `v${info.version} is available!`;
    actionBtn.textContent  = 'Download update';
    showBanner();
  });

  // Download progress — swap text for progress bar
  window.api.onUpdateDownloadProgress((progress) => {
    showBanner();
    bannerText.textContent = 'Downloading update…';
    progressWrap.classList.remove('hidden');
    actionBtn.classList.add('hidden');
    progressBar.style.width = Math.round(progress.percent) + '%';
  });

  // Download complete — show restart button
  window.api.onUpdateDownloaded(() => {
    downloaded = true;
    progressWrap.classList.add('hidden');
    bannerText.textContent = 'Update ready to install.';
    actionBtn.textContent  = 'Restart & Install';
    actionBtn.classList.remove('hidden');
    showBanner();
  });

  // Action button: download (first click triggers auto-download via electron-updater)
  // or restart & install once downloaded
  actionBtn.addEventListener('click', () => {
    if (downloaded) {
      window.api.updaterInstall();
    } else {
      window.api.updaterCheckNow();
      actionBtn.disabled = true;
      actionBtn.textContent = 'Downloading…';
    }
  });

  dismissBtn.addEventListener('click', () => {
    try { playSound('close'); } catch (_) {}
    banner.classList.add('hidden');
  });
}());

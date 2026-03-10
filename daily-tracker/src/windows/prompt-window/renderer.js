/* global tracker */

// ── Element refs ──────────────────────────────────────────────────────────────

const activityEl   = document.getElementById('activity');
const charCountEl  = document.getElementById('char-count');
const categoryRow  = document.getElementById('category-row');
const moodRow      = document.getElementById('mood-row');
const btnLog       = document.getElementById('btn-log');
const btnSkip      = document.getElementById('btn-skip');
const clockEl      = document.getElementById('clock');
const toastEl      = document.getElementById('toast');
const taskSection   = document.getElementById('task-section');
const taskList      = document.getElementById('task-list');
const completeRow   = document.getElementById('complete-row');
const completeCheck = document.getElementById('complete-check');
const completeLabel = document.getElementById('complete-label');

// ── State ─────────────────────────────────────────────────────────────────────

let selectedCategory = null;   // string | null
let selectedMood     = null;   // 1-5   | null
let selectedTaskId   = null;   // number | null
let autoFilledTitle  = null;   // string | null — the title we injected, so we can clear it
let markComplete     = false;  // whether to mark selected task done on submit
let submitting       = false;

// ── Clock ─────────────────────────────────────────────────────────────────────

function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
}
updateClock();
setInterval(updateClock, 10_000);

// ── Char counter ──────────────────────────────────────────────────────────────

activityEl.addEventListener('input', () => {
  const len = activityEl.value.length;
  charCountEl.textContent = `${len} / 300`;
  charCountEl.classList.toggle('near-limit', len >= 270);
  syncLogButton();
});

// ── Category pills ────────────────────────────────────────────────────────────

categoryRow.querySelectorAll('.pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const picking = btn.dataset.cat;
    // Toggle off if already selected, otherwise switch.
    if (selectedCategory === picking) {
      btn.classList.remove('selected');
      selectedCategory = null;
    } else {
      categoryRow.querySelectorAll('.pill').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCategory = picking;
    }
  });
});

// ── Mood buttons ──────────────────────────────────────────────────────────────

moodRow.querySelectorAll('.mood-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const picking = parseInt(btn.dataset.mood, 10);
    if (selectedMood === picking) {
      btn.classList.remove('selected');
      selectedMood = null;
    } else {
      moodRow.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMood = picking;
    }
  });
});

// ── Task selector ─────────────────────────────────────────────────────────────

const STATUS_LABEL = { pending: 'Pending', in_progress: 'In progress' };

function renderTasks(tasks) {
  if (!tasks || tasks.length === 0) return;

  taskSection.style.display = '';

  tasks.forEach((task) => {
    const pill = document.createElement('button');
    pill.className = 'task-pill';
    pill.dataset.id     = task.id;
    pill.dataset.status = task.status;
    pill.innerHTML =
      `<span class="task-pill-title">${escapeHtml(task.title)}</span>` +
      `<span class="task-pill-status">${STATUS_LABEL[task.status] ?? task.status}</span>`;

    pill.addEventListener('click', () => {
      if (selectedTaskId === task.id) {
        // Deselect
        pill.classList.remove('selected', 'will-complete');
        selectedTaskId = null;
        markComplete   = false;
        completeRow.style.display  = 'none';
        completeCheck.checked      = false;
        completeLabel.classList.remove('checked');
        pill.querySelector('.task-pill-status').textContent = STATUS_LABEL[task.status] ?? task.status;
        if (activityEl.value === autoFilledTitle) {
          activityEl.value = '';
          activityEl.dispatchEvent(new Event('input'));
        }
        autoFilledTitle = null;
      } else {
        // Select (deselect previous, reset its status text)
        taskList.querySelectorAll('.task-pill').forEach((p) => {
          p.classList.remove('selected', 'will-complete');
          p.querySelector('.task-pill-status').textContent =
            STATUS_LABEL[p.dataset.status] ?? p.dataset.status;
        });
        pill.classList.add('selected');
        selectedTaskId = task.id;
        markComplete   = false;
        completeCheck.checked      = false;
        completeLabel.classList.remove('checked');
        completeRow.style.display  = '';

        if (!activityEl.value.trim()) {
          autoFilledTitle = task.title;
          activityEl.value = task.title;
          activityEl.dispatchEvent(new Event('input'));
        }
      }
    });

    taskList.appendChild(pill);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Mark-complete toggle ───────────────────────────────────────────────────────

completeCheck.addEventListener('change', () => {
  markComplete = completeCheck.checked;
  completeLabel.classList.toggle('checked', markComplete);

  const selectedPill = taskList.querySelector('.task-pill.selected');
  if (!selectedPill) return;

  selectedPill.classList.toggle('will-complete', markComplete);
  selectedPill.querySelector('.task-pill-status').textContent =
    markComplete ? '✓ Done' : (STATUS_LABEL[selectedPill.dataset.status] ?? selectedPill.dataset.status);
});

async function loadTasks() {
  try {
    const all = await tracker.getTasks();
    const active = (all || []).filter(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );
    renderTasks(active);
  } catch {
    // Non-critical — silently ignore
  }
}

// ── Log button state ──────────────────────────────────────────────────────────

function syncLogButton() {
  btnLog.disabled = submitting || !activityEl.value.trim();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast() {
  toastEl.classList.add('visible');
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submit() {
  const activity = activityEl.value.trim();
  if (!activity || submitting) return;

  submitting = true;
  btnLog.disabled  = true;
  btnLog.textContent = 'Logging…';

  try {
    await tracker.insertLog({
      activity,
      category:  selectedCategory,
      mood:      selectedMood,
      task_id:   selectedTaskId,
    });

    if (markComplete && selectedTaskId) {
      await tracker.updateTask(selectedTaskId, { status: 'done' });
    }

    showToast();
    // Brief pause so the user sees the confirmation before the window closes.
    setTimeout(() => tracker.closePrompt(), 900);
  } catch {
    // Restore state on error so the user can retry.
    submitting = false;
    btnLog.disabled   = false;
    btnLog.textContent = 'Log it →';
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    tracker.closePrompt();
    return;
  }

  // Enter submits from anywhere; Shift+Enter in textarea inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey) {
    // Only intercept Enter when the textarea itself is NOT the active element
    // (user may want to move to next line).  Ctrl/Cmd+Enter always submits.
    if (document.activeElement !== activityEl || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      submit();
    }
  }
});

// ── Button events ─────────────────────────────────────────────────────────────

btnLog.addEventListener('click',  submit);
btnSkip.addEventListener('click', () => tracker.closePrompt());

// ── Boot ──────────────────────────────────────────────────────────────────────

loadTasks();
activityEl.focus();

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

// ── State ─────────────────────────────────────────────────────────────────────

let selectedCategory = null;   // string | null
let selectedMood     = null;   // 1-5   | null
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
    });

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

activityEl.focus();

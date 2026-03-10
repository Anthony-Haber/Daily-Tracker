/* global tracker */

const headerTitle      = document.getElementById('header-title');
const moodSlider       = document.getElementById('mood-slider');
const moodCurrent      = document.getElementById('mood-current');
const highlightsEl     = document.getElementById('highlights');
const challengesEl     = document.getElementById('challenges');
const gratitudeEl      = document.getElementById('gratitude');
const tomorrowEl       = document.getElementById('tomorrow-goals');
const journalEl        = document.getElementById('journal');
const journalCharCount = document.getElementById('journal-char-count');
const btnSave          = document.getElementById('btn-save');
const btnSkip          = document.getElementById('btn-skip');
const formContent      = document.getElementById('form-content');
const successState     = document.getElementById('success-state');
const btnClose         = document.getElementById('btn-close');

function getMoodLabel(value) {
  if (value >= 9.5) return { emoji: '🔥', word: 'Excellent' };
  if (value >= 8)   return { emoji: '😊', word: 'Great' };
  if (value >= 6)   return { emoji: '🙂', word: 'Good' };
  if (value >= 4)   return { emoji: '😐', word: 'Okay' };
  if (value >= 2)   return { emoji: '😔', word: 'Rough' };
  return { emoji: '😴', word: 'Exhausted' };
}

function updateMoodDisplay(value) {
  const v = parseFloat(value);
  const { emoji, word } = getMoodLabel(v);
  moodCurrent.textContent = `${v.toFixed(1)}  ${emoji}  ${word}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Init ──────────────────────────────────────────────────────────────────────

const today = todayStr();
headerTitle.textContent = `Evening Reflection \u2014 ${formatDate(today)}`;
updateMoodDisplay(moodSlider.value);

(async () => {
  const existing = await tracker.getReflectionByDate(today);
  if (existing) {
    if (existing.mood) {
      moodSlider.value = existing.mood;
      updateMoodDisplay(existing.mood);
    }
    highlightsEl.value = existing.highlights     ?? '';
    challengesEl.value = existing.challenges     ?? '';
    gratitudeEl.value  = existing.gratitude      ?? '';
    tomorrowEl.value   = existing.tomorrow_goals ?? '';
    journalEl.value    = existing.journal_entry  ?? '';
    journalCharCount.textContent = journalEl.value.length;
  }
  highlightsEl.focus();
})();

// ── Mood slider ───────────────────────────────────────────────────────────────

moodSlider.addEventListener('input', () => {
  updateMoodDisplay(moodSlider.value);
});

// ── Journal — char count + debounced auto-save ────────────────────────────────

function getFormData() {
  return {
    date:          today,
    mood:          parseFloat(moodSlider.value),
    highlights:    highlightsEl.value.trim(),
    challenges:    challengesEl.value.trim(),
    gratitude:     gratitudeEl.value.trim(),
    tomorrow_goals: tomorrowEl.value.trim(),
    journal_entry: journalEl.value,
  };
}

let autoSaveTimer = null;

journalEl.addEventListener('input', () => {
  journalCharCount.textContent = journalEl.value.length;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    tracker.upsertReflection(getFormData());
  }, 2000);
});

// ── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  clearTimeout(autoSaveTimer);
  btnSave.disabled        = true;
  btnSave.textContent     = 'Saving\u2026';

  await tracker.upsertReflection(getFormData());

  formContent.classList.add('hidden');
  successState.classList.remove('hidden');
});

// ── Close / skip ──────────────────────────────────────────────────────────────

btnSkip.addEventListener('click',  () => tracker.closeReflection());
btnClose.addEventListener('click', () => tracker.closeReflection());

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

const MOOD_LABELS = ['', 'Rough', 'Okay', 'Good', 'Great', 'Excellent'];

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
moodCurrent.textContent = MOOD_LABELS[parseInt(moodSlider.value, 10)];

(async () => {
  const existing = await tracker.getReflectionByDate(today);
  if (existing) {
    if (existing.mood) {
      moodSlider.value        = existing.mood;
      moodCurrent.textContent = MOOD_LABELS[existing.mood];
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
  moodCurrent.textContent = MOOD_LABELS[parseInt(moodSlider.value, 10)];
});

// ── Journal — char count + debounced auto-save ────────────────────────────────

function getFormData() {
  return {
    date:          today,
    mood:          parseInt(moodSlider.value, 10),
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

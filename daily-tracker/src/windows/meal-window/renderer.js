/* global tracker */

const typeRow       = document.getElementById('type-row');
const descInput     = document.getElementById('description');
const caloriesInput = document.getElementById('calories');
const btnSave       = document.getElementById('btn-save');
const btnSkip       = document.getElementById('btn-skip');
const timeLabel     = document.getElementById('time-label');

let selectedType = null;

// ── Init ──────────────────────────────────────────────────────────────────────

timeLabel.textContent = new Date().toLocaleTimeString(undefined, {
  hour: '2-digit', minute: '2-digit',
});

// Pre-select meal type based on current hour
(function preselectMealType() {
  const h = new Date().getHours();
  const auto = h < 11 ? 'breakfast' : h < 14 ? 'lunch' : h < 18 ? 'snack' : 'dinner';
  selectType(auto);
})();

window.addEventListener('DOMContentLoaded', () => descInput.focus());

// ── Meal type buttons ─────────────────────────────────────────────────────────

function selectType(type) {
  typeRow.querySelectorAll('.type-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.type === type);
  });
  selectedType = type;
  updateSaveState();
}

typeRow.querySelectorAll('.type-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectType(btn.dataset.type));
});

// ── Save button state ─────────────────────────────────────────────────────────

descInput.addEventListener('input', updateSaveState);

function updateSaveState() {
  btnSave.disabled = !descInput.value.trim();
}

// ── Actions ───────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';

  const cal = parseInt(caloriesInput.value, 10);

  await tracker.insertMeal({
    meal_type:   selectedType,
    description: descInput.value.trim(),
    calories:    Number.isFinite(cal) && cal > 0 ? cal : null,
  });

  tracker.closeMeal();
});

btnSkip.addEventListener('click', () => tracker.closeMeal());

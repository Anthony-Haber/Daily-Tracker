/* global tracker */
'use strict';

const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────────────────────────

let selectedType = 'expense';

// ── Init ───────────────────────────────────────────────────────────────────────

$('date').value = new Date().toISOString().slice(0, 10);

// ── Type toggle ────────────────────────────────────────────────────────────────

document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedType = btn.dataset.type;
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

function validate() {
  const amount = parseFloat($('amount').value);
  $('btn-save').disabled = !(amount > 0);
}

$('amount').addEventListener('input', validate);

// ── Save ───────────────────────────────────────────────────────────────────────

$('btn-save').addEventListener('click', async () => {
  const amount   = parseFloat($('amount').value);
  const category = $('category').value;
  const notes    = $('notes').value.trim();
  const date     = $('date').value;

  $('btn-save').disabled    = true;
  $('btn-save').textContent = 'Saving…';

  try {
    await tracker.finance.saveEntry({
      date,
      type:        selectedType,
      amount,
      category,
      description: notes || null,
    });
    tracker.closeWindow();
  } catch (err) {
    console.error('[finance] save failed:', err);
    $('btn-save').disabled    = false;
    $('btn-save').textContent = 'Save Entry';
  }
});

// ── Cancel ─────────────────────────────────────────────────────────────────────

$('btn-cancel').addEventListener('click', () => tracker.closeWindow());

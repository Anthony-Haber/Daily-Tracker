/* global tracker, applyTheme, triggerShipLog */
'use strict';

const $ = id => document.getElementById(id);

let defaultFolder = '';
let chosenFolder  = '';   // empty means "use the default"

async function init() {
  // ── Step navigation ────────────────────────────────────────────────────────
  $('btn-next').addEventListener('click', () => showStep('step-folder'));
  $('btn-back').addEventListener('click', () => showStep('step-welcome'));

  // ── Load the suggested default folder ─────────────────────────────────────
  defaultFolder = await tracker.setupGetDefaultFolder();
  $('default-folder-path').textContent = defaultFolder;

  // ── Browse for a custom folder ─────────────────────────────────────────────
  $('btn-choose-folder').addEventListener('click', async () => {
    const result = await tracker.setupChooseFolder();
    if (result) {
      chosenFolder = result;
      $('custom-folder-path').textContent = result;
      $('custom-folder-display').classList.remove('hidden');
      $('folder-card').classList.add('deselected');
    }
  });

  // ── Revert to default ──────────────────────────────────────────────────────
  $('btn-use-default').addEventListener('click', () => {
    chosenFolder = '';
    $('custom-folder-display').classList.add('hidden');
    $('folder-card').classList.remove('deselected');
  });

  // ── Finish setup ───────────────────────────────────────────────────────────
  $('btn-start').addEventListener('click', async () => {
    const folder = chosenFolder || defaultFolder;
    $('btn-start').disabled = true;
    $('btn-start').textContent = 'Setting up…';
    await tracker.setupComplete(folder);
  });
}

function showStep(id) {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}

window.tracker.theme.getActive().then(name => {
  applyTheme(name);
  window.tracker.theme.onChange(applyTheme);
});

init();

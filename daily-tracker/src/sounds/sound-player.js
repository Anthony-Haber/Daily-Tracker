/**
 * sound-player.js — Renderer-side audio playback for theme sounds.
 *
 * Loaded via <script> in every window, after ship-log.js and before renderer.js.
 *
 * Exposes two globals:
 *   window.playSound(soundType)              — active theme, fire-and-forget
 *   window.playSoundAndWait(soundType)       — resolves when audio ends (awaitable)
 *   window.playThemeSound(themeName, type)   — explicit theme variant
 *
 * NOTE: We do NOT try to overwrite window.tracker.sound.play because
 * contextBridge-exposed objects are immutable from the renderer side.
 * Instead, renderers call playSound() directly.
 */
(function () {
  'use strict';

  // Guard: preload must have exposed tracker.sound before this script runs.
  if (!window.tracker || !window.tracker.sound) {
    console.warn('[sound-player] window.tracker.sound not available — skipping setup');
    return;
  }

  let _lastAudio = null;

  function playFilePath(filePath) {
    if (!filePath) {
      console.warn('[sound-renderer] no path returned, skipping');
      return;
    }
    const normalized = filePath.replace(/\\/g, '/');
    const url = encodeURI('file:///' + normalized).replace(/#/g, '%23');
    console.log('[audio] playing:', url);

    const audio = new Audio(url);
    _lastAudio = audio;
    audio.addEventListener('error', () => {
      console.error('[audio] failed to load:', url, audio.error?.code, audio.error?.message);
    });
    audio.play().then(() => {
      console.log('[audio] playing successfully');
    }).catch(e => {
      console.error('[audio] play() failed:', e.message);
    });
  }

  window.stopLastSound = function () {
    if (_lastAudio) {
      _lastAudio.pause();
      _lastAudio.currentTime = 0;
      _lastAudio = null;
    }
  };

  // ── window.playSound — primary entry point for all renderer sound calls ──────
  window.playSound = async function (soundType) {
    try {
      console.log('[sound-renderer] requesting sound:', soundType);
      const filePath = await window.tracker.sound.play(soundType);
      console.log('[sound-renderer] received path:', filePath);
      playFilePath(filePath);
    } catch (err) {
      console.error('[sound-renderer] exception:', err);
    }
  };

  // ── window.playSoundAndWait — plays a sound and resolves when it ends ─────────
  window.playSoundAndWait = async function (soundType) {
    try {
      const filePath = await window.tracker.sound.play(soundType);
      if (!filePath) return;
      const normalized = filePath.replace(/\\/g, '/');
      const url = encodeURI('file:///' + normalized).replace(/#/g, '%23');
      const audio = new Audio(url);
      _lastAudio = audio;
      await new Promise((resolve) => {
        audio.addEventListener('ended', resolve);
        audio.addEventListener('pause',  resolve); // resolves when stopLastSound() is called
        audio.addEventListener('error',  resolve); // don't hang on bad files
        audio.play().catch(resolve);
      });
    } catch (err) {
      console.error('[sound-renderer] playSoundAndWait exception:', err);
    }
  };

  // ── window.playThemeSound — explicit-theme variant ────────────────────────────
  window.playThemeSound = async function (themeName, soundType) {
    try {
      console.log('[sound-renderer] playThemeSound requesting:', themeName, soundType);
      const filePath = await window.tracker.sound.playForTheme(themeName, soundType);
      console.log('[sound-renderer] playThemeSound received path:', filePath);
      playFilePath(filePath);
    } catch (err) {
      console.error('[sound-renderer] playThemeSound exception:', err);
    }
  };

  // ── Main-process push channel (e.g. startup sound) ───────────────────────────
  // main.js resolves the file path and sends it here after app.whenReady().
  window.tracker.sound.onPlayFile(filePath => {
    console.log('[sound-renderer] onPlayFile push from main:', filePath ?? '(null)');
    playFilePath(filePath);
  });

  // ── Native OS close button (title-bar X / Alt+F4) ────────────────────────────
  // main.js intercepts the close event and asks the renderer to play the sound
  // first. Once done, we call closeConfirmed() to let the window actually close.
  if (window.tracker.onCloseWithSound) {
    window.tracker.onCloseWithSound(async () => {
      try { await window.playSoundAndWait('close'); } catch (_) {}
      window.tracker.closeConfirmed();
    });
  }
})();

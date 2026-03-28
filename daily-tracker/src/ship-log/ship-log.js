/**
 * ship-log.js — "SHIP LOG UPDATED" global overlay animation.
 *
 * Include via: <script src="../../ship-log/ship-log.js"></script>
 * Call:        triggerShipLog()  or  triggerShipLog("CUSTOM MESSAGE")
 *
 * - Plays the active theme's "ship-log" sound once at animation start
 *   (via tracker.sound.play — provided by sound-player.js / preload).
 *   If the active theme has no ship-log sound files the call is silently ignored.
 * - Types out text char-by-char with 80 ms delay.
 * - After typing completes, waits 1.5 s then fades out over 500 ms and removes the element.
 * - If called while already running, the new call is ignored (no stacking).
 */
(function () {
  'use strict';

  let _running = false;

  /**
   * Trigger the Ship Log overlay animation.
   * @param {string} [message="SHIP LOG UPDATED"]
   */
  function triggerShipLog(message) {
    if (_running) return;
    _running = true;

    // Play the theme sound once at the start of the animation.
    // tracker.sound.play is wrapped by sound-player.js to also handle playback.
    window.tracker?.sound?.play('ship-log');

    const text = message || 'SHIP LOG UPDATED';

    const overlay = document.createElement('div');
    overlay.className = 'ship-log-overlay';

    const textEl = document.createElement('div');
    textEl.className = 'ship-log-text';
    overlay.appendChild(textEl);
    document.body.appendChild(overlay);

    let charIdx = 0;

    function typeNext() {
      if (charIdx >= text.length) {
        // Text fully displayed — stop the ship-log sound
        window.stopLastSound?.();
        // All characters typed — wait then fade out
        setTimeout(() => {
          overlay.classList.add('fading-out');
          setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            _running = false;
          }, 500);
        }, 1500);
        return;
      }
      textEl.textContent = text.slice(0, charIdx + 1);
      charIdx++;
      setTimeout(typeNext, 80);
    }

    typeNext();
  }

  window.triggerShipLog = triggerShipLog;
})();

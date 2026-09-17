/* Emscripten Module configuration. Loaded before generated xrick.js. */
(function () {
  var params = new URLSearchParams(window.location.search);
  var args = ['-ingame'];
  var submap = Number.parseInt(params.get('submap'), 10);

  /* Browser query uses the project's zero-based SM number; xrick CLI is 1-based. */
  if (Number.isInteger(submap) && submap >= 0 && submap < 47) {
    args.push('-submap', String(submap + 1));
  }
  if (params.get('ghost') === '1' || params.get('ghost') === 'true') {
    args.push('-ghost');
  }

  function resumeAudioContext() {
    var candidates = [
      window.Module && window.Module.SDL2 && window.Module.SDL2.audioContext,
      window.SDL2 && window.SDL2.audioContext,
      window.SDL && window.SDL.audioContext
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var context = candidates[i];
      if (context && context.state === 'suspended' && typeof context.resume === 'function') {
        try { context.resume(); } catch (error) { console.warn('[xrick/audio] resume failed', error); }
      }
    }
  }
  window.xrickResumeAudio = resumeAudioContext;
  window.addEventListener('pointerdown', resumeAudioContext, { passive: true });
  window.addEventListener('keydown', resumeAudioContext, { passive: true });

  /* Keyboard ownership is explicit and reversible.  SDL remains scoped to
   * #stage, but a direct C control bridge is also used because some browser/
   * Emscripten SDL combinations do not deliver key events to a focused DIV.
   * Editor controls are never intercepted: clicking/focusing outside #stage
   * immediately clears held game controls. */
  var gameStage = document.getElementById('stage');
  var gameKeyboardActive = false;
  var gameControlMask = 0;
  var lastPageFocus = null;
  var CONTROL_BY_CODE = Object.freeze({
    ArrowUp: 0x08, KeyO: 0x08,
    ArrowDown: 0x04, KeyK: 0x04,
    ArrowLeft: 0x02, KeyZ: 0x02,
    ArrowRight: 0x01, KeyX: 0x01,
    Space: 0x10, KeyP: 0x80, KeyE: 0x40, Escape: 0x20
  });
  function editableTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, button, [contenteditable="true"]');
  }
  function callKeyboardBridge(bit, pressed) {
    var module = window.Module;
    if (module && typeof module._xrick_rdx_web_keyboard_event === 'function') {
      module._xrick_rdx_web_keyboard_event(bit >>> 0, pressed ? 1 : 0);
      return true;
    }
    return false;
  }
  function clearGameKeyboard() {
    gameControlMask = 0;
    var module = window.Module;
    if (module && typeof module._xrick_rdx_web_keyboard_clear === 'function') {
      module._xrick_rdx_web_keyboard_clear();
    }
  }
  function setGameKeyboardActive(active) {
    var next = !!active;
    if (gameKeyboardActive === next) return;
    gameKeyboardActive = next;
    if (!next) clearGameKeyboard();
    if (gameStage) gameStage.classList.toggle('keyboard-active', next);
    window.dispatchEvent(new CustomEvent('xrick-keyboard-owner-changed', { detail: { owner: next ? 'game' : 'page' } }));
  }
  function gameOwnsKeyboard() { return gameKeyboardActive; }
  function focusPageWorkbench() {
    setGameKeyboardActive(false);
    var target = lastPageFocus;
    if (!(target instanceof HTMLElement) || !document.contains(target)) {
      target = document.querySelector('#rdx-preview-note-text, #rdx-level-preview-panel input, #rdx-level-preview-panel textarea, #rdx-level-preview-panel select, button');
    }
    if (target && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); }
    }
  }
  function handleGameKey(event, pressed) {
    /* F6 is the explicit keyboard-owner switch.  It works in both directions
     * and does not depend on where SDL attached its own browser listeners. */
    if (event.code === 'F6') {
      if (pressed && !event.repeat) {
        event.preventDefault();
        if (gameKeyboardActive) focusPageWorkbench();
        else if (gameStage) {
          setGameKeyboardActive(true);
          try { gameStage.focus({ preventScroll: true }); } catch (error) { gameStage.focus(); }
        }
      }
      return;
    }
    if (!gameKeyboardActive || editableTarget(event.target)) return;
    /* V switches the live renderer between classic and RDX without taking
     * focus away from the game.  Tab is intentionally left native so the
     * keyboard can move back into the workbench. */
    if (pressed && !event.repeat && event.code === 'KeyV') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('xrick-toggle-visual-mode'));
      return;
    }
    var bit = CONTROL_BY_CODE[event.code];
    if (!bit) return;
    event.preventDefault();
    if (pressed) gameControlMask |= bit;
    else gameControlMask &= ~bit;
    callKeyboardBridge(bit, pressed);
  }
  if (gameStage) {
    var focusGame = function () {
      setGameKeyboardActive(true);
      try { gameStage.focus({ preventScroll: true }); } catch (error) { gameStage.focus(); }
    };
    gameStage.addEventListener('pointerdown', focusGame);
    gameStage.addEventListener('click', focusGame);
    gameStage.addEventListener('focus', function () { setGameKeyboardActive(true); });
  }
  document.addEventListener('focusin', function (event) {
    if (!gameStage || (event.target !== gameStage && !gameStage.contains(event.target))) {
      if (event.target instanceof HTMLElement) lastPageFocus = event.target;
      setGameKeyboardActive(false);
    }
  });
  window.addEventListener('keydown', function (event) { handleGameKey(event, true); }, true);
  window.addEventListener('keyup', function (event) { handleGameKey(event, false); }, true);
  window.addEventListener('blur', function () { setGameKeyboardActive(false); });
  window.xrickGameOwnsKeyboard = gameOwnsKeyboard;
  window.xrickFocusPage = focusPageWorkbench;
  window.xrickFocusGame = function () {
    if (gameStage) {
      setGameKeyboardActive(true);
      gameStage.focus({ preventScroll: true });
    }
  };

  var Module = {
    arguments: args,
    canvas: document.getElementById('canvas'),
    print: function (text) { console.log('[xrick]', text); },
    printErr: function (text) { console.error('[xrick]', text); },
    setStatus: function (text) {
      var element = document.getElementById('engine-status');
      if (element) element.textContent = text || 'Running';
    },
    onRuntimeInitialized: function () {
      Module.rdxRuntimeReady = true;
      window.dispatchEvent(new CustomEvent('xrick-runtime-ready'));
    }
  };
  window.Module = Module;
}());

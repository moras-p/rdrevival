/* Dedicated Emscripten host for the browser-only Game Juice Editor.
 * Unlike player.js this never gives SDL ownership of page keyboard events;
 * the editor drives xrick through the existing debug control bridge so one
 * authoritative simulation can feed both A/B panes. */
(function () {
  var params = new URLSearchParams(window.location.search);
  var args = ['-ingame'];
  var submap = Number.parseInt(params.get('submap'), 10);
  if (Number.isInteger(submap) && submap >= 0 && submap < 47) {
    args.push('-submap', String(submap + 1));
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

  var Module = {
    arguments: args,
    canvas: document.getElementById('canvas'),
    print: function (text) { console.log('[xrick/juice]', text); },
    printErr: function (text) { console.error('[xrick/juice]', text); },
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

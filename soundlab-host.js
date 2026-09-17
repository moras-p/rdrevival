/* Dedicated Emscripten host for SoundLab native-context preview.
 * SDL renders into a hidden engine canvas; SoundLab owns the visible authoring
 * canvas and copies authoritative frames through XrickLivePreview. */
(function () {
  function resumeAudioContext() {
    var candidates = [
      window.Module && window.Module.SDL2 && window.Module.SDL2.audioContext,
      window.SDL2 && window.SDL2.audioContext,
      window.SDL && window.SDL.audioContext
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var context = candidates[i];
      if (context && context.state === 'suspended' && typeof context.resume === 'function') {
        try { context.resume(); } catch (error) { console.warn('[xrick/soundlab/audio] resume failed', error); }
      }
    }
  }

  window.xrickResumeAudio = resumeAudioContext;
  window.addEventListener('pointerdown', resumeAudioContext, { passive: true });
  window.addEventListener('keydown', resumeAudioContext, { passive: true });

  var engineCanvas = document.getElementById('sl-engine-canvas');
  if (!engineCanvas) throw new Error('SoundLab Emscripten host requires #sl-engine-canvas.');

  var Module = {
    arguments: ['-ingame'],
    canvas: engineCanvas,
    locateFile: function (path) { return new URL(path, document.baseURI).href; },
    print: function (text) { console.log('[xrick/soundlab]', text); },
    printErr: function (text) { console.error('[xrick/soundlab]', text); },
    setStatus: function () {},
    onRuntimeInitialized: function () {
      Module.rdxRuntimeReady = true;
      window.dispatchEvent(new CustomEvent('xrick-runtime-ready'));
    }
  };
  window.Module = Module;
}());

/* Dedicated Emscripten host for the standalone RDX Level Editor.
 *
 * The Level Editor intentionally does not give SDL ownership of the visible
 * playtest canvas or the page keyboard.  xrick renders into a hidden engine
 * canvas and the active editor shell copies the authoritative native framebuffer into its
 * editor-owned playtest canvas.  Keeping the host separate from player.js
 * also prevents the main preview's focus/keyboard routing from leaking into
 * the editor workspace.
 */
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
        try { context.resume(); } catch (error) { console.warn('[xrick/level-editor/audio] resume failed', error); }
      }
    }
  }

  window.xrickResumeAudio = resumeAudioContext;
  window.addEventListener('pointerdown', resumeAudioContext, { passive: true });
  window.addEventListener('keydown', resumeAudioContext, { passive: true });

  var engineCanvas = document.getElementById('canvas');
  if (!engineCanvas) {
    throw new Error('Level Editor Emscripten host requires the hidden #canvas engine surface.');
  }

  var Module = {
    arguments: args,
    canvas: engineCanvas,
    print: function (text) { console.log('[xrick/level-editor]', text); },
    printErr: function (text) { console.error('[xrick/level-editor]', text); },
    setStatus: function (text) {
      var element = document.getElementById('engine-status');
      if (element && text) element.textContent = text;
    },
    onRuntimeInitialized: function () {
      Module.rdxRuntimeReady = true;
      window.dispatchEvent(new CustomEvent('xrick-runtime-ready'));
    }
  };
  window.Module = Module;
}());

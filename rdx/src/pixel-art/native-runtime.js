const NATIVE_WIDTH = 320;
const NATIVE_HEIGHT = 200;
const INITIALIZE_TIMEOUT_MS = 30000;
const SCRIPT_URL = new URL('../../../xrick.js', import.meta.url).href;

let runtimePromise = null;
let ownedModule = null;
let engineCanvas = null;
let runtimeScript = null;

function isReady(module = globalThis.Module) {
  return !!module?.rdxRuntimeReady && typeof module.cwrap === 'function';
}

function runtimeError(message, cause = null) {
  const error = new Error(message);
  error.code = 'PIXEL_ART_NATIVE_RUNTIME';
  if (cause) error.cause = cause;
  return error;
}

function createEngineCanvas() {
  if (engineCanvas?.isConnected) return engineCanvas;
  const canvas = document.createElement('canvas');
  canvas.id = 'pixel-art-native-canvas';
  canvas.width = NATIVE_WIDTH;
  canvas.height = NATIVE_HEIGHT;
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'none';
  document.body.append(canvas);
  engineCanvas = canvas;
  return canvas;
}

function announceRuntimeReady(module) {
  module.rdxRuntimeReady = true;
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new globalThis.CustomEvent('xrick-runtime-ready'));
  }
}

function cleanupRetryableLoadFailure(module, script, canvas) {
  if (script?.parentNode) script.parentNode.removeChild(script);
  if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
  if (globalThis.Module === module) delete globalThis.Module;
  if (ownedModule === module) ownedModule = null;
  if (runtimeScript === script) runtimeScript = null;
  if (engineCanvas === canvas) engineCanvas = null;
}

/**
 * Lazily owns the native xrick/WASM runtime for Pixel Art production previews.
 * The exact same promise is returned to concurrent callers so the runtime and
 * its hidden canvas/script can only be created once per page session.
 */
export function ensurePixelArtNativeRuntime() {
  if (isReady()) return Promise.resolve(globalThis.Module);
  if (runtimePromise) return runtimePromise;
  if (globalThis.Module && globalThis.Module !== ownedModule) {
    return Promise.reject(runtimeError('Native preview cannot start because another xrick runtime already owns this page.'));
  }

  const canvas = createEngineCanvas();
  let script = null;
  let retryableFailure = false;
  let timeout = null;
  let resolveRuntime;
  let rejectRuntime;

  const attempt = new Promise((resolve, reject) => {
    resolveRuntime = resolve;
    rejectRuntime = reject;
  });
  runtimePromise = attempt;

  const module = {
    arguments: ['-ingame', '-nosound'],
    canvas,
    print(text) { console.log('[xrick/pixel-art]', text); },
    printErr(text) { console.error('[xrick/pixel-art]', text); },
    setStatus() {},
    onRuntimeInitialized() {
      if (isReady(module)) {
        if (timeout) clearTimeout(timeout);
        resolveRuntime(module);
        return;
      }
      announceRuntimeReady(module);
      if (timeout) clearTimeout(timeout);
      resolveRuntime(module);
    },
  };
  ownedModule = module;
  globalThis.Module = module;

  script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.async = true;
  script.dataset.owner = 'pixel-art-native-preview';
  script.onerror = (event) => {
    if (timeout) clearTimeout(timeout);
    retryableFailure = true;
    cleanupRetryableLoadFailure(module, script, canvas);
    rejectRuntime(runtimeError('Native preview runtime failed to load xrick.js.', event instanceof Error ? event : null));
  };
  runtimeScript = script;

  timeout = setTimeout(() => {
    rejectRuntime(runtimeError('Native preview runtime did not initialize within 30 seconds.'));
  }, INITIALIZE_TIMEOUT_MS);

  document.body.append(script);

  attempt.catch(() => {
    if (retryableFailure && runtimePromise === attempt) runtimePromise = null;
  });
  return attempt;
}

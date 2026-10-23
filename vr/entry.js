// The 2D player never imports WebGL/Three.js unless immersive VR is requested.
/** Made and resumed inside the click, while the browser still counts it as a user gesture. */
function roomAudioContext() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  try { const context = new Context(); void context.resume().catch(() => {}); return context; }
  catch { return null; }
}

export function installVrEntry(root = document) {
  const enterClassic = root.getElementById('rdr-vr-classic');
  const enterRevival = root.getElementById('rdr-vr-revival');
  const exit = root.getElementById('rdr-vr-exit');
  const preview = root.getElementById('rdr-vr-preview');
  const rom = root.getElementById('rdr-vr-rom');
  const status = root.getElementById('rdr-vr-status');
  if (!enterClassic || !enterRevival || !exit || !preview || !rom || !status) return;
  const say = message => { status.textContent = message; };
  let active = null;
  let opening = false;
  const buttons = enabled => { enterClassic.disabled = !enabled; enterRevival.disabled = !enabled; };
  buttons(false);
  const probe = async () => {
    if (!globalThis.isSecureContext || !navigator.xr?.isSessionSupported) {
      say('Headset VR requires HTTPS and WebXR. Desktop room preview is available below.');
      return;
    }
    try {
      if (!(await navigator.xr.isSessionSupported('immersive-vr'))) {
        say('No headset detected. Desktop room preview remains available.');
        return;
      }
      buttons(true);
      say('VR available · choose Classic, or validate a Sega ROM for Revival.');
    } catch (error) { say(`VR support could not be checked: ${error.message}`); }
  };
  const getRuntime = () => {
    const gameSession = window.xrickGameSession;
    const presentation = window.xrickVRPresentation;
    if (!gameSession || !presentation) throw new Error('The native game is not ready yet.');
    return { gameSession, presentation };
  };
  const enter = async mode => {
    if (active || opening) return;
    opening = true;
    let gameSession, presentation;
    try {
      ({ gameSession, presentation } = getRuntime());
      gameSession.syncExperience();
      if (mode === 'revival' && !gameSession.rom && !gameSession.bridge.presentationReady())
        throw new Error('Load and validate your Sega ROM before entering Revival VR.');
    } catch (error) { opening = false; say(error.message); return; }
    // User activation MUST reach requestSession synchronously, before imports,
    // file pickers or any unrelated await. The room's spatial audio starts in the same
    // gesture, so room sounds play from the first frame in the headset.
    const audioContext = roomAudioContext();
    let xrSession;
    try { xrSession = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] }); }
    catch (error) { void audioContext?.close(); opening = false; say(`Could not enter VR: ${error.message}`); return; }
    buttons(false);
    preview.disabled = true;
    try {
      if (gameSession.mode !== mode) gameSession.selectExperience(mode);
      if (gameSession.state !== 'playing') gameSession.start();
      const { openTestRoom } = await import('./room.js');
      active = await openTestRoom({ xrSession, gameSession, presentation, audioContext, onStatus: say, onEnd: () => {
        active = null;
        exit.hidden = true;
        buttons(true);
        preview.disabled = false;
        say('Returned to 2D. VR is available for re-entry.');
      } });
      exit.hidden = false;
    } catch (error) {
      try { await xrSession.end(); } catch {}
      active = null;
      buttons(true);
      preview.disabled = false;
      say(`VR setup failed: ${error.message}`);
    } finally { opening = false; }
  };
  preview.addEventListener('click', async () => {
    if (active || opening) return;
    opening = true;
    try {
      const audioContext = roomAudioContext();
      const {gameSession,presentation} = getRuntime();
      gameSession.syncExperience();
      if (gameSession.state !== 'playing') gameSession.start();
      const {openTestRoom} = await import('./room.js');
      active = await openTestRoom({gameSession,presentation,audioContext,onStatus:say,onEnd:() => {
        active=null;exit.hidden=true;preview.disabled=false;say('Returned to ordinary 2D play.');
      }});
      preview.disabled=true;exit.hidden=false;
    } catch(error) {say(`Preview failed: ${error.message}`);}
    finally { opening = false; }
  });
  enterClassic.addEventListener('click', () => { void enter('classic'); });
  enterRevival.addEventListener('click', () => { void enter('revival'); });
  exit.addEventListener('click', () => { void active?.end(); });
  rom.addEventListener('change', async () => {
    const file = rom.files?.[0];
    if (!file) return;
    try {
      const { gameSession } = getRuntime();
      await gameSession.loadRom(file);
      say('Validated Sega ROM for this session. Select Enter VR (Revival).');
    } catch (error) { say(`ROM rejected: ${error.message}`); }
    finally { rom.value = ''; }
  });
  const remember = async () => {
    try {
      const { gameSession } = getRuntime();
      if (!gameSession.rom) await gameSession.loadRememberedRom();
    } catch (error) { console.warn('[VR] remembered ROM unavailable:', error.message); }
  };
  window.addEventListener('xrick-vr-ready', () => { void remember(); });
  if (window.xrickGameSession) void remember();
  void probe();
}
if (typeof document !== 'undefined') installVrEntry();

// The 2D player never imports WebGL/Three.js unless immersive VR is requested.
export function installVrEntry(root = document) {
  const enterClassic = root.getElementById('rdr-vr-classic');
  const enterRevival = root.getElementById('rdr-vr-revival');
  const exit = root.getElementById('rdr-vr-exit');
  const rom = root.getElementById('rdr-vr-rom');
  const status = root.getElementById('rdr-vr-status');
  if (!enterClassic || !enterRevival || !exit || !rom || !status) return;
  const say = message => { status.textContent = message; };
  let active = null;
  const buttons = enabled => { enterClassic.disabled = !enabled; enterRevival.disabled = !enabled; };
  buttons(false);
  const probe = async () => {
    if (!globalThis.isSecureContext || !navigator.xr?.isSessionSupported) {
      say('WebXR immersive VR requires a secure headset browser (HTTPS). Normal 2D play is available.');
      return;
    }
    try {
      if (!(await navigator.xr.isSessionSupported('immersive-vr'))) {
        say('Immersive VR is not supported in this browser. Normal 2D play is available.');
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
    if (active) return;
    let gameSession, presentation;
    try {
      ({ gameSession, presentation } = getRuntime());
      gameSession.syncExperience();
      if (mode === 'revival' && !gameSession.rom && !gameSession.bridge.presentationReady())
        throw new Error('Load and validate your Sega ROM before entering Revival VR.');
    } catch (error) { say(error.message); return; }
    // User activation MUST reach requestSession synchronously, before imports,
    // file pickers or any unrelated await.
    let xrSession;
    try { xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] }); }
    catch (error) { say(`Could not enter VR: ${error.message}`); return; }
    buttons(false);
    try {
      if (gameSession.mode !== mode) gameSession.selectExperience(mode);
      if (gameSession.state !== 'playing') gameSession.start();
      const { openTestRoom } = await import('./room.js');
      active = await openTestRoom({ xrSession, gameSession, presentation, onStatus: say, onEnd: () => {
        active = null;
        exit.hidden = true;
        buttons(true);
        say('Returned to 2D. VR is available for re-entry.');
      } });
      exit.hidden = false;
    } catch (error) {
      try { await xrSession.end(); } catch {}
      active = null;
      buttons(true);
      say(`VR setup failed: ${error.message}`);
    }
  };
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
installVrEntry();

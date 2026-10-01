import { createRealtimeAiController } from './realtime-ai-controller.js';
import { createRealtimeDecisionTrace } from './realtime-decision-trace.js';
import { createSystemOneProvider } from './system-one-provider.js';
import { resolveRealtimeProviderProfile } from './realtime-provider-profiles.js';
import { createRealtimeConfidenceCalibration } from './realtime-confidence-calibration.js';

export const REALTIME_MODEL_STORAGE_KEY = 'rdr.realtime-ai.browser.v1';
const DEFAULT_CONFIG = Object.freeze({
  gatewayUrl: 'http://127.0.0.1:8787',
  profile: 'system-one-local',
  model: '',
  mode: 'shadow',
  cadence: 4,
  calibration: 'uncalibrated'
});

function normalizeLoopbackGateway(value) {
  const url = new URL(String(value || DEFAULT_CONFIG.gatewayUrl));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Realtime gateway must use HTTP(S)');
  if (!(host === 'localhost' || host === '::1' || /^127\./.test(host))) {
    throw new Error('Browser realtime AI may connect only to a loopback decision gateway');
  }
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function normalizeRealtimeBrowserConfig(value = {}) {
  const mode = value.mode === 'live' ? 'live' : 'shadow';
  const cadence = Math.max(1, Math.min(120, Number(value.cadence) || DEFAULT_CONFIG.cadence));
  const profile = String(value.profile || DEFAULT_CONFIG.profile);
  resolveRealtimeProviderProfile(profile);
  return Object.freeze({
    gatewayUrl: normalizeLoopbackGateway(value.gatewayUrl),
    profile,
    model: String(value.model || '').slice(0, 160),
    mode,
    cadence,
    calibration: String(value.calibration || DEFAULT_CONFIG.calibration).slice(0, 120)
  });
}

function defaultStorage() { try { return globalThis.localStorage; } catch (_) { return null; } }

function loadConfig(storage) {
  try { return normalizeRealtimeBrowserConfig(JSON.parse(storage?.getItem?.(REALTIME_MODEL_STORAGE_KEY) || '{}')); }
  catch (_) { return normalizeRealtimeBrowserConfig(DEFAULT_CONFIG); }
}

function saveConfig(storage, config) {
  storage?.setItem?.(REALTIME_MODEL_STORAGE_KEY, JSON.stringify(config));
}

function text(el, value) { if (el) el.textContent = String(value ?? '—'); }
function setStatus(el, message, kind = 'neutral') { if (el) { el.textContent = message; el.dataset.kind = kind; } }

const CONTROL_BITS = Object.freeze([[0x08,'UP'],[0x04,'DOWN'],[0x02,'LEFT'],[0x01,'RIGHT'],[0x10,'FIRE']]);
export function formatRealtimeControlMask(mask) {
  const value=Number(mask)>>>0;if(!value)return 'NEUTRAL';
  const names=CONTROL_BITS.filter(([bit])=>value&bit).map(([,name])=>name);
  const known=CONTROL_BITS.reduce((all,[bit])=>all|bit,0),unknown=value&~known;
  if(unknown)names.push(`0x${unknown.toString(16)}`);
  return names.join('+');
}

function defaultDownload(name, body) {
  const blob = new Blob([body], { type:'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createRealtimeModelWorkbench({
  runtime,
  elements,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = null,
  download = defaultDownload,
  now = () => performance.now(),
  calibrationEntries = []
} = {}) {
  if (!runtime) throw new Error('Realtime model workbench requires runtime');
  storage = storage || defaultStorage();
  if (typeof fetchImpl !== 'function') throw new Error('Realtime model workbench requires fetch');
  let config = loadConfig(storage);
  let gatewayStatus = null;
  let controller = null;
  let trace = createRealtimeDecisionTrace();
  let lastFrame = null;

  function readUi() {
    return normalizeRealtimeBrowserConfig({
      gatewayUrl: elements.gatewayUrl?.value || config.gatewayUrl,
      profile: elements.profile?.value || config.profile,
      model: elements.model?.value || config.model,
      mode: elements.mode?.value || config.mode,
      cadence: elements.cadence?.value || config.cadence,
      calibration: elements.calibration?.value || config.calibration
    });
  }

  function writeUi() {
    if (elements.gatewayUrl) elements.gatewayUrl.value = config.gatewayUrl;
    if (elements.profile) elements.profile.value = config.profile;
    if (elements.model) elements.model.value = config.model;
    if (elements.mode) elements.mode.value = config.mode;
    if (elements.cadence) elements.cadence.value = String(config.cadence);
    if (elements.calibration) elements.calibration.value = config.calibration;
  }

  function persist() { config = readUi(); saveConfig(storage, config); return config; }

  async function refreshGatewayStatus() {
    config = readUi();
    try {
      const response = await fetchImpl(`${config.gatewayUrl}/status`, { cache:'no-store' });
      if (!response?.ok) throw new Error(`gateway HTTP ${response?.status ?? 'error'}`);
      gatewayStatus = await response.json();
      text(elements.gatewayState, `${gatewayStatus.profile || 'unknown'} · ${gatewayStatus.localOnly ? 'local-only' : 'hosted-capable'}`);
      return gatewayStatus;
    } catch (error) {
      gatewayStatus = null;
      text(elements.gatewayState, 'gateway unavailable');
      throw error;
    }
  }

  function makeController() {
    const bridge = runtime.bridge;
    if (!bridge) throw new Error('Load the game runtime before starting realtime AI');
    const profile = resolveRealtimeProviderProfile(config.profile, { model:config.model || null });
    trace = createRealtimeDecisionTrace();
    const provider = createSystemOneProvider({
      fetchImpl,
      endpoint:`${config.gatewayUrl}/v1/systemone`,
      model:config.model || null,
      maxStateBytes:profile.maxStateBytes,
      probabilitySum:profile.probabilitySum,
      family:profile.family,
      now
    });
    controller = createRealtimeAiController({
      bridge, provider, trace, projection:profile.projection, maxStateBytes:profile.maxStateBytes,
      decisionCadenceFrames:config.cadence, decisionTimeoutMs:profile.timeoutMs,
      confidenceCalibration:createRealtimeConfidenceCalibration({profile:config.calibration,version:'1',entries:calibrationEntries}),
      providerProfile:gatewayStatus?.profile || config.profile,
      endpointLocality:gatewayStatus?.localOnly ? 'local' : 'gateway', now
    });
    return controller;
  }

  function render() {
    const status = controller?.status?.() || { mode:'off', activeAction:null, decisionCount:0, staleDiscardCount:0, providerErrorCount:0, receiptCount:trace.list().length };
    text(elements.currentAction, status.activeAction || '—');
    text(elements.control, status.mode==='shadow' ? '—' : formatRealtimeControlMask(status.currentMask || 0));
    text(elements.intentAge, status.activeAction ? `${status.activeActionAge || 0}f` : '—');
    text(elements.request, status.inflight ? `in flight${status.requestAgeMs==null?'':` · ${Math.round(status.requestAgeMs)} ms`}` : status.pending ? 'response pending apply' : 'idle');
    text(elements.safeContinue, status.safeContinueFrames==null ? '—' : `${status.safeContinueFrames}f`);
    text(elements.neutralGaps, status.neutralGapFramesBetweenEquivalentContinuousIntents || 0);
    text(elements.decisions, status.decisionCount || 0);
    text(elements.stale, status.staleDiscardCount || 0);
    text(elements.errors, status.providerErrorCount || 0);
    const last = trace.list().at(-1);
    text(elements.latency, last?.decision?.latencyMs == null ? '—' : `${Math.round(last.decision.latencyMs)} ms`);
    text(elements.projection, last?.projection?.schema ? `${last.projection.schema} · ${last.projection.serializedBytes} B` : '—');
    text(elements.confidence, last?.decision?.confidence == null ? '—' : Number(last.decision.confidence).toFixed(3));
    if (elements.start) elements.start.disabled = status.mode !== 'off';
    if (elements.stop) elements.stop.disabled = status.mode === 'off';
    if (elements.exportTrace) elements.exportTrace.disabled = trace.list().length === 0;
    if (status.mode === 'off' && !status.lastError) setStatus(elements.status, gatewayStatus ? 'Realtime model idle' : 'Realtime model idle · gateway not checked', 'neutral');
    else if (status.lastError) setStatus(elements.status, `Realtime ${status.mode} · ${status.lastError}`, 'warn');
    else {
      let detail='waiting for decision';
      if(status.activeAction)detail=`${status.activeAction} · ${status.inflight?'request in flight':status.lastDisposition==='renew'?'renewed':status.executionKind==='atomic'?'atomic':'active'}`;
      else if(status.lastEndReason==='safety-expiry')detail='neutral · safety lease expired';
      else if(status.lastEndReason==='hard-expiry')detail='neutral · hard lease expired';
      else if(status.lastEndReason==='became-illegal')detail='neutral · action became illegal';
      setStatus(elements.status, `Realtime ${status.mode} · ${detail}`, 'ok');
    }
    return status;
  }

  async function start() {
    persist();
    stop();
    try { await refreshGatewayStatus(); }
    catch (error) { setStatus(elements.status, `Gateway unavailable: ${error.message}`, 'warn'); }
    makeController().start({ mode:config.mode });
    lastFrame = null;
    return render();
  }

  function stop() {
    try { controller?.stop?.(); } finally { controller = null; lastFrame = null; }
    return render();
  }

  function tickFrame(snapshot) {
    if (!controller || controller.mode === 'off') return render();
    const frame = Number(snapshot?.frameSerial ?? runtime.bridge?.snapshot?.().frameSerial) >>> 0;
    if (lastFrame === frame) return render();
    lastFrame = frame;
    try { controller.tick(); }
    catch (error) { controller.stop(); setStatus(elements.status, `Realtime stopped: ${error.message}`, 'error'); }
    return render();
  }

  function exportTrace() {
    const body = trace.exportJsonl();
    if (!body) return false;
    download(`rdr-realtime-ai-trace-${Date.now()}.jsonl`, body);
    return true;
  }

  for (const el of [elements.gatewayUrl,elements.profile,elements.model,elements.mode,elements.cadence,elements.calibration]) {
    el?.addEventListener?.('change', () => { try { persist(); render(); } catch (error) { setStatus(elements.status, error.message, 'error'); } });
  }
  elements.start?.addEventListener?.('click', () => start().catch(error => setStatus(elements.status, error.message, 'error')));
  elements.stop?.addEventListener?.('click', stop);
  elements.refresh?.addEventListener?.('click', () => refreshGatewayStatus().then(render).catch(error => { setStatus(elements.status, error.message, 'warn'); render(); }));
  elements.exportTrace?.addEventListener?.('click', exportTrace);
  writeUi(); render();

  return Object.freeze({ start, stop, tickFrame, render, refreshGatewayStatus, exportTrace, config:() => config, trace:() => trace, gatewayStatus:() => gatewayStatus });
}

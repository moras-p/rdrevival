import { requireArt } from './document.js';
import { animationFrameFingerprint } from './animation-review.js';
import { sha256 } from './image-io.js';

const WIDTH = 320, HEIGHT = 200;
const LABELS = [
  'Phase A · installed native', 'Phase A · candidate overlay',
  'Phase B · installed native', 'Phase B · candidate overlay',
];

/** Validate the exact four native-capture canvases, not a simulated or
 * manually assembled sprite comparison. The exporter is never a production
 * verification: installed/native parity still requires a recompiled runtime.
 */
export async function prepareNativeLadderEvidence(view, doc, candidate) {
  const evidence = view?.production?.context;
  requireArt(view?.mode === 'production' && view?.revision === doc.revision &&
    view?.activeCandidate === candidate && evidence?.proof === 'two-real-native-phases' &&
    evidence.productionVerified === false && evidence.installed === false,
  'EVIDENCE', 'A fresh two-phase native ladder preview is required before evidence export');
  requireArt(Array.isArray(evidence.captures) && evidence.captures.length === 2 &&
    evidence.captures.every((c, i) => c.phase?.phase === i &&
      Number.isInteger(c.frameSerial) && Number.isInteger(c.actor?.mark) &&
      c.actor.mark === evidence.mark && c.submap === evidence.submap),
  'EVIDENCE', 'Native actor identity/phase evidence is inconsistent');
  requireArt(evidence.captures[0].frameSerial !== evidence.captures[1].frameSerial &&
    Array.isArray(evidence.captureTrace) && evidence.captureTrace.length === 2,
  'EVIDENCE', 'Native source phases require distinct replay observations');
  requireArt(Array.isArray(view.panels) && view.panels.length === 4, 'EVIDENCE',
    'Native ladder review must contain exactly four comparison panels');
  const pairs = [];
  for (let phase = 0; phase < 2; phase++) {
    const capture = evidence.captures[phase];
    const frame = doc.frames.find(f => f.id === capture.candidateFrameId);
    requireArt(frame && capture.candidateFingerprint === await animationFrameFingerprint(doc, frame.id),
      'EVIDENCE', 'Candidate pixels, reference pairing or registration changed since native capture');
    const pngLabels = ['installed', 'candidate'];
    for (let kind = 0; kind < 2; kind++) {
      const index = 2 * phase + kind, panel = view.panels[index];
      requireArt(panel.label === LABELS[index] && panel.canvas?.width === WIDTH && panel.canvas?.height === HEIGHT,
        'EVIDENCE', 'Production evidence must be unmodified 320×200 native captures');
      const pixels = panel.canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
      const actual = `sha256:${await sha256(pixels)}`;
      requireArt(actual === (kind === 0 ? capture.installedHash : capture.candidateHash),
        'EVIDENCE', 'Stored native capture bytes differ from their recorded pixel hashes');
      pairs.push({ phase, kind: pngLabels[kind], label: panel.label, canvas: panel.canvas,
        rgbaHash: actual, name: `sm${String(evidence.submap.toString(16)).padStart(2, '0')}-mark${evidence.mark}-phase-${phase ? 'b' : 'a'}-${pngLabels[kind]}.png` });
    }
  }
  return {
    manifest: { schema: 'rdr.pixel_art.native_ladder_review.v1',
      status: 'candidate-evidence-only', installed: false, productionVerified: false,
      documentId: doc.id, revision: doc.revision, candidate,
      sourceRomHash: evidence.nativeRomHash ?? doc.provenance.asset?.sourceHash ?? null,
      renderer: evidence.renderer, action: evidence.action,
      submap: evidence.submap, mark: evidence.mark, replay: evidence.script,
      captures: evidence.captures, captureTrace: evidence.captureTrace,
      panels: pairs.map(({ phase, kind, label, rgbaHash, name }) => ({ phase, kind, label, rgbaHash, name })) },
    panels: pairs,
  };
}

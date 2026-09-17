import {
  encodeProject,
  decodeProject,
  requireArt,
  LIMITS,
} from "./document.js";

function encodedCheckpoints(checkpoints) {
  return [...checkpoints].map(([name, snapshot]) => ({
    name,
    project: encodeProject(snapshot),
  }));
}

function decodedCheckpoints(saved) {
  requireArt(Array.isArray(saved) && saved.length <= 8, "HISTORY", "Invalid saved checkpoints");
  const checkpoints = new Map();
  let pixels = 0;
  for (const entry of saved) {
    requireArt(typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 80 && !checkpoints.has(entry.name), "HISTORY", "Invalid checkpoint name");
    const snapshot = decodeProject(entry.project);
    requireArt(!snapshot.savedCheckpoints && !snapshot.savedCandidates, "HISTORY", "Nested session projects are not supported");
    pixels += snapshot.width * snapshot.height * snapshot.frames.length * snapshot.layers.length + snapshot.references.reduce((n, r) => n + r.rgba.length, 0);
    requireArt(pixels <= 32000000, "LIMIT", "Checkpoint storage budget exceeded");
    checkpoints.set(entry.name, snapshot);
  }
  return checkpoints;
}

// Checkpoints and candidate branches are independent projects, never recursive history graphs.
export function encodeSession(store, { candidates = [], activeCandidate = "main", primaryCandidate = "main" } = {}) {
  const doc = JSON.parse(encodeProject(store.document));
  doc.savedCheckpoints = encodedCheckpoints(store.checkpoints);
  doc.candidateSession = { activeCandidate, primaryCandidate };
  doc.savedCandidates = candidates.map(({ name, store: candidateStore }) => ({
    name,
    project: encodeProject(candidateStore.document),
    checkpoints: encodedCheckpoints(candidateStore.checkpoints),
  }));
  const text = JSON.stringify(doc);
  requireArt(text.length <= LIMITS.projectBytes, "LIMIT", "Project plus checkpoints/candidates exceeds 40 MB");
  return text;
}

export function decodeSession(text) {
  const doc = decodeProject(text);
  const saved = doc.savedCheckpoints ?? [];
  const candidateSession = doc.candidateSession ?? { activeCandidate: "main", primaryCandidate: "main" };
  const savedCandidates = doc.savedCandidates ?? [];
  delete doc.savedCheckpoints;
  delete doc.candidateSession;
  delete doc.savedCandidates;
  const checkpoints = decodedCheckpoints(saved);
  requireArt(Array.isArray(savedCandidates) && savedCandidates.length <= 7, "CANDIDATE", "Invalid saved candidates");
  requireArt(typeof candidateSession.activeCandidate === "string" && typeof candidateSession.primaryCandidate === "string", "CANDIDATE", "Invalid candidate session metadata");
  const candidates = new Map();
  for (const entry of savedCandidates) {
    requireArt(typeof entry.name === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(entry.name) && !candidates.has(entry.name), "CANDIDATE", "Invalid candidate name");
    const candidateDoc = decodeProject(entry.project);
    requireArt(!candidateDoc.savedCheckpoints && !candidateDoc.savedCandidates, "CANDIDATE", "Nested candidates are not supported");
    candidates.set(entry.name, { doc: candidateDoc, checkpoints: decodedCheckpoints(entry.checkpoints ?? []) });
  }
  return { doc, checkpoints, candidates, activeCandidate: candidateSession.activeCandidate, primaryCandidate: candidateSession.primaryCandidate };
}

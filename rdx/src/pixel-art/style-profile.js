import { requireArt } from './document.js';
import { referenceSummaryAllowed } from './references.js';

export const STYLE_PROFILE_SCHEMA = 'rdr.pixel-style-profile.v1';

const boundedText = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function emptyStyleProfile() {
  return {
    schema: STYLE_PROFILE_SCHEMA,
    assetFamily: '',
    referenceIds: [],
    nativeSizeRange: null,
    ramps: [],
    outline: '',
    valueHierarchy: '',
    lightDirection: '',
    clusterScale: '',
    maxLocalColors: 0,
    minFeaturePixels: 1,
    diagonalRhythm: '',
    silhouetteRules: '',
    materials: '',
    animation: '',
    forbiddenTreatments: [],
    positiveNotes: [],
    negativeNotes: [],
    objectiveSummary: [],
  };
}

export function validateStyleProfile(profile, doc = null) {
  requireArt(profile && typeof profile === 'object' && !Array.isArray(profile) && profile.schema === STYLE_PROFILE_SCHEMA, 'STYLE_PROFILE', 'Style profile must use the current schema');
  for (const key of ['assetFamily', 'outline', 'valueHierarchy', 'lightDirection', 'clusterScale', 'diagonalRhythm', 'silhouetteRules', 'materials', 'animation'])
    requireArt(boundedText(profile[key] ?? ''), 'STYLE_PROFILE', `Style profile ${key} must be bounded text`);
  requireArt(Array.isArray(profile.referenceIds) && profile.referenceIds.length <= 16 && profile.referenceIds.every(v => typeof v === 'string' && v.length <= 80) && new Set(profile.referenceIds).size === profile.referenceIds.length, 'STYLE_PROFILE', 'Style profile referenceIds must be unique bounded IDs');
  if (doc) requireArt(profile.referenceIds.every(id => doc.references.some(r => r.id === id)), 'STYLE_PROFILE', 'Style profile references must exist in this document');
  requireArt(profile.nativeSizeRange === null || (Array.isArray(profile.nativeSizeRange) && profile.nativeSizeRange.length === 4 && profile.nativeSizeRange.every(v => integer(v, 1, 4096)) && profile.nativeSizeRange[0] <= profile.nativeSizeRange[2] && profile.nativeSizeRange[1] <= profile.nativeSizeRange[3]), 'STYLE_PROFILE', 'nativeSizeRange is [minWidth,minHeight,maxWidth,maxHeight]');
  requireArt(Array.isArray(profile.ramps) && profile.ramps.length <= 32, 'STYLE_PROFILE', 'Too many palette ramps');
  for (const ramp of profile.ramps) {
    requireArt(ramp && boundedText(ramp.name ?? '', 120) && boundedText(ramp.role ?? '', 500) && Array.isArray(ramp.indices) && ramp.indices.length <= 32 && ramp.indices.every(v => integer(v, 0, 255)) && new Set(ramp.indices).size === ramp.indices.length, 'STYLE_PROFILE', 'Palette ramp requires name, role and unique palette indices');
    if (doc) requireArt(ramp.indices.every(v => v < doc.palette.length), 'STYLE_PROFILE', 'Palette ramp index is outside the document palette');
  }
  requireArt(integer(profile.maxLocalColors ?? 0, 0, 64), 'STYLE_PROFILE', 'maxLocalColors must be 0–64 (0 disables the advisory limit)');
  requireArt(integer(profile.minFeaturePixels ?? 1, 1, 64), 'STYLE_PROFILE', 'minFeaturePixels must be 1–64');
  for (const key of ['forbiddenTreatments', 'positiveNotes', 'negativeNotes'])
    requireArt(Array.isArray(profile[key]) && profile[key].length <= 64 && profile[key].every(v => boundedText(v, 500)), 'STYLE_PROFILE', `Style profile ${key} must be bounded text entries`);
  requireArt(Array.isArray(profile.objectiveSummary) && profile.objectiveSummary.length <= 16, 'STYLE_PROFILE', 'Invalid objective style summary');
  for (const row of profile.objectiveSummary) requireArt(row && typeof row.referenceId === 'string' && Number.isInteger(row.width) && Number.isInteger(row.height), 'STYLE_PROFILE', 'Invalid objective style summary row');
  return profile;
}

function componentSizes(reference) {
  const w = reference.width, h = reference.height, rgba = reference.rgba;
  const seen = new Uint8Array(w * h), sizes = [];
  const opaque = index => rgba[index * 4 + 3] > 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !opaque(start)) continue;
    let size = 0;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const at = stack.pop(); size += 1;
      const x = at % w, y = Math.floor(at / w);
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < w ? at + 1 : -1, y > 0 ? at - w : -1, y + 1 < h ? at + w : -1]) {
        if (next >= 0 && !seen[next] && opaque(next)) { seen[next] = 1; stack.push(next); }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a,b) => a-b);
}

export function objectiveReferenceSummary(reference) {
  const base = { referenceId: reference.id, role: reference.role, policy: reference.policy, width: reference.width, height: reference.height, sampled: false };
  if (!referenceSummaryAllowed(reference)) return base;
  const colors = new Map(); let opaquePixels = 0, minLuma = 255, maxLuma = 0;
  for (let i = 0; i < reference.rgba.length; i += 4) {
    if (!reference.rgba[i + 3]) continue;
    opaquePixels += 1;
    const rgb = reference.rgba.slice(i, i + 3), key = rgb.join(',');
    colors.set(key, (colors.get(key) ?? 0) + 1);
    const luma = Math.round(rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722);
    minLuma = Math.min(minLuma, luma); maxLuma = Math.max(maxLuma, luma);
  }
  const sizes = componentSizes(reference), median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  return { ...base, sampled: true, opaquePixels, uniqueOpaqueColors: colors.size, lumaRange: opaquePixels ? [minLuma, maxLuma] : null,
    components: { count: sizes.length, smallest: sizes[0] ?? 0, median, largest: sizes.at(-1) ?? 0 } };
}

export function normalizeStyleProfile(profile, doc) {
  const base = emptyStyleProfile(), incoming = profile && typeof profile === 'object' ? profile : {};
  const next = { ...base, ...incoming };
  next.schema = STYLE_PROFILE_SCHEMA;
  next.referenceIds = [...(incoming.referenceIds ?? [])];
  next.ramps = (incoming.ramps ?? []).map(r => ({ name: String(r.name ?? ''), role: String(r.role ?? ''), indices: [...(r.indices ?? [])] }));
  for (const key of ['forbiddenTreatments', 'positiveNotes', 'negativeNotes']) next[key] = [...(incoming[key] ?? [])].map(String);
  next.objectiveSummary = next.referenceIds.map(id => doc.references.find(r => r.id === id)).filter(Boolean).map(objectiveReferenceSummary);
  return validateStyleProfile(next, doc);
}

export function paletteRampForIndex(profile, index) {
  return profile?.ramps?.find(ramp => ramp.indices.includes(index)) ?? null;
}

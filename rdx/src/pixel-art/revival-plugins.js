import { AssetPluginRegistry } from './asset-plugins.js';
import { importProduction, exportProduction, BOILING_CROWN } from './production.js';
import { importRdxSprite } from './game-assets.js';
import { requireArt } from './document.js';
import { sha256 } from './image-io.js';

export const boilingCrownPlugin = {
  apiVersion: 1, id: 'boiling-crown-v1', label: 'Revival · Boiling Crown',
  input: 'text', fileSuffixes: ['_blast_pixels.txt'], importAliases: ['production-import'], optionsSchema: { type: 'object', properties: {} },
  previewOptionsSchema: { type: 'object', properties: { frameId: { type: 'string' }, direction: { type: 'integer', minimum: -1, maximum: 1 } }, additionalProperties: false },
  importAsset: text => importProduction(text),
  async validateAsset(doc) { await exportProduction(doc); },
  previewAsset(doc, options = {}) {
    const frameId = options.frameId ?? doc.frames[0].id, index = doc.frames.findIndex(frame => frame.id === frameId);
    requireArt(index >= 0, 'TARGET', 'Unknown Boiling Crown preview frame');
    return { kind: 'native-action-actor-replacement-v1', actionId: 'dynamite.explode', presentation: 'rdx', slot: 3, frameId, direction: Number(options.direction) < 0 ? -1 : 1, postEventFrames: BOILING_CROWN.holds.slice(0, index).reduce((sum, hold) => sum + hold, 0) };
  },
  async exportAsset(doc, { currentSource } = {}) {
    const result = await exportProduction(doc);
    if (currentSource !== undefined) requireArt(typeof currentSource === 'string' && await sha256(currentSource) === result.manifest.sourceHash, 'SOURCE_CHANGED', 'Owning source changed since import; reopen and reconcile before exporting');
    return { files: [{ name: 'dynamite_revival_blast_pixels.txt', text: result.text }], manifest: {
      ...result.manifest, sourceVerified: currentSource !== undefined,
      integration: { source: BOILING_CROWN.source, generator: BOILING_CROWN.generator,
        checks: ['npm run sync:check:assets'], visualAcceptance: 'docs/VISUAL_TESTING.md#sm01-dynamite-crawl-blast',
        status: 'Candidate requires guarded source application, generation and native visual acceptance' },
    } };
  },
};

export const rdxSpritePlugin = {
  apiVersion: 1, id: 'revival-rdx-sprite-v1', label: 'Revival · ROM sprite animation',
  input: 'binary', fileSuffixes: ['.bin', '.rom'], importAliases: ['import-rdx-sprite'],
  optionsSchema: { type: 'object', properties: {
    mapId: { type: 'integer', minimum: 1, maximum: 54, default: 13, title: 'Map' },
    pn: { type: 'integer', minimum: 0, maximum: 255, default: 38, title: 'PN animation' },
  }, required: ['mapId', 'pn'], additionalProperties: false },
  previewOptionsSchema: { type: 'object', properties: {
    submap: { type: 'integer', minimum: 0, maximum: 46 },
    mark: { type: 'integer', minimum: 0, maximum: 65535 },
    frameId: { type: 'string' },
    warmupFrames: { type: 'integer', minimum: 2, maximum: 120 },
  }, required: ['submap', 'mark'], additionalProperties: false },
  importAsset: (bytes, options, context) => importRdxSprite(bytes, { ...options, paletteEntries: context.paletteEntries }),
  validateAsset(doc) {
    requireArt(doc.provenance.asset?.kind === 'rdx-sprite' && doc.palettePolicy, 'ASSET', 'Missing source sprite provenance or fixed palette');
  },
  previewAsset(doc, options) {
    const frameId = options.frameId ?? doc.frames[0].id;
    requireArt(doc.frames.some(frame => frame.id === frameId), 'TARGET', 'Unknown RDX sprite preview frame');
    return { kind: 'native-room-actor-replacement-v1', presentation: 'rdx', submap: options.submap, mark: options.mark, frameId, warmupFrames: options.warmupFrames ?? 12 };
  },
};

// Composition root: add other games here or inject a registry into ArtController.
export const createAssetPlugins = () => new AssetPluginRegistry([boilingCrownPlugin, rdxSpritePlugin]);

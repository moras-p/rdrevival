import { BinaryView, asUint8Array, hex } from './binary.js';
import { sha256Hex } from './hash.js';
import { decompressZx0 } from './zx0.js';
import { RdxError } from './errors.js';

export const RDX_SHA256 = '06ba20d676fe3ded0f79ace313cb8379e6fe30a4cc9794fffdb392b585180a00';
export const DIRECTORY_BASES = [0x01c570, 0x01c574];
export const DIRECTORY_ENTRY_SIZE = 0x12;
export const DIRECTORY_ENTRY_COUNT = 576;

function saneTagByte(value) {
  return value >= 0x41 && value <= 0x5a;
}

function key(tag, id) {
  return `${tag}:${id}`;
}

export class RdxRom {
  static async from(data, options = {}) {
    const bytes = asUint8Array(data);
    const hash = await sha256Hex(bytes);
    return new RdxRom(bytes, { ...options, hash });
  }

  constructor(data, options = {}) {
    this.bytes = asUint8Array(data);
    this.view = new BinaryView(this.bytes, options.label || 'RDX ROM');
    this.hash = options.hash || null;
    this.strictHash = options.strictHash ?? false;
    this.payloadCache = new Map();
    this.warnings = [];
    this.directoryBase = this.#selectDirectoryBase();
    this.assets = this.#parseDirectory();
    this.assetMap = new Map();
    for (const asset of this.assets) {
      const k = key(asset.tag, asset.id);
      if (this.assetMap.has(k)) this.warnings.push(`Duplicate asset ${k}; keeping first directory entry`);
      else this.assetMap.set(k, asset);
    }
    this.validation = this.#validateStructure();
    if (this.strictHash && this.hash !== RDX_SHA256) {
      throw new RdxError('ROM_HASH', 'ROM SHA-256 does not match Rick Dangerous DX 1.3x', {
        expected: RDX_SHA256, actual: this.hash
      });
    }
  }

  #selectDirectoryBase() {
    let best = null;
    for (const base of DIRECTORY_BASES) {
      if (base + DIRECTORY_ENTRY_SIZE * 16 > this.bytes.length) continue;
      let sane = 0;
      for (let i = 0; i < 16; i += 1) {
        const offset = base + i * DIRECTORY_ENTRY_SIZE;
        if (saneTagByte(this.bytes[offset]) && saneTagByte(this.bytes[offset + 1])) sane += 1;
      }
      if (!best || sane > best.sane) best = { base, sane };
    }
    if (!best || best.sane < 8 || best.base + DIRECTORY_ENTRY_COUNT * DIRECTORY_ENTRY_SIZE > this.bytes.length) {
      throw new RdxError('DIRECTORY', 'No plausible 576-entry Scorpion directory was found', {
        romSize: this.bytes.length, probes: DIRECTORY_BASES
      });
    }
    return best.base;
  }

  #parseDirectory() {
    const entries = [];
    for (let ordinal = 0; ordinal < DIRECTORY_ENTRY_COUNT; ordinal += 1) {
      const offset = this.directoryBase + ordinal * DIRECTORY_ENTRY_SIZE;
      const a = this.bytes[offset];
      const b = this.bytes[offset + 1];
      if (!saneTagByte(a) || !saneTagByte(b)) {
        this.warnings.push(`Directory row ${ordinal} has invalid tag bytes; row ignored`);
        continue;
      }
      const tag = String.fromCharCode(a, b);
      const asset = {
        ordinal,
        tag,
        id: this.view.be16(offset + 2),
        flags: this.view.be16(offset + 4),
        offset: this.view.be32(offset + 6),
        storedLength: this.view.be32(offset + 10),
        decodedLength: this.view.be32(offset + 14)
      };
      asset.name = `${tag}${hex(asset.id, 4)}`;
      entries.push(asset);
    }
    return entries;
  }

  #validateStructure() {
    const errors = [];
    const warnings = [];
    let bounded = 0;
    let supported = 0;
    for (const asset of this.assets) {
      if (asset.offset > this.bytes.length || asset.storedLength > this.bytes.length - asset.offset) {
        errors.push(`${asset.name}: payload outside ROM`);
      } else bounded += 1;
      if (asset.flags === 0x0000 || asset.flags === 0x0002) supported += 1;
      else warnings.push(`${asset.name}: unsupported flags 0x${hex(asset.flags, 4)}`);
      if (asset.flags === 0x0002 && asset.decodedLength === 0) warnings.push(`${asset.name}: compressed asset has zero decoded length`);
    }
    for (const required of [['NT', 0], ['PP', 0], ['PP', 0xffff], ['PN', 0], ['PF', 0], ['PI', 0], ['PA', 0]]) {
      if (!this.assetMap?.has(key(...required)) && !this.assets.some(a => a.tag === required[0] && a.id === required[1])) {
        errors.push(`Required asset ${required[0]}${hex(required[1], 4)} missing`);
      }
    }
    const mdCount = this.assets.filter(a => a.tag === 'MD').length;
    if (mdCount < 54) warnings.push(`Only ${mdCount} MD assets found; expected at least 54`);
    if (this.hash && this.hash !== RDX_SHA256) warnings.push('SHA-256 differs from the verified RDX 1.3x ROM');
    return {
      ok: errors.length === 0,
      exactHash: this.hash === RDX_SHA256,
      hash: this.hash,
      directoryBase: this.directoryBase,
      parsedAssets: this.assets.length,
      boundedAssets: bounded,
      supportedFlagAssets: supported,
      mdCount,
      errors,
      warnings: [...this.warnings, ...warnings]
    };
  }

  list(tag = null) {
    return this.assets.filter(asset => tag == null || asset.tag === tag).sort((a, b) => a.id - b.id || a.ordinal - b.ordinal);
  }

  getAsset(tag, id) {
    return this.assetMap.get(key(tag, id)) || null;
  }

  requireAsset(tag, id) {
    const asset = this.getAsset(tag, id);
    if (!asset) throw new RdxError('ASSET_MISSING', `Asset ${tag}${hex(id, 4)} is missing`, { tag, id });
    return asset;
  }

  rawPayload(tag, id) {
    const asset = this.requireAsset(tag, id);
    if (asset.offset > this.bytes.length || asset.storedLength > this.bytes.length - asset.offset) {
      throw new RdxError('ASSET_BOUNDS', `${asset.name} payload is outside the ROM`, asset);
    }
    return this.bytes.slice(asset.offset, asset.offset + asset.storedLength);
  }

  payload(tag, id) {
    const k = key(tag, id);
    if (this.payloadCache.has(k)) return this.payloadCache.get(k);
    const asset = this.requireAsset(tag, id);
    const raw = this.rawPayload(tag, id);
    let decoded;
    if (asset.flags === 0x0000) decoded = raw;
    else if (asset.flags === 0x0002) {
      decoded = decompressZx0(raw, {
        expectedLength: asset.decodedLength,
        maxOutput: Math.max(asset.decodedLength || 0, 16 * 1024 * 1024)
      });
    } else {
      throw new RdxError('ASSET_FLAGS', `${asset.name} uses unsupported flags`, asset);
    }
    this.payloadCache.set(k, decoded);
    return decoded;
  }

  clearCache() {
    this.payloadCache.clear();
  }

  absoluteSlice(offset, length) {
    return this.view.slice(offset, length);
  }
}

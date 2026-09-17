import { RdxError } from './errors.js';

export function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected ArrayBuffer or Uint8Array');
}

export class BinaryView {
  constructor(bytes, label = 'binary') {
    this.bytes = asUint8Array(bytes);
    this.label = label;
  }

  check(offset, length = 1) {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > this.bytes.length) {
      throw new RdxError('BOUNDS', `${this.label}: range outside buffer`, {
        offset, length, size: this.bytes.length
      });
    }
  }

  u8(offset) {
    this.check(offset, 1);
    return this.bytes[offset];
  }

  be16(offset) {
    this.check(offset, 2);
    return (this.bytes[offset] << 8) | this.bytes[offset + 1];
  }

  s16(offset) {
    const value = this.be16(offset);
    return value & 0x8000 ? value - 0x10000 : value;
  }

  be32(offset) {
    this.check(offset, 4);
    return (((this.bytes[offset] << 24) >>> 0) |
      (this.bytes[offset + 1] << 16) |
      (this.bytes[offset + 2] << 8) |
      this.bytes[offset + 3]) >>> 0;
  }

  slice(offset, length) {
    this.check(offset, length);
    return this.bytes.slice(offset, offset + length);
  }
}

export function readBe16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) throw new RdxError('BOUNDS', 'be16 read outside buffer', { offset, size: bytes.length });
  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readBe32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) throw new RdxError('BOUNDS', 'be32 read outside buffer', { offset, size: bytes.length });
  return (((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>> 0;
}

export function signed16(value) {
  return value & 0x8000 ? value - 0x10000 : value;
}

export function hex(value, width = 0) {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

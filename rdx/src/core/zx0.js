import { asUint8Array } from './binary.js';
import { RdxError } from './errors.js';

/**
 * Strict Scorpion/Z80 ZX0 decoder matching the working project decoder.
 * Unlike the research browser, truncated streams and invalid back-references fail.
 */
export function decompressZx0(input, options = {}) {
  const src = asUint8Array(input);
  const expectedLength = options.expectedLength ?? 0;
  const maxOutput = options.maxOutput ?? Math.max(expectedLength, src.length * 32 + 65536);
  let srcPos = 0;
  let bitMask = 0;
  let bitValue = 0;
  let backtrack = false;
  let lastByte = 0;
  let lastOffset = 1;
  const out = [];

  const fail = (code, message, details = {}) => {
    throw new RdxError(code, message, { srcPos, outputLength: out.length, ...details });
  };

  function readByte() {
    if (srcPos >= src.length) fail('ZX0_TRUNCATED', 'ZX0 stream ended unexpectedly');
    lastByte = src[srcPos++];
    return lastByte;
  }

  function readBit() {
    if (backtrack) {
      backtrack = false;
      return lastByte & 1;
    }
    bitMask >>= 1;
    if (bitMask === 0) {
      bitMask = 0x80;
      bitValue = readByte();
    }
    return (bitValue & bitMask) ? 1 : 0;
  }

  function gamma(msb) {
    let value = 1;
    let guard = 0;
    while (readBit() === 0) {
      value = (value << 1) | (readBit() ^ (msb ? 1 : 0));
      guard += 1;
      if (guard > 31 || value > 0x7fffffff) fail('ZX0_GAMMA', 'Invalid ZX0 Elias gamma value');
    }
    return value;
  }

  function push(value) {
    if (out.length >= maxOutput) fail('ZX0_OUTPUT_LIMIT', 'ZX0 output exceeded configured limit', { maxOutput });
    out.push(value & 0xff);
  }

  function copy(length) {
    if (lastOffset <= 0 || lastOffset > out.length) {
      fail('ZX0_BACKREF', 'Invalid ZX0 back-reference offset', { lastOffset, length });
    }
    for (let i = 0; i < length; i += 1) push(out[out.length - lastOffset]);
  }

  let state = 0; // 0 literals, 1 last offset, 2 new offset
  while (state >= 0) {
    if (state === 0) {
      const length = gamma(false);
      for (let i = 0; i < length; i += 1) push(readByte());
      state = readBit() === 0 ? 1 : 2;
    } else if (state === 1) {
      copy(gamma(false));
      state = readBit() === 0 ? 0 : 2;
    } else {
      const msb = gamma(true);
      if (msb === 256) {
        state = -1;
        break;
      }
      const lsb = readByte();
      lastOffset = msb * 128 - (lsb >> 1);
      lastByte = lsb;
      backtrack = true;
      copy(gamma(false) + 1);
      state = readBit() === 0 ? 0 : 2;
    }
  }

  const result = Uint8Array.from(out);
  if (expectedLength && result.length !== expectedLength) {
    throw new RdxError('ZX0_LENGTH', 'ZX0 decoded length does not match directory metadata', {
      expectedLength, actualLength: result.length, srcLength: src.length
    });
  }
  return result;
}

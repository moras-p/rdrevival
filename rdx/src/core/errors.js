export class RdxError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RdxError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details = {}) {
  if (!condition) throw new RdxError(code, message, details);
}

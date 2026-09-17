import { RdxRom } from '../core/rom.js';

export const RDX_ROM_FILENAME = 'Rick_Dangerous_DX_1.3.bin';

const DB_NAME = 'rdr-rom-store';
const DB_VERSION = 1;
const STORE_NAME = 'roms';
const PRIMARY_KEY = 'rdx-primary';
export const CORRECT_ROM_MESSAGE = 'Load the correct RDX ROM (Rick_Dangerous_DX_1.3.bin).';

function bytesCopy(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.slice();
}

function indexedDbApi() { return globalThis.indexedDB || null; }
function persistenceUnavailableError(error) { return error?.name === 'SecurityError' || error?.name === 'InvalidStateError'; }

function openDb() {
  const api = indexedDbApi();
  if (!api) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = api.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the RDR ROM store.'));
  });
}

async function readRecord() {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(PRIMARY_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read the RDR ROM store.'));
    });
  } finally { db.close(); }
}

async function writeRecord(record) {
  const db = await openDb();
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not update the RDR ROM store.'));
    });
    return true;
  } finally { db.close(); }
}

async function deleteRecord() {
  const db = await openDb();
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(PRIMARY_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Could not clear the RDR ROM store.'));
    });
    return true;
  } finally { db.close(); }
}

export function romPersistenceAvailable() { return Boolean(indexedDbApi()); }
export function canConnectRdxRomDirectory() { return typeof globalThis.showDirectoryPicker === 'function'; }

export async function validateRdxRomBytes(bytes) {
  try {
    const payload = bytesCopy(bytes);
    const rom = await RdxRom.from(payload, { strictHash: true, label: 'Remembered RDX ROM' });
    if (!rom.validation.ok) throw new Error(rom.validation.errors.join('; '));
    return { bytes: payload, sha256: rom.hash };
  } catch (error) {
    const wrapped = new Error(`${CORRECT_ROM_MESSAGE} ${error?.message || error}`.trim());
    wrapped.code = 'RDX_ROM_INVALID';
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function readRdxRomFromDirectoryHandle(directoryHandle, filename = RDX_ROM_FILENAME) {
  if (!directoryHandle || typeof directoryHandle.getFileHandle !== 'function') return null;
  if (typeof directoryHandle.queryPermission === 'function') {
    const permission = await directoryHandle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') return null;
  }
  const fileHandle = await directoryHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  const validated = await validateRdxRomBytes(new Uint8Array(await file.arrayBuffer()));
  return { ...validated, name: file.name || filename, source: 'linked-directory', directoryHandle };
}

export async function loadRememberedRdxRom() {
  let record;
  try { record = await readRecord(); }
  catch (error) {
    if (!persistenceUnavailableError(error)) console.warn(`[rdx/rom-store] persistent ROM lookup failed: ${error?.message || error}`);
    return null;
  }
  if (!record) return null;
  if (record.directoryHandle) {
    try {
      const linked = await readRdxRomFromDirectoryHandle(record.directoryHandle, record.filename || RDX_ROM_FILENAME);
      if (linked) {
        await rememberRdxRom(linked.bytes, { name: linked.name, directoryHandle: record.directoryHandle, filename: record.filename || RDX_ROM_FILENAME });
        return linked;
      }
    } catch (error) {
      if (error?.code === 'RDX_ROM_INVALID') {
        try { await deleteRecord(); } catch {}
        throw error;
      }
      console.warn(`[rdx/rom-store] linked ROM directory is unavailable: ${error?.message || error}`);
    }
  }
  if (!record.bytes) return null;
  try {
    const validated = await validateRdxRomBytes(record.bytes);
    return { ...validated, name: record.name || record.filename || RDX_ROM_FILENAME, source: 'browser-storage', directoryHandle: record.directoryHandle || null };
  } catch (error) {
    try { await deleteRecord(); } catch {}
    throw error;
  }
}

export async function rememberRdxRom(bytes, { name = RDX_ROM_FILENAME, directoryHandle = null, filename = RDX_ROM_FILENAME } = {}) {
  const validated = await validateRdxRomBytes(bytes);
  const record = { key: PRIMARY_KEY, name, filename, bytes: validated.bytes, sha256: validated.sha256, directoryHandle, updatedAt: Date.now() };
  try { return await writeRecord(record); }
  catch (error) {
    if (directoryHandle) {
      try {
        if (!persistenceUnavailableError(error)) console.warn(`[rdx/rom-store] directory handle could not be persisted; retaining ROM bytes only: ${error?.message || error}`);
        return await writeRecord({ ...record, directoryHandle: null });
      } catch (fallbackError) {
        if (!persistenceUnavailableError(fallbackError)) console.warn(`[rdx/rom-store] could not persist ROM bytes: ${fallbackError?.message || fallbackError}`);
        return false;
      }
    }
    if (!persistenceUnavailableError(error)) console.warn(`[rdx/rom-store] could not persist ROM bytes: ${error?.message || error}`);
    return false;
  }
}

export async function connectRdxRomDirectory({ filename = RDX_ROM_FILENAME } = {}) {
  if (!canConnectRdxRomDirectory()) throw new Error('This browser does not support persistent directory access. Use Load ROM instead.');
  const directoryHandle = await globalThis.showDirectoryPicker({ id: 'rdr-rdx-rom', mode: 'read', startIn: 'downloads' });
  const fileHandle = await directoryHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  const validated = await validateRdxRomBytes(new Uint8Array(await file.arrayBuffer()));
  await rememberRdxRom(validated.bytes, { name: file.name || filename, directoryHandle, filename });
  return { ...validated, name: file.name || filename, source: 'linked-directory', directoryHandle };
}

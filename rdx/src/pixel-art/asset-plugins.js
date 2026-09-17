import { clone, requireArt, validate } from './document.js';

function validateOptions(schema, options, label = 'plugin') {
  requireArt(schema?.type === 'object' && schema.properties, 'PLUGIN', `${label} requires an object option schema`);
  const clean = { ...(options ?? {}) };
  delete clean.pluginId;
  for (const key of schema.required ?? []) requireArt(clean[key] !== undefined, 'PLUGIN_OPTIONS', `Required ${label} option: ${key}`);
  for (const [key, value] of Object.entries(clean)) {
    const field = schema.properties[key];
    requireArt(field || schema.additionalProperties !== false, 'PLUGIN_OPTIONS', `Unknown ${label} option: ${key}`);
    if (field?.type === 'string') requireArt(typeof value === 'string', 'PLUGIN_OPTIONS', `Invalid text ${label} option: ${key}`);
    if (field?.type === 'boolean') requireArt(typeof value === 'boolean', 'PLUGIN_OPTIONS', `Invalid boolean ${label} option: ${key}`);
    if (field?.enum) requireArt(field.enum.includes(value), 'PLUGIN_OPTIONS', `Invalid ${label} option: ${key}`);
    if (field?.type === 'integer') requireArt(Number.isInteger(value) && (field.minimum === undefined || value >= field.minimum) && (field.maximum === undefined || value <= field.maximum), 'PLUGIN_OPTIONS', `Invalid integer ${label} option: ${key}`);
  }
  return clean;
}

/** Trusted, locally registered adapter code. Project files carry IDs, never code
 * or module URLs. No plugin is loaded from imported content. */
export class AssetPluginRegistry {
  constructor(plugins = []) {
    this.plugins = new Map();
    plugins.forEach(p => this.register(p));
  }
  register(plugin) {
    requireArt(plugin?.apiVersion === 1 && /^[a-z0-9-]+$/.test(plugin.id) &&
      typeof plugin.label === 'string' && ['text', 'binary'].includes(plugin.input) && typeof plugin.importAsset === 'function' &&
      typeof plugin.validateAsset === 'function' && plugin.optionsSchema?.type === 'object' && plugin.optionsSchema.properties,
    'PLUGIN', 'Asset plugin requires API v1, id, label, option schema, importAsset and validateAsset');
    if (plugin.previewAsset !== undefined) {
      requireArt(typeof plugin.previewAsset === 'function' && plugin.previewOptionsSchema?.type === 'object' && plugin.previewOptionsSchema.properties,
        'PLUGIN', 'A preview-capable plugin requires previewAsset and previewOptionsSchema');
    }
    requireArt(!this.plugins.has(plugin.id), 'PLUGIN', 'Duplicate asset plugin ID');
    this.plugins.set(plugin.id, Object.freeze({ ...plugin }));
  }
  list() {
    return [...this.plugins.values()].map(p => ({ id: p.id, apiVersion: p.apiVersion, label: p.label,
      input: p.input, fileSuffixes: p.fileSuffixes ?? [], optionsSchema: clone(p.optionsSchema), previewOptionsSchema: p.previewOptionsSchema ? clone(p.previewOptionsSchema) : null,
      capabilities: { import: true, productionExport: typeof p.exportAsset === 'function', nativePreview: typeof p.previewAsset === 'function' } }));
  }
  get(id) {
    const plugin = this.plugins.get(id);
    requireArt(plugin, 'MISSING_ADAPTER', `No registered asset plugin: ${id ?? '(unbound document)'}`);
    return plugin;
  }
  importId(action, id) {
    return id ?? [...this.plugins.values()].find(p => p.importAliases?.includes(action))?.id;
  }
  documentId(doc) {
    return doc.provenance.plugin?.id ?? doc.provenance.binding?.adapter;
  }
  async import(id, input, options, context = {}) {
    const plugin = this.get(id);
    const clean = validateOptions(plugin.optionsSchema, options, 'plugin');
    if (plugin.validateOptions) await plugin.validateOptions(clean);
    requireArt(plugin.input === 'binary' ? input instanceof Uint8Array : typeof input === 'string', 'HANDLE', `Plugin requires ${plugin.input} input`);
    const doc = await plugin.importAsset(input, clean, context);
    validate(doc);
    doc.provenance.plugin = { id: plugin.id, apiVersion: plugin.apiVersion };
    await plugin.validateAsset(doc);
    return doc;
  }
  async export(doc, context = {}) {
    const plugin = this.get(this.documentId(doc));
    requireArt(!doc.provenance.plugin || doc.provenance.plugin.apiVersion === plugin.apiVersion, 'PLUGIN', 'Asset plugin version mismatch');
    requireArt(typeof plugin.exportAsset === 'function', 'MISSING_ADAPTER', `${plugin.label} supports editable import; gameplay export is not implemented`);
    validate(doc);
    await plugin.validateAsset(doc);
    const result = await plugin.exportAsset(doc, context);
    requireArt(result?.manifest && Array.isArray(result.files) && result.files.length > 0 &&
      result.files.every(f => /^[a-zA-Z0-9_.-]+$/.test(f.name) && typeof f.text === 'string'), 'PLUGIN', 'Invalid candidate artifact contract');
    return { ...result, manifest: { ...result.manifest, plugin: { id: plugin.id, apiVersion: plugin.apiVersion }, repositoryWritten: false } };
  }
  async preview(doc, options = {}, context = {}) {
    const plugin = this.get(this.documentId(doc));
    requireArt(!doc.provenance.plugin || doc.provenance.plugin.apiVersion === plugin.apiVersion, 'PLUGIN', 'Asset plugin version mismatch');
    requireArt(typeof plugin.previewAsset === 'function', 'MISSING_ADAPTER', `${plugin.label} does not define a production-context preview`);
    const clean = validateOptions(plugin.previewOptionsSchema, options, 'preview');
    validate(doc);
    await plugin.validateAsset(doc);
    const descriptor = await plugin.previewAsset(doc, clean, context);
    requireArt(descriptor && typeof descriptor === 'object' && typeof descriptor.kind === 'string' && typeof descriptor.frameId === 'string', 'PLUGIN', 'Invalid production preview descriptor');
    return { ...descriptor, plugin: { id: plugin.id, apiVersion: plugin.apiVersion } };
  }
}

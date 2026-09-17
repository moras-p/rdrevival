const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false
});

function resolveModelContext(explicit) {
  if (explicit) return explicit;
  const documentContext = globalThis.document?.modelContext;
  if (documentContext && typeof documentContext.registerTool === 'function') return documentContext;
  const navigatorContext = globalThis.navigator?.modelContext;
  return navigatorContext && typeof navigatorContext.registerTool === 'function' ? navigatorContext : null;
}

function qualifiedToolName(namespace, name) {
  const prefix = String(namespace || '').trim();
  const suffix = String(name || '').trim();
  if (!prefix || !suffix) throw new Error('WebMCP tools require a namespace and name');
  return `${prefix}.${suffix}`;
}

/**
 * Register a page's existing application actions as WebMCP tools.
 * Browsers without WebMCP remain completely unaffected.
 */
export async function installWebMcpTools({ namespace, tools, modelContext = null, logger = globalThis.console, beforeExecute = null } = {}) {
  const context = resolveModelContext(modelContext);
  if (!context) {
    logger?.info?.('[RDR/WebMCP] Site-tools API unavailable; checked document.modelContext and navigator.modelContext.');
    return Object.freeze({ supported: false, registered: Object.freeze([]), dispose() {} });
  }
  if (!Array.isArray(tools) || !tools.length) throw new Error('WebMCP installation requires at least one tool');

  const controller = new AbortController();
  const registered = [];
  try {
    for (const tool of tools) {
      const name = qualifiedToolName(namespace, tool.name);
      const definition = {
        name,
        title: tool.title || name,
        description: String(tool.description || ''),
        inputSchema: tool.inputSchema || EMPTY_OBJECT_SCHEMA,
        execute: async input => {
          const release = beforeExecute?.(tool);
          try { return await tool.execute(input || {}); }
          finally { if (typeof release === 'function') release(); }
        }
      };
      if (tool.readOnly) definition.annotations = { readOnlyHint: true };
      await context.registerTool(definition, { signal: controller.signal });
      registered.push(name);
    }
  } catch (error) {
    controller.abort();
    logger?.warn?.('[RDR/WebMCP] Tool registration failed; page functionality remains available without WebMCP.', error);
    return Object.freeze({ supported: true, registered: Object.freeze([]), error, dispose() {} });
  }

  const handle = {
    supported: true,
    registered: Object.freeze(registered.slice()),
    dispose() { controller.abort(); }
  };
  globalThis.addEventListener?.('pagehide', () => handle.dispose(), { once: true });
  logger?.info?.(`[RDR/WebMCP] Registered ${registered.length} tools: ${registered.join(', ')}`);
  return Object.freeze(handle);
}

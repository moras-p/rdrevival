export async function loadJsonResponse(path, fetchOptions = undefined) {
  const response = await fetch(path, fetchOptions);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    const detail = error?.message || String(error);
    throw new SyntaxError(`Invalid JSON in ${path}: ${detail}`, { cause: error });
  }
}

export async function loadJsonFallback(path, fallback, { fetchOptions = undefined, onError = null } = {}) {
  try {
    return await loadJsonResponse(path, fetchOptions);
  } catch (error) {
    onError?.(error, path);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

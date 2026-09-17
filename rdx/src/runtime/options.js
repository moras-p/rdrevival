import { RUNTIME_OPTIONS, RUNTIME_OPTION_BY_KEY } from '../../generated/runtime-options.js';

const browserOptions = RUNTIME_OPTIONS.filter(option => option.surfaces.includes('browser'));
const defaultKey = option => option.values.find(value => value.value === option.default)?.key ?? option.values[0].key;

export function normalizeRuntimeOptionValues(input = {}) {
  return Object.freeze(Object.fromEntries(browserOptions.map(option => {
    const requested = input[option.key];
    const value = option.values.find(row => row.key === String(requested) || row.value === Number(requested));
    return [option.key, value?.key ?? defaultKey(option)];
  })));
}

export function bindRuntimeOptions({ root = document, bridge = null, onChange = null } = {}) {
  const controls = new Map();
  const values = { ...normalizeRuntimeOptionValues() };
  const container = root?.getElementById?.('rdx-runtime-options') || null;

  for (const option of browserOptions) {
    let select = root?.getElementById?.(option.browserControlId) || null;
    if (!select && container && root?.createElement) {
      const label = root.createElement('label');
      label.className = 'collision-policy';
      label.append(`${option.label} `);
      select = root.createElement('select');
      select.id = option.browserControlId;
      label.append(select);
      container.append(label);
    }
    if (!select) continue;
    if (typeof select.replaceChildren === 'function') {
      const rows = option.values.map(value => {
        const row = root.createElement('option');
        row.value = value.key;
        row.textContent = value.label;
        return row;
      });
      select.replaceChildren(...rows);
    }
    select.value = values[option.key];
    select.addEventListener?.('change', () => apply(option.key, select.value, { notify: true }));
    controls.set(option.key, select);
  }

  function apply(key, requested, { notify = false } = {}) {
    const option = RUNTIME_OPTION_BY_KEY[key];
    if (!option || !option.surfaces.includes('browser')) throw new RangeError(`Unknown browser runtime option '${key}'`);
    const candidate = option.values.find(row => row.key === String(requested) || row.value === Number(requested));
    const wanted = candidate?.key ?? defaultKey(option);
    const applied = bridge ? bridge.setRuntimeOption(key, wanted) : wanted;
    values[key] = applied;
    const control = controls.get(key);
    if (control) control.value = applied;
    if (notify) onChange?.({ option, value: option.values.find(row => row.key === applied) });
    return applied;
  }

  function applyAll() {
    for (const option of browserOptions) apply(option.key, values[option.key]);
    return snapshot();
  }

  function attachBridge(nextBridge, { applyCurrent = true } = {}) {
    bridge = nextBridge || null;
    return applyCurrent ? applyAll() : snapshot();
  }

  function setValues(nextValues, { applyToBridge = true } = {}) {
    const normalized = normalizeRuntimeOptionValues({ ...values, ...nextValues });
    for (const option of browserOptions) {
      if (applyToBridge) apply(option.key, normalized[option.key]);
      else {
        values[option.key] = normalized[option.key];
        const control = controls.get(option.key);
        if (control) control.value = normalized[option.key];
      }
    }
    return snapshot();
  }

  function syncFromBridge() {
    if (!bridge) return snapshot();
    for (const option of browserOptions) {
      values[option.key] = bridge.runtimeOption(option.key);
      const control = controls.get(option.key);
      if (control) control.value = values[option.key];
    }
    return snapshot();
  }

  function snapshot() { return Object.freeze({ ...values }); }

  return Object.freeze({ apply, applyAll, attachBridge, control: key => controls.get(key) || null, setValues, snapshot, syncFromBridge });
}

export { browserOptions as BROWSER_RUNTIME_OPTIONS };

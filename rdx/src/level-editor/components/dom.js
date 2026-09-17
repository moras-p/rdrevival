export function clear(node) { while (node.firstChild) node.firstChild.remove(); return node; }
export function element(tag, { className = '', text = '', attrs = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'disabled') node.disabled = !!value;
    else node.setAttribute(key, String(value));
  }
  return node;
}
export function detailsList(rows) {
  const dl = element('dl');
  for (const [key, value] of rows) {
    dl.append(element('dt', { text:key }));
    const display = Array.isArray(value) ? value.join(', ') : value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    dl.append(element('dd', { text:display }));
  }
  return dl;
}
export function section(title, child, className = '') {
  const wrapper = element('section', { className:`inspector-section ${className}`.trim() });
  wrapper.append(element('h3', { text:title }));
  if (child) wrapper.append(child);
  return wrapper;
}

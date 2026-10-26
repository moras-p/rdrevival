/* In-page dialogs (never the browser's alert/confirm/prompt): a small
 * promise API over one <dialog> element styled with the Studio. */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let dialogEl = null;
function host() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement('dialog');
  dialogEl.className = 'st-dialog';
  document.body.append(dialogEl);
  return dialogEl;
}

/* fields: [{ name, label, value, multiline, placeholder }]; actions:
 * [{ label, value, primary, danger }]. Resolves { action, values } or
 * null when dismissed (Escape or the close button). */
export function openDialog({ title, message = '', fields = [], actions = [{ label: 'OK', value: 'ok', primary: true }] }) {
  const d = host();
  d.innerHTML = `<form method="dialog" class="st-dialog-form">
    <header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
    ${message ? `<p class="st-dialog-msg">${esc(message)}</p>` : ''}
    ${fields.map(f => `<label class="st-dialog-field"><span>${esc(f.label)}</span>${f.multiline
      ? `<textarea name="${esc(f.name)}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
      : `<input name="${esc(f.name)}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}
    <footer>${actions.map(a => `<button type="submit" value="${esc(a.value)}" class="${a.primary ? 'primary' : ''}${a.danger ? ' danger' : ''}">${esc(a.label)}</button>`).join('')}</footer>
  </form>`;
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (done) return; done = true; d.close(); resolve(result); };
    d.querySelector('[data-close]').addEventListener('click', () => finish(null));
    d.oncancel = e => { e.preventDefault(); finish(null); };
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target).entries());
      finish({ action: e.submitter?.value || actions.find(a => a.primary)?.value || 'ok', values });
    });
    d.showModal();
    (d.querySelector('input, textarea') || d.querySelector('button.primary'))?.focus();
    d.querySelector('input')?.select();
  });
}

export async function confirmDialog(title, message, { confirm = 'Continue', danger = false } = {}) {
  const r = await openDialog({ title, message, actions: [{ label: 'Cancel', value: 'cancel' }, { label: confirm, value: 'ok', primary: true, danger }] });
  return r?.action === 'ok';
}

/* Non-blocking notice in the corner (errors, confirmations). */
export function toast(text, { kind = 'info', ms = 4000 } = {}) {
  let box = document.querySelector('.st-toasts');
  if (!box) { box = document.createElement('div'); box.className = 'st-toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `st-toast ${kind}`; el.textContent = text;
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

/* Hover and focus descriptions for any element with data-tip. One floating
 * element, positioned in the viewport so panels never clip it. */
export function installTooltips(root = document) {
  const tip = document.createElement('div');
  tip.className = 'st-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.append(tip);
  let current = null, timer = 0;
  const show = el => {
    current = el;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      const below = r.bottom + 8 + t.height < innerHeight;
      tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`;
      tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    }, 350);
  };
  const hide = () => { current = null; clearTimeout(timer); tip.hidden = true; };
  root.addEventListener('pointerover', e => { const el = e.target.closest?.('[data-tip]'); if (el && el !== current) show(el); else if (!el) hide(); });
  root.addEventListener('pointerout', e => { if (!e.relatedTarget) hide(); });
  root.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches(':focus-visible')) show(el); });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  return tip;
}

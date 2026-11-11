/** DOM helpers. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const byId = (id) => document.getElementById(id);
export function setText(id, v) { const e = byId(id); if (e) e.textContent = v; }
export const isMobile = () => window.innerWidth <= 1080;

/** Trigger a browser download of text content. */
export function downloadText(text, filename, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch { /* ignore */ } URL.revokeObjectURL(url); }, 1500);
}

/** Debounced "saved" flash used by plan text boxes. */
export function flashSaved(el, timerRef, after) {
  if (!el) return;
  el.classList.add('on');
  clearTimeout(timerRef.t);
  timerRef.t = setTimeout(() => { el.classList.remove('on'); if (after) after(); }, 1100);
}

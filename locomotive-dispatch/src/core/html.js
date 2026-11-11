/** Minimal HTML escaping for text interpolated into template strings. */
export function esc(s) {
  return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
/** Attribute-safe escaping (adds quotes). */
export function escAttr(s) {
  return esc(String(s ?? '')).replace(/"/g, '&quot;');
}

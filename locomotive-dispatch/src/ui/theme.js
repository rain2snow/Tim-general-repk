/**
 * Light / dark theme. Dark is the default; the choice is remembered in this browser.
 * index.html applies the saved theme before first paint (no flash); this module wires the
 * header toggle and keeps the basemap in step.
 */
import { byId } from './dom.js';
import { setMapTheme } from './map/mapView.js';

export const THEME_KEY = 'cn-dispatch.theme';

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: still switches for this visit */ }
  setMapTheme(t);
  const b = byId('themetog');
  if (b) {
    const next = t === 'light' ? 'dark' : 'light';
    b.title = `Switch to ${next} mode`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(t === 'light'));
  }
}

export function initThemeToggle() {
  const b = byId('themetog');
  if (!b) return;
  b.addEventListener('click', () => setTheme(currentTheme() === 'light' ? 'dark' : 'light'));
  setTheme(currentTheme());
}

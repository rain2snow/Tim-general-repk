/** Day-of-week demand basis control. */
import { DAY_NAMES } from '../../core/constants.js';
import { applyDemandDay } from '../../core/demand.js';
import { $$, byId, setText } from '../dom.js';
import { app } from '../state.js';

/** @param rerender called after the stations are recomputed for the chosen day */
export function initDemandToggle(rerender) {
  const tog = byId('dowToggle'), days = byId('dowDays');
  if (!tog || !days) return;
  tog.addEventListener('click', () => {
    const on = !tog.classList.contains('on');
    tog.classList.toggle('on', on);
    days.style.display = on ? 'flex' : 'none';
    setDemandDay(on ? new Date().getDay() : null, rerender);
  });
  $$('button', days).forEach((b) => b.addEventListener('click', () => setDemandDay(+b.dataset.d, rerender)));
}

export function setDemandDay(day, rerender) {
  app.dow = day;
  applyDemandDay(app.data && app.data.stations, day);
  setText('dow-state', day == null ? 'peak' : DAY_NAMES[day].slice(0, 3));
  setText('dowHint', day == null
    ? 'Showing peak (all-days) requirement.'
    : DAY_NAMES[day] + ' demand · lighter days need fewer units; the busiest day equals the standard plan.');
  $$('#dowDays button').forEach((b) => b.classList.toggle('on', +b.dataset.d === day));
  if (rerender) rerender();
}

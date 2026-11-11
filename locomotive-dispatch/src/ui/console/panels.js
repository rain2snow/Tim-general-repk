/** Collapsible side panels + mobile Board/Map/Actions tabs. */
import { $, $$, byId } from '../dom.js';
import { invalidateMapSize } from '../map/mapView.js';

export function initPanels() {
  const sh = $('.shell');
  const bind = (id, cls) => {
    const b = byId(id);
    if (b) b.addEventListener('click', () => { sh.classList.toggle(cls); invalidateMapSize(230); });
  };
  bind('lcollapse', 'lcol'); bind('rcollapse', 'rcol');
  bind('reopen-left', 'lcol'); bind('reopen-right', 'rcol');

  $$('.mtab button').forEach((b) => b.addEventListener('click', () => {
    $$('.mtab button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const t = b.dataset.tab;
    byId('left').classList.toggle('show', t === 'left');
    byId('right').classList.toggle('show', t === 'right');
    if (t === 'map') invalidateMapSize(100);
  }));
}

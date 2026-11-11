/** Map-layer toggles in the left panel. */
import { $, $$ } from '../dom.js';
import { setLayerVisible } from '../map/mapView.js';

export function initLayerToggles() {
  $$('.toggle').forEach((t) => t.addEventListener('click', () => {
    t.classList.toggle('on');
    setLayerVisible(t.dataset.layer, t.classList.contains('on'));
  }));
}

/** Make sure a layer is visible (used before flying to one of its markers). */
export function ensureLayerShown(name) {
  const tog = $('.toggle[data-layer="' + name + '"]');
  if (tog && !tog.classList.contains('on')) tog.click();
}

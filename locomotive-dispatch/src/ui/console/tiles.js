/** Network-status tiles: show + zoom to a layer and filter the queue. */
import { $$ } from '../dom.js';
import { flyToBoundsOf } from '../map/mapView.js';
import { ensureLayerShown } from './layerToggles.js';
import { setQueueFilter } from './actionQueue.js';

export function initTiles() {
  $$('.tile').forEach((t) => t.addEventListener('click', () => {
    const name = t.dataset.layer;
    ensureLayerShown(name);
    setQueueFilter(name === 'dead' ? 'route' : name === 'inspection' ? 'swap' : 'all');
    flyToBoundsOf(name);
  }));
}

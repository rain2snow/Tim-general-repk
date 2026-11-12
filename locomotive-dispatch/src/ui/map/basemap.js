/**
 * Basemap with probe-before-attach.
 *  - Each keyless source is probed with ONE tile request before a layer is attached, so a
 *    blocked/offline network costs at most one failed request per source.
 *  - The probe checks HTTP status (fetch) so 401/403 "message tiles" are rejected; if fetch is
 *    blocked by CORS/proxy it falls back to an <img> load test.
 *  - If every source fails, no tile layer is attached: markers, routes and panels still work.
 *  - Runtime watchdog: 8 consecutive tile errors with no success detaches the layer.
 * window.setBasemap(n) forces a source (0..2); window.__basemap reports the active one.
 */
import L from 'leaflet';

export const BASEMAPS = [
  { name: 'Esri Dark Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    probe: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/2/2',
    opts: { attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 19, maxNativeZoom: 16 } },
  { name: 'Esri Light Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    probe: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/3/2/2',
    opts: { attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 19, maxNativeZoom: 16 } },
  { name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    probe: 'https://tile.openstreetmap.org/3/2/2.png',
    opts: { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 } },
];
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PROBE_TIMEOUT_MS = 6000;
const MAX_CONSECUTIVE_ERRORS = 8;

function probeTile(url) {
  const viaImg = () => new Promise((res) => {
    const img = new Image();
    let done = false;
    const fin = (ok) => { if (done) return; done = true; img.onload = img.onerror = null; res(ok); };
    img.onload = () => fin(img.naturalWidth > 0);
    img.onerror = () => fin(false);
    setTimeout(() => fin(false), PROBE_TIMEOUT_MS);
    img.src = url;
  });
  if (typeof fetch !== 'function') return viaImg();
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => { if (ctl) ctl.abort(); }, PROBE_TIMEOUT_MS);
  return fetch(url, { mode: 'cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    .then((r) => {
      clearTimeout(t);
      if (!r.ok) return false; // 401/403/404 message tiles rejected
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      return ct === '' || ct.indexOf('image') === 0;
    })
    .catch((e) => {
      clearTimeout(t);
      if (e && e.name === 'AbortError') return false; // timed out - don't retry
      return viaImg(); // CORS/proxy blocked fetch - try <img>
    });
}

export function installBasemap(map) {
  let baseLayer = null, baseToken = 0;
  window.__basemap = 'probing';

  // Never call a bare layer.off(): Leaflet 1.9.4 unhooks a layer's map listeners via the layer's
  // own 'remove' handler; wiping it leaves an orphaned zoom handler that throws on every zoom.
  // Removal is also deferred out of any in-flight zoom animation.
  const safeRemoveLayer = (lyr) => {
    if (!lyr) return;
    const go = () => { try { if (map.hasLayer(lyr)) map.removeLayer(lyr); } catch { /* ignore */ } };
    if (map._animatingZoom) map.once('zoomend', () => setTimeout(go, 0)); else go();
  };
  const neuterLayer = (lyr) => { try { lyr.setUrl(BLANK_TILE, true); lyr.setOpacity(0); } catch { /* ignore */ } };
  const detach = () => { if (baseLayer) { const l = baseLayer; baseLayer = null; neuterLayer(l); safeRemoveLayer(l); } };

  function attach(i) {
    detach();
    const b = BASEMAPS[i], token = ++baseToken;
    const lyr = L.tileLayer(b.url, { errorTileUrl: BLANK_TILE, ...b.opts });
    let consecErr = 0, dying = false;
    // Leaflet fires 'tileload' for the blank error tile too - only a real tile counts.
    lyr.on('tileload', (e) => { if (!e || !e.tile || e.tile.src !== BLANK_TILE) consecErr = 0; });
    lyr.on('tileerror', () => {
      if (dying || token !== baseToken) return;
      if (++consecErr >= MAX_CONSECUTIVE_ERRORS) {
        dying = true;
        console.warn('[basemap] ' + b.name + ' stopped responding - tiles disabled (markers unaffected)');
        neuterLayer(lyr);
        setTimeout(() => { if (baseLayer === lyr) { baseLayer = null; safeRemoveLayer(lyr); window.__basemap = 'none'; } }, 0);
      }
    });
    lyr.addTo(map);
    if (lyr.bringToBack) lyr.bringToBack();
    baseLayer = lyr; window.__basemap = b.name;
  }

  // light theme prefers the light Esri canvas, dark the dark one
  const order = (theme) => (theme === 'light' ? [1, 0, 2] : [0, 1, 2]);
  let current = -1;

  async function init(theme) {
    const token = ++baseToken;
    for (const i of order(theme)) {
      const ok = await probeTile(BASEMAPS[i].probe);
      if (token !== baseToken) return; // user forced a source meanwhile
      if (ok) { attach(i); current = i; return; }
    }
    window.__basemap = 'none';
    console.info('[basemap] no tile source reachable - running without background map (all data layers active)');
  }

  window.setBasemap = (i) => {
    i = +i;
    if (!(i >= 0 && i < BASEMAPS.length)) { detach(); baseToken++; window.__basemap = 'none'; current = -1; return 'none'; }
    attach(i); current = i;
    return BASEMAPS[i].name;
  };
  init(document.documentElement.dataset.theme);

  return {
    /** Swap Esri dark <-> light canvas to match the theme (only when one of them is showing). */
    matchTheme(theme) {
      const want = theme === 'light' ? 1 : 0;
      if ((current === 0 || current === 1) && current !== want) window.setBasemap(want);
    },
  };
}

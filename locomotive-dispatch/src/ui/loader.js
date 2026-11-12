/** "Update snapshot" overlay: drop/browse an STP_Locomotives.csv and re-analyse in the browser. */
import { parseCSV } from '../core/csv.js';
import { isStpExport } from '../core/analyze.js';
import { byId } from './dom.js';

/**
 * @param onRows called with the parsed STP rows; the app analyses them against the active
 *               (possibly edited) captive plan. Throwing reports the error in the overlay.
 */
export function initLoader(onRows) {
  const overlay = byId('loader'), fileIn = byId('stpfile'), statusEl = byId('loadstatus'), dz = byId('drop');

  function handle(file) {
    if (!file) return;
    statusEl.textContent = 'Reading ' + file.name + ' …';
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const rows = parseCSV(rd.result);
        if (!isStpExport(rows)) { statusEl.textContent = 'That doesn’t look like an STP export (no ‘Loco ID’ column).'; return; }
        overlay.classList.add('hidden');
        setTimeout(() => {
          try { onRows(rows); } catch (err) { overlay.classList.remove('hidden'); statusEl.textContent = 'Error: ' + err.message; console.error(err); }
        }, 60);
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        console.error(err);
      }
    };
    rd.onerror = () => { statusEl.textContent = 'Could not read that file.'; };
    rd.readAsText(file);
  }

  fileIn.addEventListener('change', (e) => handle(e.target.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'dragend'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  byId('reloadbtn').addEventListener('click', () => { overlay.classList.remove('hidden'); statusEl.textContent = ''; fileIn.value = ''; });
  byId('loadcancel').addEventListener('click', () => overlay.classList.add('hidden'));

  return {
    fail(message) { overlay.classList.remove('hidden'); statusEl.textContent = message; },
  };
}

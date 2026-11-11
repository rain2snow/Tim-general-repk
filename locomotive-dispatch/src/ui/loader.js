/** "Update snapshot" overlay: drop/browse an STP_Locomotives.csv and re-analyse in the browser. */
import { parseCSV } from '../core/csv.js';
import { analyze, isStpExport } from '../core/analyze.js';
import { byId } from './dom.js';

/**
 * @param reference { plan, base2home, multiHome, lcs } built-in reference data
 * @param onData    called with the freshly analysed snapshot
 */
export function initLoader(reference, onData) {
  const overlay = byId('loader'), fileIn = byId('stpfile'), statusEl = byId('loadstatus'), dz = byId('drop');

  function handle(file) {
    if (!file) return;
    statusEl.textContent = 'Reading ' + file.name + ' …';
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const rows = parseCSV(rd.result);
        if (!isStpExport(rows)) { statusEl.textContent = 'That doesn’t look like an STP export (no ‘Loco ID’ column).'; return; }
        const data = analyze(rows, reference.plan, reference.base2home, { multiHome: reference.multiHome, lcs: reference.lcs });
        overlay.classList.add('hidden');
        setTimeout(() => onData(data), 60);
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

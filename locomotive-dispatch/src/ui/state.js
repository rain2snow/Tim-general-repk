/** Application state shared by the UI modules, plus a tiny event bus. */
import { createActionStore } from '../core/store.js';

export const app = {
  /** Current analysed snapshot ({stations, dead, deadhead, shops, meta, fleet}). */
  data: null,
  /** loco id -> fleet record */
  locoIndex: {},
  /** station key -> station */
  stationsByKey: {},
  /** current re-task candidates */
  retask: [],
  /** hub-and-line-point config (data/hubs.json) and the derived model (tactical + strategic) */
  hubs: null,
  hubModel: null,
  /** day-of-week demand (0-6) or null for peak */
  dow: null,
  /** dashboard needs a rebuild on next open */
  dashStale: true,
  /** dispatcher plans */
  store: createActionStore(),
};

const listeners = {};
/** Events: 'data' (snapshot re-rendered), 'plans' (a plan/resolved flag changed). */
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
export function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }

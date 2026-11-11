/** Shared domain constants for the dispatch console. */

/** Marker / status palette (mirrors the CSS custom properties in styles/tokens.css). */
export const COLORS = Object.freeze({
  red: '#e1251b',
  amber: '#f6a623',
  green: '#36c98a',
  cyan: '#5bb8d4',
  dead: '#ff7a3d',
  even: '#8b929e',
  violet: '#8b8ad6',
  inbound: '#7ec8ff',
});

/** STP exports use QC; the captive plan keys Quebec as PQ. */
export const STATE_FIX = Object.freeze({ QC: 'PQ' });
/** Display-side reverse mapping (plan key PQ -> shown as QC). */
export const STATE_DISPLAY = Object.freeze({ PQ: 'QC' });
export const displayState = (st) => STATE_DISPLAY[st] || st;

/** OpCodes that mark an idle unit as spare power. */
export const SPARE_OPS = new Set(['SS', 'LO', 'LB', 'LH', 'DH']);
/** Booster / slug models — never counted as on-hand power. */
export const SLUG_MODELS = new Set(['YBU', 'HBU', 'HBU-RM']);
/** Heavy bad-order OpCodes. */
export const HBO_OPS = ['LA', 'LB', 'LO', 'LV'];
/** Dead-in-transit OpCodes (plus Designation === 'DIT'). */
export const DEAD_OPS = new Set(['LD', 'DM']);

/** Plan regions, in display order. */
export const REGION_ORDER = ['East', 'West', 'South'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Inspection window: units due within this many days are flagged. */
export const INSPECTION_WINDOW_DAYS = 3;
/** HP threshold separating low/mid HP from HHP (informational; STP 'Loco Type' carries the class). */
export const HHP_THRESHOLD = 4000;

/**
 * Model -> counted-type family.
 *
 * Two classifiers exist on purpose (kept from the original tool):
 *  - planFamily: used by the analysis engine for plan matching/train fill.
 *    SD38 resolves to 'SD38', GP40-3 is grouped with SD40, and slugs/CALF map to 'CALF'.
 *  - actionFamily: used by the action planners (donors, re-task); a stricter prefix match.
 */
export function planFamily(model) {
  model = (model || '').toUpperCase();
  if (/^SD60/.test(model)) return 'SD60';
  if (/^SD40|^SD38|^GP40-3/.test(model)) return model.indexOf('SD38') === 0 ? 'SD38' : 'SD40';
  if (/^GP40/.test(model)) return 'GP40';
  if (/^GP9|^GP38/.test(model)) return 'GP9/GP38';
  if (/^CALF|^HBU|^YBU/.test(model)) return 'CALF';
  return null;
}

export function actionFamily(model) {
  const m = (model || '').toUpperCase();
  if (/^SD60/.test(m)) return 'SD60';
  if (/^SD40/.test(m)) return 'SD40';
  if (/^SD38/.test(m)) return 'SD38';
  if (/^GP40/.test(m)) return 'GP40';
  if (/^GP9|^GP38/.test(m)) return 'GP9/GP38';
  if (/^CALF/.test(m)) return 'CALF';
  return null;
}

/** Strip the LCS suffix so "SD60 LCS" matches "SD60". */
export const typeBase = (t) => (t || '').replace(/ LCS$/, '');

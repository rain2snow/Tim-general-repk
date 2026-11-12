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

/**
 * Approximate rated horsepower by model (for consist summaries — indicative, not a spec).
 * Slugs (YBU / HBU) have no prime mover: 0 hp.
 */
const HP_BY_MODEL = [
  [/^(YBU|HBU|CALF)/, 0], [/^SW1200/, 1200], [/^GP9/, 1750], [/^GP15/, 1500], [/^GP20/, 2000], [/^GP38/, 2000],
  [/^GP39/, 2300], [/^GP40/, 3000], [/^F40/, 3000], [/^SD38/, 2000], [/^SD40/, 3000], [/^SD45/, 3600], [/^SD50/, 3500],
  [/^SD60/, 3800], [/^SD70/, 4300], [/^SD75/, 4300], [/^C40/, 4000], [/^C44/, 4400], [/^AC44/, 4400],
  [/^ES44/, 4400], [/^ET44/, 4400], [/^Q19/, 1900],
];
export function approxHp(model) {
  const m = String(model || '').toUpperCase();
  const hit = HP_BY_MODEL.find(([re]) => re.test(m));
  return hit ? hit[1] : null;
}

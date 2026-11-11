/** Off-plan train assignments: low/mid-HP units on trains outside the plan, or of the wrong class. */

const OP_ORDER = { LN: 0, DH: 1, LD: 2, DM: 2, LL: 3, LT: 3, LA: 4, LB: 4, LO: 4, LV: 4, LS: 5, SS: 6, SM: 6 };
const famBase = (f) => String(f || 'Other').replace(/ LCS$/, '');

export function computeOffplan(data) {
  const reqFam = {}, name = {}, hasReq = {};
  data.stations.forEach((st) => {
    name[st.k] = st.station + ', ' + st.state;
    const fams = (st.req_detail || []).map((x) => String(x[0]).replace(/ LCS$/, ''));
    reqFam[st.k] = fams; hasReq[st.k] = fams.length > 0;
  });
  const notInPlan = [], wrongClass = [];
  (data.fleet || []).forEach((f) => {
    if (f.hhp) return;
    if (!(f.train || '').trim()) return;
    if (!f.home) { notInPlan.push(f); return; }
    if (!hasReq[f.home]) return; // plan job with no model-class spec: not off-plan
    if (!reqFam[f.home].includes(famBase(f.fam))) wrongClass.push(f);
  });
  const srt = (a, b) => (OP_ORDER[a.op] ?? 9) - (OP_ORDER[b.op] ?? 9) || String(a.loco).localeCompare(String(b.loco));
  notInPlan.sort(srt); wrongClass.sort(srt);
  return { notInPlan, wrongClass, stationName: name, reqFam };
}

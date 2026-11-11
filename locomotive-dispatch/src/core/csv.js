/** CSV parsing / serialisation helpers. */

/** Parse CSV text (quoted fields, escaped quotes, CRLF, BOM) into an array of header-keyed objects. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const hdr = rows[0], out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const o = {};
    for (let j = 0; j < hdr.length; j++) o[hdr[j]] = rows[r][j] !== undefined ? rows[r][j] : '';
    out.push(o);
  }
  return out;
}

/** Quote a cell only when needed (dashboard export style). */
export function csvCellMinimal(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
/** Always quote a cell (actions export style). */
export function csvCellQuoted(v) {
  v = v == null ? '' : String(v);
  return '"' + v.replace(/"/g, '""') + '"';
}

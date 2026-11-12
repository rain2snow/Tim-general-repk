#!/usr/bin/env python3
"""
Build data/cn-network.json from CN's "Weight Limitations System Map" (vector PDF).

    pip install pymupdf scipy numpy
    python3 scripts/network/build_cn_network.py \
        reference/cn-weight-limitations-system-map-2016-07.pdf data/static-plan.json \
        scripts/network/corridors.json data/cn-network.json

Pipeline
 1. Extract rail strokes (0.96 pt) and their legend colour = max gross weight class.
 2. Rotate to display orientation; drop zoom-inset circles, the legend and label leaders;
    separate the 3 pt station symbols from the line work.
 3. Georeference: page = TPS( cubic( Affine( LCC_n(lat, lng) ) ) )
      - Lambert conformal conic + affine, fitted by ICP (plan stations -> nearest drawn line)
      - smooth cubic correction for the map's non-conic drafting distortion
      - thin-plate-spline warp on station->line matches + 4 anchors in sparse areas
    Accuracy is reported on well-surveyed city positions that are not used in the fit.
 3b. Zoom insets: fit each as a similarity of the main projection; use it only if both the
    station fit and the edge continuity with the main map pass (most insets are schematic).
 4. Invert (Newton), chain fragments into continuous lines, simplify (Douglas-Peucker).
 5. Name each line after the curated corridor it follows (corridors.json); unmatched lines
    keep a generic name.
"""
import json, math, sys
from collections import defaultdict
import numpy as np
import pymupdf as fitz
from scipy.interpolate import RBFInterpolator
from scipy.optimize import least_squares
from scipy.spatial import cKDTree

PDF, PLAN, CORRIDORS, OUT = sys.argv[1:5]

# ---------------------------------------------------------------- 1. extract
CAPACITY = {  # legend: stroke colour -> class
    (0.0, 0.72, 0.18): '286k', (1.0, 0.0, 1.0): '272k', (0.43, 0.76, 0.87): '268k',
    (0.0, 0.0, 1.0): '263k', (1.0, 0.0, 0.0): 'lt263k', (0.0, 0.0, 0.0): 'rights',
}
page = fitz.open(PDF)[0]
M = page.rotation_matrix
rot = lambda x, y: (lambda q: (q.x, q.y))(fitz.Point(x, y) * M)
rc = lambda c: tuple(round(v, 2) for v in (c or ()))

def sample(it):
    if it[0] == 'l':
        return [(it[1].x, it[1].y), (it[2].x, it[2].y)]
    if it[0] == 'c':
        p0, p1, p2, p3 = it[1:5]
        return [((1-t)**3*p0.x + 3*(1-t)**2*t*p1.x + 3*(1-t)*t**2*p2.x + t**3*p3.x,
                 (1-t)**3*p0.y + 3*(1-t)**2*t*p1.y + 3*(1-t)*t**2*p2.y + t**3*p3.y) for t in [i / 8 for i in range(9)]]
    return []

raw, circles = [], []
for g in page.get_drawings():
    r = g['rect']
    if g['type'] in ('s', 'fs') and r.width > 100 and abs(r.width - r.height) < 6 and all(i[0] == 'c' for i in g['items']):
        (ax, ay), (bx, by) = rot(r.x0, r.y0), rot(r.x1, r.y1)
        circles.append(((ax + bx) / 2, (ay + by) / 2, abs(ax - bx) / 2))
        continue
    cls = CAPACITY.get(rc(g.get('color')))
    if g['type'] != 's' or round(g.get('width') or 0, 2) != 0.96 or not cls:
        continue
    run = []
    for it in g['items']:
        pts = [rot(*p) for p in sample(it)]
        if not pts:
            continue
        if run and math.dist(run[-1], pts[0]) > 0.02:
            raw.append((cls, run)); run = []
        run.extend(pts if not run else pts[1:])
    if len(run) > 1:
        raw.append((cls, run))

# ---------------------------------------------------------------- 2. clean
circles.append((2093, 894, 140))                 # SW Ontario & Detroit inset (drawn without a closed outline)
LEGEND = (2180, 1380, 2450, 1520)
def masked(p):
    if LEGEND[0] < p[0] < LEGEND[2] and LEGEND[1] < p[1] < LEGEND[3]:
        return True
    return any((p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= (cr + 3) ** 2 for cx, cy, cr in circles)

lines, glyphs = [], []
for cls, pts in raw:
    if 660 < pts[0][0] < 690 and 225 < pts[0][1] < 245:   # Great Slave Lake label leader
        continue
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    if math.dist(pts[0], pts[-1]) < 0.6 and max(xs) - min(xs) < 8 and max(ys) - min(ys) < 8 and len(pts) > 6:
        if not masked(pts[0]):
            glyphs.append(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2))
        continue
    run = []
    for p in pts:
        if masked(p):
            if len(run) > 1: lines.append((cls, run))
            run = []
        else:
            run.append(p)
    if len(run) > 1:
        lines.append((cls, run))
V = np.array([p for _, pts in lines for p in pts]); G = np.array(glyphs)

# line work drawn inside each zoom inset (kept separately; georeferenced in stage 3b)
inset_runs = defaultdict(list)
for cls, pts in raw:
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    if math.dist(pts[0], pts[-1]) < 0.6 and max(xs) - min(xs) < 8 and max(ys) - min(ys) < 8 and len(pts) > 6:
        continue                                         # station symbol
    for ci, (cx, cy, cr) in enumerate(circles):
        run = []
        for p in pts:
            if math.dist(p, (cx, cy)) < cr - 2:
                run.append(p)
            else:
                if len(run) > 1: inset_runs[ci].append((cls, run))
                run = []
        if len(run) > 1:
            inset_runs[ci].append((cls, run))
vtree, gtree = cKDTree(V), cKDTree(G)
print(f'extracted {len(lines)} line runs ({len(V)} vertices), {len(G)} station symbols, {len(circles)} insets masked')

# ---------------------------------------------------------------- 3. georeference
LAM0 = math.radians(-96.0)
def lcc(lat, lng, n):
    phi, lam = np.radians(lat), np.radians(lng)
    rho = np.tan(np.pi / 4 + phi / 2) ** (-n); th = n * (lam - LAM0)
    return np.stack([rho * np.sin(th), -rho * np.cos(th)], -1)
def affine(p, lat, lng):
    n, a, b, c, d, e, f = p; q = lcc(lat, lng, n)
    return np.stack([a * q[:, 0] + b * q[:, 1] + c, d * q[:, 0] + e * q[:, 1] + f], -1)
def affine_inv(p, xy):
    n, a, b, c, d, e, f = p
    q = np.linalg.solve(np.array([[a, b], [d, e]]), (xy - [c, f]).T).T
    rho = np.sign(n) * np.hypot(q[:, 0], q[:, 1]); th = np.arctan2(q[:, 0], -q[:, 1])
    return np.degrees(2 * np.arctan(rho ** (-1 / n)) - np.pi / 2), np.degrees(LAM0 + th / n)

plan = json.load(open(PLAN))
st = [s for s in plan['plan'] if s.get('lat') is not None]
slat, slng = np.array([s['lat'] for s in st]), np.array([s['lng'] for s in st])

seeds = np.array([[54.31, -130.32], [60.82, -115.8], [44.65, -63.57], [29.96, -90.1]])   # W, N, E, S extremes
sxy = np.array([V[V[:, 0].argmin()], V[V[:, 1].argmin()], V[V[:, 0].argmax()], V[V[:, 1].argmax()]])
A = np.c_[lcc(seeds[:, 0], seeds[:, 1], 0.65), np.ones(4)]
p = np.array([0.65, *np.linalg.lstsq(A, sxy[:, 0], rcond=None)[0], *np.linalg.lstsq(A, sxy[:, 1], rcond=None)[0]])
for tol, trim in [(40, .7), (25, .75), (15, .8), (10, .85)] + [(8, .85)] * 120:
    d, i = vtree.query(affine(p, slat, slng)); idx = np.where(d < tol)[0]
    keep = idx[np.argsort(d[idx])][: int(len(idx) * trim)]
    p = least_squares(lambda pp: (affine(pp, slat[keep], slng[keep]) - V[i[keep]]).ravel(), p, method='lm').x

def basis(xy):
    u, v = (xy[:, 0] - 1300) / 1300, (xy[:, 1] - 860) / 860
    return np.stack([u ** i * v ** j for i in range(4) for j in range(4 - i)], -1)
C = np.zeros((10, 2))
poly = lambda lat, lng: (lambda xy: xy + basis(xy) @ C)(affine(p, lat, lng))
for _ in range(15):
    d, i = vtree.query(poly(slat, slng)); idx = np.where(d < 8)[0]
    keep = idx[np.argsort(d[idx])][: int(len(idx) * .85)]
    b0 = affine(p, slat[keep], slng[keep])
    C = np.linalg.lstsq(basis(b0), V[i[keep]] - b0, rcond=None)[0]

TPS = None
def model(lat, lng):
    xy = poly(lat, lng)
    return xy + TPS(xy) if TPS is not None else xy

CHECK = {'Prince Rupert': (54.312, -130.325), 'Vancouver': (49.283, -123.12), 'Jasper': (52.877, -118.08), 'Edmonton': (53.546, -113.49),
  'Saskatoon': (52.13, -106.67), 'Winnipeg': (49.895, -97.14), 'Sioux Lookout': (50.098, -91.92), 'Thunder Bay': (48.38, -89.25),
  'Capreol': (46.706, -80.92), 'Toronto': (43.65, -79.38), 'Montreal': (45.50, -73.57), 'Quebec': (46.81, -71.21),
  'Moncton': (46.088, -64.78), 'Halifax': (44.65, -63.58), 'Chicago': (41.85, -87.65), 'Memphis': (35.15, -90.05),
  'Jackson MS': (32.30, -90.18), 'New Orleans': (29.95, -90.07), 'Duluth': (46.78, -92.10), 'Waterloo IA': (42.49, -92.34),
  'Sioux City': (42.50, -96.40), 'Prince George': (53.917, -122.75), 'Fort McMurray': (56.73, -111.38), 'Hay River': (60.816, -115.79)}
# sparse, loosely drafted areas: pin to the map's own station symbol
ANCHORS = {k: CHECK[k] for k in ('Hay River', 'Prince Rupert', 'Sioux Lookout', 'Winnipeg')}
for _ in range(6):
    d, i = vtree.query(model(slat, slng)); idx = np.where(d < 6)[0]
    keep = idx[np.argsort(d[idx])][: int(len(idx) * .85)]
    a = np.array(list(ANCHORS.values())); _, ai = gtree.query(model(a[:, 0], a[:, 1]))
    clat, clng = np.r_[slat[keep], a[:, 0]], np.r_[slng[keep], a[:, 1]]
    tgt = np.r_[V[i[keep]], G[ai]]
    TPS = None
    base = poly(clat, clng)
    TPS = RBFInterpolator(base, tgt - base, kernel='thin_plate_spline', smoothing=30.0, degree=1)

c0 = affine(p, np.array([49.0, 49.0]), np.array([-96.0, -95.0]))
KM = 111.32 * math.cos(math.radians(49)) / np.hypot(*(c0[1] - c0[0]))
held = {k: v for k, v in CHECK.items() if k not in ANCHORS}
hk = np.array(list(held.values())); dh, _ = vtree.query(model(hk[:, 0], hk[:, 1]))
ds, _ = vtree.query(model(slat, slng))
accuracy = {'held_out_cities': len(held), 'median_km': round(float(np.median(dh) * KM), 1), 'max_km': round(float(dh.max() * KM), 1),
            'plan_stations_within_5km': int((ds * KM < 5).sum()), 'plan_stations': len(st)}
print(f'georeference: n={p[0]:.4f}; held-out cities median {accuracy["median_km"]} km, max {accuracy["max_km"]} km; '
      f'plan stations within 5 km: {accuracy["plan_stations_within_5km"]}/{len(st)}')

def invert(xy):
    lat, lng = affine_inv(p, xy); h = 1e-4
    for _ in range(12):
        f0 = model(lat, lng) - xy
        ja = (model(lat + h, lng) - model(lat, lng)) / h; jb = (model(lat, lng + h) - model(lat, lng)) / h
        det = ja[:, 0] * jb[:, 1] - jb[:, 0] * ja[:, 1]
        lat, lng = lat - (jb[:, 1] * f0[:, 0] - jb[:, 0] * f0[:, 1]) / det, lng - (-ja[:, 1] * f0[:, 0] + ja[:, 0] * f0[:, 1]) / det
    return lat, lng

geo = []
for cls, pts in lines:
    lat, lng = invert(np.array(pts))
    geo.append([cls, list(zip(lat.tolist(), lng.tolist()))])

# ---------------------------------------------------------------- 3b. zoom insets
# Each inset is a zoomed view drawn in the same projection: page = alpha * (A . lcc) + beta, with
# alpha, beta complex (a similarity), fitted by ICP against the plan stations inside the inset.
# Accepted insets replace the main map's simplified line work over the area they cover.
INSETS = {  # name: (approx page centre, city lat/lng, approx radius shown in km)
    'Vancouver': ((272, 674), (49.22, -122.95), 30), 'Edmonton': ((923, 259), (53.55, -113.45), 25),
    'Winnipeg': ((1150, 263), (49.88, -97.10), 20), 'Minnesota': ((1060, 819), (47.2, -92.6), 120),
    'Wisconsin': ((920, 1127), (43.6, -88.5), 260), 'Chicago': ((1603, 965), (41.75, -87.75), 45),
    'Memphis': ((1238, 1173), (35.15, -90.0), 40), 'New Orleans': ((1614, 1452), (30.0, -90.3), 40),
    'SW Ontario & Detroit': ((2093, 894), (42.7, -82.2), 160), 'Toronto': ((2326, 1037), (43.72, -79.6), 45),
    'Montreal': ((2326, 758), (45.52, -73.62), 30), 'Quebec': ((2326, 499), (46.78, -71.25), 25),
}
lin = np.array([[p[1], p[2]], [p[4], p[5]]])                  # main affine, linear part
def zA(lat, lng):
    q = lcc(np.asarray(lat, float), np.asarray(lng, float), p[0]) @ lin.T
    return q[:, 0] + 1j * q[:, 1]
def zA_inv(z):
    q = np.linalg.solve(lin, np.stack([z.real, z.imag])).T
    rho = np.sign(p[0]) * np.hypot(q[:, 0], q[:, 1]); th = np.arctan2(q[:, 0], -q[:, 1])
    return np.degrees(2 * np.arctan(rho ** (-1 / p[0])) - np.pi / 2), np.degrees(LAM0 + th / p[0])
def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
def inside(poly, pt):
    x, y, c = pt[1], pt[0], False
    for i in range(len(poly)):
        (y1, x1), (y2, x2) = poly[i - 1], poly[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

main_pts = np.array([[q[0], q[1] * math.cos(math.radians(q[0]))] for _, pts in geo for q in pts])
main_tree = cKDTree(main_pts)
accepted = []
for ci, (cx, cy, cr) in enumerate(circles):
    name = min(INSETS, key=lambda k: math.dist(INSETS[k][0], (cx, cy)))
    if math.dist(INSETS[name][0], (cx, cy)) > 40 or not inset_runs[ci]:
        continue
    _, city, Rkm = INSETS[name]
    IV = np.array([q for _, run in inset_runs[ci] for q in run]); itree = cKDTree(IV)
    sel = [k for k, s in enumerate(st) if haversine_km(city, (s['lat'], s['lng'])) < Rkm * 1.6]
    if len(sel) < 3:
        print(f'  inset {name}: only {len(sel)} plan stations — skipped'); continue
    Zs = zA(slat[sel], slng[sel]); Zc = zA([city[0]], [city[1]])[0]
    best = None
    for f in np.geomspace(0.35, 3.0, 13):
      for rot0 in (-10, 0, 10):
        k = cr * KM / Rkm * f * np.exp(1j * math.radians(rot0))
        alpha, beta = k, (cx + 1j * cy) - k * Zc
        for tol_frac in (0.30, 0.20, 0.12, 0.08, 0.06, 0.06, 0.06):
            P = alpha * Zs + beta
            d, i = itree.query(np.c_[P.real, P.imag])
            ok = np.where(d < cr * tol_frac)[0]
            if len(ok) < 3: break
            keep = ok[np.argsort(d[ok])][: max(3, int(len(ok) * 0.85))]
            T = IV[i[keep]]; Tz = T[:, 0] + 1j * T[:, 1]
            sol = np.linalg.lstsq(np.c_[Zs[keep], np.ones(len(keep))], Tz, rcond=None)[0]
            alpha, beta = sol
        P = alpha * Zs + beta; d, _ = itree.query(np.c_[P.real, P.imag])
        km = d / abs(alpha) * KM
        n_ok = int((km < 2).sum()); med = float(np.median(np.sort(km)[: max(3, n_ok)]))
        if abs(math.degrees(np.angle(alpha))) > 15:
            continue
        if best is None or (n_ok, -med) > (best[0], -best[1]):
            best = (n_ok, med, alpha, beta)
    if best is None:
        print(f'  inset {name}: no fit'); continue
    n_ok, med, alpha, beta = best
    rot_deg = math.degrees(np.angle(alpha))
    # independent check: where inset lines leave the circle they must meet the main map's lines
    edge = []
    for cls, run in inset_runs[ci]:
        for q in (run[0], run[-1]):
            if math.dist(q, (cx, cy)) > cr - 10:
                la, lo = zA_inv(np.array([(q[0] + 1j * q[1] - beta) / alpha]))
                edge.append((float(la[0]), float(lo[0])))
    if edge:
        e = np.array(edge); ev = np.array([[a, b * math.cos(math.radians(a))] for a, b in e])
        dd, _ = main_tree.query(ev); edge_km = float(np.median(dd) * 111)
    else:
        edge_km = 99.0
    good = n_ok >= 3 and n_ok >= 0.5 * len(sel) and med < 1.0 and abs(alpha) > 1.5 and edge_km < 6
    print(f'  inset {name:22s}: {n_ok}/{len(sel)} stations within 2 km, median {med:.2f} km, zoom x{abs(alpha):.1f}, '
          f'rotation {rot_deg:+.1f} deg, edge continuity {edge_km:.1f} km ({len(edge)} exits) -> {"USED" if good else "skipped"}')
    if not good:
        continue
    # coverage polygon (the circle, mapped to lat/lng) and the inset's own lines
    ring = np.array([(cx + (cr - 3) * math.cos(t), cy + (cr - 3) * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 64)])
    rlat, rlng = zA_inv((ring[:, 0] + 1j * ring[:, 1] - beta) / alpha)
    accepted.append({'name': name, 'poly': list(zip(rlat.tolist(), rlng.tolist())), 'stations': n_ok, 'median_km': round(med, 2),
                     'runs': [(cls, list(zip(*zA_inv((np.array(run)[:, 0] + 1j * np.array(run)[:, 1] - beta) / alpha))))
                              for cls, run in inset_runs[ci]]})

# replace main-map line work inside accepted insets by the inset's detailed lines
for ins in accepted:
    poly = ins['poly']; lat0 = min(q[0] for q in poly); lat1 = max(q[0] for q in poly)
    lng0 = min(q[1] for q in poly); lng1 = max(q[1] for q in poly)
    out = []
    for cls, pts in geo:
        run = []
        for q in pts:
            if lat0 <= q[0] <= lat1 and lng0 <= q[1] <= lng1 and inside(poly, q):
                if len(run) > 1: out.append([cls, run])
                run = []
            else:
                run.append(q)
        if len(run) > 1: out.append([cls, run])
    geo = out + [[cls, [tuple(map(float, q)) for q in run]] for cls, run in ins['runs']]
print(f'insets used: {", ".join(i["name"] for i in accepted) or "none"}')

# ---------------------------------------------------------------- 4. chain + simplify
def chain(segs, tol):
    """
    Join runs of the same class end-to-end: two endpoints are joined when each is the other's
    nearest endpoint within `tol` degrees and no third endpoint is that close (i.e. not a junction).
    """
    segs = [list(s) for s in segs]
    while True:
        ends = [(i, e, s[e]) for i, s in enumerate(segs) for e in (0, -1)]
        pts = np.array([[pt[0], pt[1] * math.cos(math.radians(pt[0]))] for _, _, pt in ends])
        tree = cKDTree(pts)
        used, merged = set(), False
        for a, (i, ei, _) in enumerate(ends):
            if i in used:
                continue
            near = [b for b in tree.query_ball_point(pts[a], tol) if b != a and ends[b][0] != i]
            if len(near) != 1:
                continue
            b = near[0]; j, ej, _ = ends[b]
            back = [c for c in tree.query_ball_point(pts[b], tol) if c != b and ends[c][0] != j]
            if back != [a] or j in used:
                continue
            A = segs[i] if ei == -1 else segs[i][::-1]
            B = segs[j] if ej == 0 else segs[j][::-1]
            segs[i], segs[j] = A + B, None
            used |= {i, j}; merged = True
        segs = [s for s in segs if s]
        if not merged:
            return segs

def dp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); P = np.array(pts)
    k = math.cos(math.radians(a[0]))
    ab = (b - a) * [1, k]; L = np.hypot(*ab) or 1e-12
    w = (P - a) * [1, k]
    d = np.abs(ab[0] * w[:, 1] - ab[1] * w[:, 0]) / L
    i = int(d.argmax())
    if d[i] <= eps:
        return [pts[0], pts[-1]]
    return dp(pts[: i + 1], eps)[:-1] + dp(pts[i:], eps)

by = defaultdict(list)
for cls, pts in geo:
    by[cls].append(pts)
out_lines = []
for cls, segs in by.items():
    for s in chain(segs, 0.04 if cls == 'rights' else 0.004):
        s = dp(s, 0.0025)                                       # ~250 m
        if len(s) >= 2:
            out_lines.append((cls, s))

# ---------------------------------------------------------------- 5. name by corridor
corr = json.load(open(CORRIDORS)); byk = {s['k']: (s['lat'], s['lng']) for s in plan['plan']}
cpaths = []
for ln in corr['lines']:
    path = [byk.get(v) or corr['places'].get(v) for v in ln['via']]
    cpaths.append((ln, [q for q in path if q]))
def seg_km(pt, a, b):
    kx = 111.32 * math.cos(math.radians(pt[0])); ky = 110.57
    ax, ay, bx, by_ = (a[1]-pt[1])*kx, (a[0]-pt[0])*ky, (b[1]-pt[1])*kx, (b[0]-pt[0])*ky
    dx, dy = bx - ax, by_ - ay; L2 = dx * dx + dy * dy
    t = max(0, min(1, -(ax * dx + ay * dy) / L2)) if L2 else 0
    return math.hypot(ax + t * dx, ay + t * dy)
def corridor_of(pts):
    samp = pts[:: max(1, len(pts) // 12)] + [pts[-1]]
    best, bd = None, 1e9
    for ln, path in cpaths:
        dd = sorted(min(seg_km(q, path[i - 1], path[i]) for i in range(1, len(path))) for q in samp)
        score = dd[len(dd) // 2]
        if score < bd:
            bd, best = score, ln
    return (best, bd) if bd < 30 else (None, bd)

def length_km(pts):
    return sum(seg_km(pts[i - 1], pts[i], pts[i]) for i in range(1, len(pts)))

result, named = [], 0
for n, (cls, pts) in enumerate(sorted(out_lines, key=lambda x: (-length_km(x[1])))):
    ln, _ = corridor_of(pts)
    named += ln is not None
    result.append({'id': f'l{n:03d}', 'capacity': cls,
                   'corridor': ln['name'] if ln else 'CN line', 'rank': ln['class'] if ln else 'secondary',
                   'path': [[round(a, 4), round(b, 4)] for a, b in pts]})
total = sum(length_km(l['path']) for l in result)
print(f'{len(result)} lines, ~{total:,.0f} route-km, {named} named from corridors')

json.dump({
    'meta': {
        'name': 'CN rail network',
        'source': 'CN Weight Limitations System Map, revised 7/2016 (reference/cn-weight-limitations-system-map-2016-07.pdf)',
        'method': 'Vector line work extracted from the PDF and georeferenced (Lambert conformal conic + affine, cubic and '
                  'thin-plate corrections fitted to plan station positions). Zoom insets excluded. See scripts/network/build_cn_network.py.',
        'accuracy': accuracy,
        'insets': {'used': [{'name': i['name'], 'stations_matched': i['stations'], 'median_km': i['median_km']} for i in accepted],
                   'note': 'Most zoom insets on the source map are schematic diagrams; an inset is used only when its stations '
                           'fit within 1 km median AND its lines meet the main map within 6 km where they leave the circle.'},
    },
    'capacity': {
        '286k': {'label': '286,000 lb', 'cars': "47' or longer cars"},
        '272k': {'label': '272,000 lb', 'cars': "45' or longer cars"},
        '268k': {'label': '268,000 lb', 'cars': "44' or longer cars"},
        '263k': {'label': '263,000 lb', 'cars': "43' or longer cars"},
        'lt263k': {'label': 'under 263,000 lb', 'cars': "43' or longer cars"},
        'rights': {'label': 'CN track rights on other railroads', 'cars': ''},
    },
    'lines': result,
}, open(OUT, 'w'), separators=(',', ':'))

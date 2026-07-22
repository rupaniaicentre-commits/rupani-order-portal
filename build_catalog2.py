#!/usr/bin/env python3
"""Build honda_catalog2.json — consolidated super-families with generation
sections and DISTINCT part-variants (variants merged only when their parts are
essentially common). Also precomputes part counts + how many we procure (✓).

Structure:
  { scooters:[fam], motorcycles:[fam] }
  fam = { family, name, q, sections:[sec] }
  sec = { label, years, variants:[var] }
  var = { key, codes:[..], model_ids:[..], desc, nparts, nreg }
"""
import json, sqlite3, re, os

BASE = os.path.dirname(os.path.abspath(__file__))
vv = json.load(open(os.path.join(BASE, 'vehicle_variants.json')))
feats = json.load(open(os.path.join(BASE, 'model_features.json')))
conn = sqlite3.connect(os.path.join(BASE, 'epc_parts.db'))

# procured set (parts we regularly keep) -> ✓
procured = set()
for p in json.load(open(os.path.join(BASE, 'honda_parts.json'))).get('parts', []):
    n = re.sub(r'[^A-Z0-9]', '', (p.get('part_no') or '').upper())
    if n:
        procured.add(n)

# --- consolidate: all Shine / Unicorn / Activa each into ONE family ---
SUPER = {
    'Shine':   ['CB Shine/ Shine 125', 'CB Shine SP', 'SP125', 'SP160', 'Shine 100', 'Shine100 DX'],
    'Unicorn': ['CB Unicorn', 'CB Unicorn 160', 'CB Unicorn Dazzler'],
    'Activa':  ['Activa', 'Activa i', 'Activa125'],
}
SCOOTER_FAMS = {'Activa', 'Activa i', 'Activa125', 'Aviator', 'CLIQ', 'Dio', 'Dio 125',
                'Eterno', 'GRAZIA', 'Navi'}
# search aliases so 'shine sp','sp160' etc still find the super-family
SUPER_ALIAS = {
    'Shine': 'shine sp125 sp 125 sp160 sp 160 cb shine shine 100 shine125',
    'Unicorn': 'unicorn dazzler cb unicorn 160 150',
    'Activa': 'activa activa125 activa 125 activa i',
}
NAMES = {  # display names for the remaining (non-super) families
    'CB Unicorn Dazzler': 'Unicorn Dazzler', 'CD 110 Dream': 'Dream 110',
    'HNESS': "H'ness CB350", 'CB350': 'CB350 / CB350RS', '500X': 'CB500X',
    'XBLADE': 'X-Blade', 'CB125 Hornet': 'Hornet 125', 'CB Hornet 160R': 'Hornet 160R',
    'CBF Stunner': 'Stunner', 'Dio 125': 'Dio 125',
}

member_of = {}          # raw family -> super name
for sup, mem in SUPER.items():
    for m in mem:
        member_of[m] = sup


def partset(mid):
    return set(r[0] for r in conn.execute(
        "SELECT DISTINCT pn FROM parts WHERE model_id=? AND ns!='NS' AND pn!=''", (str(mid),)))


def jac(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def contain(a, b):      # how much of the smaller sits inside the larger
    s, l = (a, b) if len(a) <= len(b) else (b, a)
    return len(s & l) / len(s) if s else 0.0


def code_desc(code):
    f = feats.get(code) or {}
    bits = []
    if f.get('brake'):
        bits.append(f['brake'] + ' Brake')
    if f.get('wheel') == 'Spoke':
        bits.append('Spoke Wheel')
    if f.get('cbs') == 'Yes':
        bits.append('CBS')
    if f.get('abs') == 'ABS':
        bits.append('ABS')
    if f.get('fuel'):
        bits.append('FI' if f['fuel'] == 'FI' else 'Carburettor')
    if f.get('start') in ('Kick', 'Silent'):
        bits.append(f['start'] + ' Start')
    return ', '.join(bits)


def build_section(g):
    """One generation group -> distinct variants.

    A retailer distinguishes variants by real, describable differences
    (Disc vs Drum, ABS, Carb vs FI). So variants that share the SAME derived
    description are shown together (their parts overlap heavily anyway); a
    genuinely different description becomes its own card.
    """
    codes = g.get('codes', [])
    mids = g.get('model_ids', [])
    variants = {}          # desc -> variant
    order = []
    for i, code in enumerate(codes):
        mid = str(mids[i]) if i < len(mids) else None
        if not mid:
            continue
        ps = partset(mid)
        if not ps:
            continue
        desc = code_desc(code) or 'Standard'
        v = variants.get(desc)
        if not v:
            v = {'desc': desc, 'codes': [], 'model_ids': [], 'ps': set()}
            variants[desc] = v
            order.append(desc)
        v['codes'].append(code)
        v['model_ids'].append(mid)
        v['ps'] |= ps
    out = []
    for desc in order:
        v = variants[desc]
        nreg = sum(1 for pn in v['ps'] if re.sub(r'[^A-Z0-9]', '', pn.upper()) in procured)
        out.append({
            'key': v['codes'][0],
            'codes': v['codes'],
            'model_ids': v['model_ids'],
            'desc': '' if desc == 'Standard' else desc,
            'nparts': len(v['ps']),
            'nreg': nreg,
        })
    out.sort(key=lambda v: -v['nparts'])
    return out


def year_key(years):
    m = re.findall(r'(19|20)\d{2}', years or '')
    return int((m[-1] if m else '0') + years[-2:] if False else (years or '0'))


def newest(years):
    yrs = re.findall(r'((?:19|20)\d{2})', years or '')
    return max((int(y) for y in yrs), default=0)


# --- assemble families ---
fam_entries = {}   # display key -> entry
order = []
for raw, obj in vv.items():
    sup = member_of.get(raw)
    disp = sup or raw
    if disp not in fam_entries:
        name = sup or NAMES.get(raw, obj.get('name', raw))
        alias = SUPER_ALIAS.get(sup, '') if sup else raw.lower()
        fam_entries[disp] = {'family': disp, 'name': name, 'sections': [],
                             'q': (name + ' ' + alias).lower(), '_scoot': raw in SCOOTER_FAMS}
        order.append(disp)
    entry = fam_entries[disp]
    for g in obj.get('groups', []):
        variants = build_section(g)
        if not variants:
            continue
        entry['sections'].append({'label': g.get('gen', disp), 'years': g.get('years', ''),
                                  'variants': variants, '_ny': newest(g.get('years', ''))})

scoot, moto = [], []
for disp in order:
    e = fam_entries[disp]
    e['sections'].sort(key=lambda s: -s['_ny'])      # newest generation first
    for s in e['sections']:
        s.pop('_ny', None)
    scoot_flag = e.pop('_scoot')
    (scoot if scoot_flag else moto).append(e)

scoot.sort(key=lambda x: x['name'])
moto.sort(key=lambda x: x['name'])
out = {'scooters': scoot, 'motorcycles': moto}
json.dump(out, open(os.path.join(BASE, 'honda_catalog2.json'), 'w'), ensure_ascii=False)

# summary
nfam = len(scoot) + len(moto)
nsec = sum(len(f['sections']) for f in scoot + moto)
nvar = sum(len(s['variants']) for f in scoot + moto for s in f['sections'])
print(f"families={nfam} sections={nsec} variants={nvar}")
for f in scoot + moto:
    if f['family'] in ('Shine', 'Unicorn', 'Activa'):
        print(f"\n{f['name']}: {len(f['sections'])} sections")
        for s in f['sections']:
            print(f"  {s['label']} ({s['years']})")
            for v in s['variants']:
                print(f"     • {'/'.join(v['codes'])}: {v['desc']}  [{v['nparts']}p, {v['nreg']}✓]")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chassis -> Honda model-designation code (SCV110T ...) -> parts,
with an auto-generated HINGLISH distinguishing filter when a year has
more than one real variant.

Data files (all in this folder):
  vahan_to_scv.json          family -> [{year, code, gen, norms, model_id}]
  makermodel_to_family.json  VAHAN maker_model spelling -> EPC family
  model_features.json        code -> {fuel,start,brake,wheel,cbs}  (from parts diff)
  vds_to_family.json         VDS4 (JF-code) -> family   (self-built from VAHAN)
"""
import json, os, re
BASE=os.path.dirname(os.path.abspath(__file__))
FAM   = json.load(open(f'{BASE}/vahan_to_scv.json'))
MM2F  = json.load(open(f'{BASE}/makermodel_to_family.json'))
FEAT  = json.load(open(f'{BASE}/model_features.json'))
try:    VDS2F = json.load(open(f'{BASE}/vds_to_family.json'))
except FileNotFoundError: VDS2F = {}
# EXACT overrides: chassis VDS5+year-letter (e.g. "JK361T") -> exact code.
# Seeded from Honda-portal cross-checks; highest priority, always trusted.
try:    VDS_OVERRIDE = json.load(open(f'{BASE}/vds_overrides.json'))
except FileNotFoundError: VDS_OVERRIDE = {}

def _ovkey_from_chassis(ch):
    ch=(ch or '').strip().upper()
    return (ch[3:8] + ch[9]) if len(ch) > 9 else None   # VDS5 + year-letter

def learn_vds_code(chassis, code):
    """Record a Honda-confirmed exact mapping (chassis VDS+year -> code)."""
    k=_ovkey_from_chassis(chassis)
    if k and code and VDS_OVERRIDE.get(k)!=code:
        VDS_OVERRIDE[k]=code
        json.dump(VDS_OVERRIDE, open(f'{BASE}/vds_overrides.json','w'), indent=1)
    return k

# ---------- chassis parsing ----------
_Y='123456789ABCDEFGHJKLMNPRSTVWXY'; _Y0=2001
def year_from_vin(ch):
    i=_Y.find((ch or '').upper()); return _Y0+i if i>=0 else None
def parse_chassis(ch):
    ch=(ch or '').strip().upper()
    return {'wmi':ch[0:3],'vds4':ch[3:7],'vds5':ch[3:8],
            'month':ch[8] if len(ch)>8 else None,
            'year_letter':ch[9] if len(ch)>9 else None,
            'plant':ch[10] if len(ch)>10 else None,
            'serial':ch[11:] if len(ch)>11 else None}

def _norm(s): return re.sub(r'[^A-Z0-9]','',(s or '').upper())
def family_from_makermodel(mm):
    if not mm: return None
    if mm.upper() in MM2F: return MM2F[mm.upper()]
    t=_norm(mm)
    # match the LONGEST / most-specific name first, so "ACTIVA125..." beats "ACTIVA"
    for k in sorted(MM2F, key=lambda k: -len(_norm(k))):
        if _norm(k) and _norm(k) in t: return MM2F[k]
    return None

# displacement-sibling families: (cc-token in name) -> correct family by engine cc
_CC_SIBLINGS = [  # (small_family, big_family, cc_threshold)
    ('Activa', 'Activa125', 120), ('Dio', 'Dio 125', 120),
]
def _correct_displacement(family, cc):
    """VAHAN cubic_capacity is authoritative for 110-vs-125 style confusions."""
    try: cc=float(str(cc).strip())
    except (TypeError, ValueError): return family
    for small, big, thr in _CC_SIBLINGS:
        if cc>=thr and family==small and big in FAM: return big     # 125cc but got 110-family
        if cc<thr  and family==big   and small in FAM: return small # 110cc but got 125-family
    return family

# ---------- HINGLISH distinguishing questions ----------
# feature -> (Hinglish question, {value: Hinglish option label})
QUESTIONS={
 'fuel' : ("Gaadi ka petrol system kaunsa hai?",
           {'Carb':'Carburettor waala (purana)', 'FI':'FI / Injection waala (naya)'}),
 'start': ("Gaadi start kaise hoti hai?",
           {'Silent':'Silent start (button dabao, awaaz nahi)',
            'Self':'Self start (button se)', 'Kick':'Sirf Kick maarke'}),
 'brake': ("Aage ka brake kaisa hai?",
           {'Disc':'Disc brake', 'Drum':'Drum brake (normal/plate)'}),
 'wheel': ("Pahiya (wheel) kaisa hai?",
           {'Alloy':'Alloy wheel', 'Spoke':'Spoke / teeli waala'}),
 'cbs'  : ("CBS hai kya? (dono brake ek saath lagta hai)",
           {'Yes':'Haan, CBS hai', 'No':'Nahi'}),
 'abs'  : ("ABS hai kya?",
           {'ABS':'Haan, ABS hai', 'No':'Nahi'}),
}
# ask features in this order (most obvious to a shop first)
FEATURE_ORDER=['brake','abs','wheel','fuel','start','cbs']

def _feat(code):
    f=dict(FEAT.get(code,{}))
    f.setdefault('cbs','No')            # absence of CBS illustration => No
    f.setdefault('abs','No')            # absence of ABS illustration => No
    return f

def build_filter(codes):
    """Given 2+ candidate codes, return the single best Hinglish question that
       splits them (each option -> the codes/model_ids it maps to)."""
    for k in FEATURE_ORDER:
        vals={c:_feat(c).get(k) for c in codes}
        present=[c for c in codes if vals[c] is not None]
        distinct=set(vals[c] for c in present)
        if len(distinct)>1:            # this feature actually distinguishes them
            q,labels=QUESTIONS[k]
            opts=[]
            for v in sorted(distinct):
                grp=[c for c in present if vals[c]==v]
                opts.append({'value':v,'label':labels.get(v,v),
                             'codes':grp,
                             'model_ids':[_mid(c) for c in grp]})
            return {'feature':k,'ask':q,'options':opts}
    return None                         # no functional difference

def _mid(code):
    for items in FAM.values():
        for it in items:
            if it['code']==code: return it['model_id']
    return None

def _code_year(code):
    """Model-year from the code's year LETTER — the same Honda model-year code
    as VIN digit-10 (N=2022, P=2023...). Authoritative for matching. The OCR image
    year is a display/launch year that runs ~1 year behind, so we do NOT use it.
    Scans from the end so a trailing trim letter (e.g. SCV110L I) still resolves."""
    b=code.split('/')[0].upper()
    for ch in reversed(b):
        i=_Y.find(ch)
        if i>=0: return _Y0+i
    return None

def pick_variant(family, year, norms=None):
    cands=FAM.get(family, [])
    if not cands: return []
    yrs=[(c,_code_year(c['code'])) for c in cands]
    yrs=[(c,y) for c,y in yrs if y]
    if not yrs: return cands[:1]
    exact=[c for c,y in yrs if y==year]              # code letter == vehicle model-year
    if exact:
        same=exact
    else:                                            # no exact -> latest variant on/before
        le=[(c,y) for c,y in yrs if y<=year]
        pool=le or yrs
        by=max(y for c,y in pool)
        same=[c for c,y in pool if y==by]
    if len(same)>1 and norms:
        n=_norm(norms)
        nn=[c for c in same if _norm(c.get('norms')) and _norm(c.get('norms'))[-2:] in n]
        if nn: same=nn
    return same

def resolve(chassis=None, maker_model=None, mfg_year=None, norms=None, cubic_capacity=None):
    p=parse_chassis(chassis) if chassis else {}
    # 1) EXACT override (Honda-confirmed) — highest priority
    ovk=_ovkey_from_chassis(chassis)
    if ovk and ovk in VDS_OVERRIDE:
        code=VDS_OVERRIDE[ovk]
        return {'ok':True,'model_code':code,'model_id':_mid(code),
                'year':(year_from_vin(p['year_letter']) if p.get('year_letter') else mfg_year),
                'family':family_from_makermodel(maker_model) if maker_model else None,
                'needs_filter':False,'source':'exact'}
    family=family_from_makermodel(maker_model) if maker_model else None
    if not family and p.get('vds4'): family=VDS2F.get(p['vds4'])
    if family and cubic_capacity: family=_correct_displacement(family, cubic_capacity)
    year=mfg_year or (year_from_vin(p['year_letter']) if p.get('year_letter') else None)
    if not family:
        vds=p.get('vds4')
        return {'ok':False,
                'reason':(f'Is chassis ka model abhi pata nahi (VDS "{vds}" seeded nahi hai). '
                          'Neeche "Model" box me gaadi ka naam daalo (jaise ACTIVA 6G, DIO, CB SHINE) '
                          'aur "Chassis se dhoondo" dabao.') if vds
                         else 'Model naam ya chassis number daalo.',
                'vds4':vds,'year':year}
    cands=pick_variant(family, year, norms)
    if not cands:
        return {'ok':False,'reason':'is saal ka variant nahi mila','family':family,'year':year}
    # Auto-narrow using hints VAHAN already puts in maker_model (DISK/DRUM/6G/ALLOY...)
    if len(cands)>1 and maker_model:
        mm=maker_model.upper()
        want={}
        if 'DISK' in mm or 'DISC' in mm: want['brake']='Disc'
        elif 'DRUM' in mm:               want['brake']='Drum'
        if any(g in mm for g in ('6G','BS6','BS-VI','BSVI','BS VI')): want['fuel']='FI'
        elif any(g in mm for g in ('5G','4G','3G')):                  want['fuel']='Carb'
        if 'ALLOY' in mm: want['wheel']='Alloy'
        for feat,val in want.items():
            f=[c for c in cands if FEAT.get(c['code'],{}).get(feat)==val]
            if f and len(f)<len(cands): cands=f
    if len(cands)==1:
        c=cands[0]
        return {'ok':True,'family':family,'year':year,'model_code':c['code'],
                'model_id':c['model_id'],'needs_filter':False}
    codes=[c['code'] for c in cands]
    q=build_filter(codes)
    if q is None:                       # same bike, different batch -> just take first
        c=cands[0]
        return {'ok':True,'family':family,'year':year,'model_code':c['code'],
                'model_id':c['model_id'],'needs_filter':False,
                'note':'same gaadi, alag batch — koi farak nahi','alternates':codes}
    return {'ok':True,'family':family,'year':year,'needs_filter':True,
            'candidates':codes,'question':q}

def learn_vds(vds4, family):
    if vds4 and family and VDS2F.get(vds4)!=family:
        VDS2F[vds4]=family
        json.dump(VDS2F,open(f'{BASE}/vds_to_family.json','w'),indent=1)

if __name__=='__main__':
    import pprint
    print("— Activa 6G 2020 (two 2020 variants, no real diff) —")
    pprint.pp(resolve('ME4JF914JLW156040', maker_model='ACTIVA 6G', mfg_year=2020, norms='BS-VI'))
    print("\n— force a real fork: Activa, pretend year 2019 vs 2020 boundary —")
    # demo the filter: Activa where a year has Carb vs FI split
    learn_vds('JF91','Activa')
    print("\n— Shine, a year with disc/drum split (illustrative) —")
    pprint.pp(resolve(maker_model='CB SHINE', mfg_year=2018))

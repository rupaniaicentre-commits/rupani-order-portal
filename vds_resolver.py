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
    for k,v in MM2F.items():
        if _norm(k) and _norm(k) in t: return v
    return None

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
}
# ask features in this order (most obvious to a shop first)
FEATURE_ORDER=['brake','wheel','fuel','start','cbs']

def _feat(code):
    f=dict(FEAT.get(code,{}))
    f.setdefault('cbs','No')            # absence of CBS illustration => No
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

def pick_variant(family, year, norms=None):
    cands=FAM.get(family, [])
    if not cands: return []
    dated=[c for c in cands if c.get('year')]
    le=[c for c in dated if c['year']<=year]
    pool=le or dated
    if not pool: return []
    by=max(c['year'] for c in pool)
    same=[c for c in pool if c['year']==by]
    if len(same)>1 and norms:
        n=_norm(norms)
        nn=[c for c in same if _norm(c.get('norms')) and _norm(c.get('norms'))[-2:] in n]
        if nn: same=nn
    return same

def resolve(chassis=None, maker_model=None, mfg_year=None, norms=None):
    p=parse_chassis(chassis) if chassis else {}
    family=family_from_makermodel(maker_model) if maker_model else None
    if not family and p.get('vds4'): family=VDS2F.get(p['vds4'])
    year=mfg_year or (year_from_vin(p['year_letter']) if p.get('year_letter') else None)
    if not family:
        return {'ok':False,'reason':'family unknown — VAHAN maker_model ya vds_to_family entry chahiye',
                'vds4':p.get('vds4'),'year':year}
    cands=pick_variant(family, year, norms)
    if not cands:
        return {'ok':False,'reason':'is saal ka variant nahi mila','family':family,'year':year}
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

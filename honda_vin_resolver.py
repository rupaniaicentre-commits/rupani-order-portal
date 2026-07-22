#!/usr/bin/env python3
"""
Honda chassis-number -> EPC model-code resolver.

LOGIC (cracked):
  Honda EPC model code = [PLATFORM PREFIX] + [MODEL-YEAR LETTER]
    * MODEL-YEAR LETTER  = digit 10 of the 17-char chassis/VIN  (Honda year code)
    * PLATFORM PREFIX     = the model line, taken from VAHAN maker_model (family)
  When a (family, year) has >1 trim, disambiguate by cubic_capacity / variant text.

Inputs available from VAHAN: maker_model, vehicle_chasi_number, cubic_capacity, norms_type.
"""
import json, re, os

# Honda VIN 10th-digit MODEL-YEAR code (skips I,O,Q,U,Z and 0)
YEAR_LETTER = {y:l for l,y in {
 '1':2001,'2':2002,'3':2003,'4':2004,'5':2005,'6':2006,'7':2007,'8':2008,'9':2009,
 'A':2010,'B':2011,'C':2012,'D':2013,'E':2014,'F':2015,'G':2016,'H':2017,'J':2018,
 'K':2019,'L':2020,'M':2021,'N':2022,'P':2023,'R':2024,'S':2025,'T':2026}.items()}
LETTER_YEAR = {l:y for y,l in YEAR_LETTER.items()}

# VAHAN maker_model (upper, spaces/hyphens stripped) -> our EPC family
MAKER_TO_FAMILY = {
 'ACTIVA':'Activa','ACTIVA5G':'Activa','ACTIVA6G':'Activa','ACTIVA3G':'Activa','ACTIVA4G':'Activa',
 'ACTIVAI':'Activa i','ACTIVA125':'Activa125','ACTIVA125BS6':'Activa125',
 'AVIATOR':'Aviator','DIO':'Dio','DIO125':'Dio 125','GRAZIA':'GRAZIA','CLIQ':'CLIQ','NAVI':'Navi','ETERNO':'Eterno',
 'CBSHINE':'CB Shine/ Shine 125','SHINE':'CB Shine/ Shine 125','SHINE125':'CB Shine/ Shine 125','CBSHINESP':'CB Shine SP',
 'SP125':'SP125','SP160':'SP160','LIVO':'Livo','DREAMYUGA':'Dream Yuga','DREAMNEO':'Dream Neo',
 'CD110DREAM':'CD 110 Dream','DREAM110':'CD 110 Dream','SHINE100':'Shine 100',
 'CBUNICORN':'CB Unicorn','UNICORN':'CB Unicorn','CBUNICORN160':'CB Unicorn 160','UNICORN160':'CB Unicorn 160',
 'CBHORNET160R':'CB Hornet 160R','HORNET':'Hornet 2.0','HORNET2.0':'Hornet 2.0','XBLADE':'XBLADE',
 'CBTWISTER':'CB Twister','CBTRIGGER':'CB Trigger','CBFSTUNNER':'CBF Stunner','STUNNER':'CBF Stunner',
 'CB350':'CB350','HNESS':'HNESS','HNESSCB350':'HNESS','CB350RS':'HNESS','CB200X':'CB200X','CB300F':'CB300F','CB300R':'CB300R',
 'CBR150R':'CBR150R','CBR250R':'CBR250R','CBR650R':'CBR650R','CBR650F':'CBR650F','CB650R':'CB650R',
 'CB500X':'500X','AFRICATWIN':'Africa Twin','CB125HORNET':'CB125 Hornet','CBUNICORNDAZZLER':'CB Unicorn Dazzler',
}

def _norm(s): return re.sub(r'[^A-Z0-9.]','',(s or '').upper())

def _load_index(tree_index_path):
    """Build {(family, year_letter): [codes]} and family->codes from the extracted catalog."""
    d=json.load(open(tree_index_path))
    fam=set(); by=({}); famcodes={}
    seen=set()
    idx={}
    for x in d:
        k=(x['family'],x['variant'])
        if k in seen: continue
        seen.add(k)
        base=x['variant'].split('/')[0]
        yl=base[-1]
        idx.setdefault((x['family'],yl),[]).append(x['variant'])
        famcodes.setdefault(x['family'],set()).add(x['variant'])
    return idx, famcodes

def resolve(vahan, tree_index_path=None):
    """vahan: dict with maker_model, vehicle_chasi_number, cubic_capacity(optional).
       returns dict(model_code, candidates, family, year, reason)."""
    if tree_index_path is None:
        tree_index_path=os.path.join(os.path.dirname(__file__),'honda_tree_index.json')
    idx,famcodes=_load_index(tree_index_path)
    chassis=_norm(vahan.get('vehicle_chasi_number'))
    maker=_norm(vahan.get('maker_model'))
    # family
    family=MAKER_TO_FAMILY.get(maker)
    if not family:  # fuzzy: longest alias key contained in maker
        for k in sorted(MAKER_TO_FAMILY,key=len,reverse=True):
            if k in maker: family=MAKER_TO_FAMILY[k]; break
    # year letter = chassis digit 10 (1-indexed)
    yl = chassis[9] if len(chassis)>=10 else None
    out={'family':family,'year_letter':yl,'year':LETTER_YEAR.get(yl),'model_code':None,'candidates':[],'reason':''}
    if not family: out['reason']='maker_model not mapped'; return out
    if yl not in LETTER_YEAR: out['reason']='could not read year digit (10) from chassis'; return out
    cands=sorted(idx.get((family,yl),[]))
    out['candidates']=cands
    if len(cands)==1:
        out['model_code']=cands[0]; out['reason']='exact (family+year)'
    elif len(cands)>1:
        # trim tiebreak: shorter code = base/STD (heuristic); refine with cc if available
        base=min(cands,key=len)
        out['model_code']=base; out['reason']=f'{len(cands)} trims for this year; picked base (refine w/ variant/cc)'
    else:
        # nearest year fallback within family
        yrs=[k[1] for k in idx if k[0]==family]
        out['reason']=f'no code for year {LETTER_YEAR.get(yl)}; family years avail: {sorted(set(yrs))}'
    return out

if __name__=='__main__':
    ti='/tmp/tree_index.json'
    tests=[
      {'maker_model':'ACTIVA 6G','vehicle_chasi_number':'ME4JF914JLW156040','cubic_capacity':'109.19'},
      {'maker_model':'ACTIVA 5G','vehicle_chasi_number':'ME4JF50XXJK123456'},
      {'maker_model':'DIO','vehicle_chasi_number':'ME4JF16XXLL123456'},
      {'maker_model':'CB SHINE','vehicle_chasi_number':'ME4JC65XXPP123456'},
    ]
    for t in tests:
        r=resolve(t,ti)
        print(f"{t['maker_model']:10} yr-digit={t['vehicle_chasi_number'][9]} -> {r['model_code'] or '(?)':10} "
              f"[{r['year']}] cands={r['candidates']}  {r['reason']}")

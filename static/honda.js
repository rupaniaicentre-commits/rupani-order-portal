'use strict';
/* ══════════════════════════════════════════════════════
   RUPANI AUTOMOBILES — HONDA PARTS PORTAL  (honda.js)
   Variant-level vehicles, union fitment, universal search,
   customer fitment feedback.
   ══════════════════════════════════════════════════════ */
const H = (() => {
  let DATA = null;           // {vehicle_groups, parts}
  let parts = [];
  let newBatches = [];       // [{batch, part_nos}] newly received parts
  let newSet = new Set();    // part_no -> is new
  let searchIndex = [];      // parts + _search string (Aerostar-style)
  let searchFocusIdx = -1;
  let session = { firm:'', contact:'' };
  let basket = {};           // part_no -> {part, qty}
  let stack = [];            // view history: {view, arg}
  let CATALOG = null;        // {scooters:[{family,name,sections}], motorcycles, meta}
  let META = {};             // {total, common}
  let fullParts = null;      // full 30k catalogue (lazy)
  let commonParts = null;    // parts common to many vehicles (lazy)
  let partIndex = {};        // part_no -> part object (1500 + catalogue parts)
  let groupCache = {};       // group key -> {all:[parts], regular:[parts]}

  const FAMILY_ICON = {
    ACTIVA:'🛵', SHINE:'🏍️', UNICORN:'🏍️', DREAM:'🏍️', DIO:'🛵', LIVO:'🏍️',
    TWISTER:'🏍️', AVIATOR:'🛵', 'CD 110':'🏍️', HORNET:'🏍️', GRAZIA:'🛵',
    STUNNER:'🏍️', NAVI:'🛵', OTHER:'🔩', 'ALL MODELS':'🔧'
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inr = n => n==null ? '—' : '₹'+Number(n).toLocaleString('en-IN');
  const cssid = s => String(s).replace(/[^A-Za-z0-9_-]/g,'_');
  // normalise to letters+digits only so "bp"↔"B.P.", "3g"↔"3G", "n/m"↔"nm" all match
  const flat = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const normHay = p => flat(p.part_no+' '+(p.code||'')+' '+p.name+' '+(p.vehicles||[]).join(' '));
  const qWords = q => String(q||'').toLowerCase().split(/\s+/).map(w=>w.replace(/[^a-z0-9]+/g,'')).filter(Boolean);

  // ── session (shared with landing page + Aerostar) ───
  function getShared(){
    try{
      const s = sessionStorage.getItem('ra_session') || localStorage.getItem('ra_remember');
      if(s){ const p=JSON.parse(s); if(p&&p.firm) return p; }
    }catch(_){}
    return null;
  }
  function login(){
    const firm=$('firm').value.trim(), mob=$('mobile').value.trim();
    const err=$('lerr');
    if(!firm){ err.textContent='Please enter your firm name'; err.classList.remove('hidden'); return; }
    if(!/^\d{10}$/.test(mob)){ err.textContent='Please enter a valid 10-digit mobile number'; err.classList.remove('hidden'); return; }
    session={firm, contact:mob};
    sessionStorage.setItem('ra_session', JSON.stringify(session));
    localStorage.setItem('ra_prefill', JSON.stringify(session));
    if(!$('remember') || $('remember').checked){
      localStorage.setItem('ra_remember', JSON.stringify(session));
    }
    track('login', {firm, mobile:mob});
    enter();
  }
  let _searchLogTimer=null;
  function track(event, extra){
    try{ fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({event, portal:'honda',
        firm:(session&&session.firm)||'', mobile:(session&&session.contact)||''}, extra||{})),
      keepalive:true}).catch(()=>{}); }catch(e){}
  }
  function enter(){
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    boot();
  }

  // ── per-user persistence (survives logout / long gaps, same device) ──
  const userKey = () => (session.firm+'|'+session.contact).toLowerCase().replace(/[^a-z0-9|]/g,'');
  const basketKey = () => 'honda_basket_'+userKey();
  const ordersKey = () => 'ra_orders_'+userKey();     // shared with Aerostar
  function saveBasket(){ try{
    const slim={}; for(const k in basket){ const b=basket[k]; slim[k]={part_no:b.part.part_no, qty:b.qty}; }
    localStorage.setItem(basketKey(), JSON.stringify(slim));
  }catch(e){} }
  function loadBasket(){ try{
    const raw=JSON.parse(localStorage.getItem(basketKey())||'null'); basket={};
    if(raw && parts.length){ for(const k in raw){ const p=findPart(k); if(p) basket[k]={part:p,qty:raw[k].qty}; } }
    updateBadge();
  }catch(e){ basket={}; } }
  function getOrders(){ try{ return JSON.parse(localStorage.getItem(ordersKey())||'[]'); }catch(e){ return []; } }
  function saveOrder(rec){ try{ const o=getOrders(); o.unshift(rec); localStorage.setItem(ordersKey(), JSON.stringify(o.slice(0,50))); }catch(e){} }

  async function boot(){
    if(!DATA){
      try{
        const r=await fetch('/api/honda/data?v=20260623-8'); DATA=await r.json();
        parts=DATA.parts||[];
        searchIndex=parts.map(p=>({p, s:normHay(p)}));
        parts.forEach(p=>partIndex[p.part_no]=p);
        try{ CATALOG=await (await fetch('/api/honda/catalog2')).json(); META=(CATALOG&&CATALOG.meta)||{}; }catch(_){ CATALOG=null; }
      }catch(e){ $('main').innerHTML='<div class="empty">Failed to load parts. Please refresh.</div>'; return; }
    }
    loadBasket();     // restore this user's saved basket (parts are loaded now)
    try{
      const nr=await fetch('/api/honda/new'); const nd=await nr.json();
      newBatches=nd.batches||[]; newSet=new Set(newBatches.flatMap(b=>b.part_nos));
    }catch(e){ newBatches=[]; newSet=new Set(); }
    home();
  }

  // ── navigation ──────────────────────────────────────
  function go(view, arg, push=true){
    if(push) stack.push({view, arg});
    if(view==='home') renderHome();
    else if(view==='family') renderFamily(arg);
    else if(view==='variant') renderVariant(arg);
    else if(view==='vehicle') renderVehicle(arg);
    else if(view==='search') renderSearch(arg);
    else if(view==='all') renderAll();
    else if(view==='common') renderCommon();
    else if(view==='vin') renderVin();
    else if(view==='one') renderOne(arg);
    else if(view==='new') renderNewArrivals();
    window.scrollTo(0,0);
  }
  function home(){ stack=[]; if($('search')) $('search').value=''; go('home',null,true); }
  function back(){
    if(stack.length>1){ stack.pop(); const t=stack[stack.length-1]; go(t.view,t.arg,false); }
    else home();
  }

  // ── views ───────────────────────────────────────────
  function renderHome(){
    const total=META.total||parts.length;
    const nCommon=META.common||0;
    // vehicle-number lookup — fastest path to the exact model's parts
    let html=`<div class="vinbox">
        <div class="vinh">🏍️ Gaadi ka number daalo — turant sahi parts</div>
        <div class="vinrow">
          <input id="vinInput" autocomplete="off" placeholder="MH31 AB 1234"
            onkeydown="if(event.key==='Enter')H.lookupVin()">
          <button id="vinBtn" class="vinbtn" onclick="H.lookupVin()">Parts dekho</button>
        </div>
        <div class="vinnote">Number plate se aapki Honda ka exact model apne aap mil jayega</div>
      </div>
      <div class="crumb"><b>Ya browse karo</b> — full range, vehicle, ya part search</div>
      <div class="vgrid" style="margin-bottom:22px">
        ${newSet.size?`<div class="vcard vcard-new" onclick="H.openNew()">
          <div class="vic">🆕</div><b>New Arrivals</b><small>${newSet.size} newly received part${newSet.size!==1?'s':''}</small></div>`:''}
        <div class="vcard vcard-hero" onclick="H.openAll()">
          <div class="vic">📋</div>
          <b>Full product range</b><small>All ${total} Honda parts</small>
        </div>
        ${nCommon?`<div class="vcard" onclick="H.openCommon()">
          <div class="vic">🔧</div><b>Common parts</b><small>${nCommon} parts fitting many models · ✓ = humare paas</small></div>`:''}
      </div>`;
    // New catalogue browse: model search + Scooters / Motorcycles → family
    if(CATALOG){
      html+=`<div class="searchbox" style="margin:4px 0 18px"><span class="si">🔍</span>
        <input id="modelSearch" placeholder="Gaadi dhoondo — Activa, Shine SP, SP125, Dio…" oninput="H.filterModels()"></div>
        <div id="modelResults">${catalogFamiliesHTML('')}</div>`;
    }
    $('main').innerHTML=html;
  }
  function catalogFamiliesHTML(q){
    q=(q||'').toLowerCase().trim();
    let html='';
    for(const [cat,label,icon] of [['scooters','Scooters','🛵'],['motorcycles','Motorcycles','🏍️']]){
      let fams=(CATALOG[cat]||[]);
      if(q) fams=fams.filter(f=>(f.q||f.name.toLowerCase()).includes(q));
      if(!fams.length) continue;
      html+=`<div class="sectitle">${icon} ${label}</div><div class="vgrid" style="margin-bottom:20px">`+
        fams.map(f=>`<div class="vcard" onclick="H.openFamily('${esc(f.family)}')">
          <div class="vic">${icon}</div><b>${esc(f.name)}</b>
          <small>${(f.sections||[]).length} model${(f.sections||[]).length!==1?'s':''}</small></div>`).join('')+`</div>`;
    }
    return html || '<div class="empty">Koi gaadi nahi mili — dusra naam try karo</div>';
  }
  function filterModels(){ const q=($('modelSearch').value||''); $('modelResults').innerHTML=catalogFamiliesHTML(q); }

  // family -> its generation sections (each with distinct variants)
  function findFamily(fam){
    if(!CATALOG) return null;
    return (CATALOG.scooters||[]).concat(CATALOG.motorcycles||[]).find(f=>f.family===fam);
  }
  // A super-family (Shine/Unicorn/Activa) has sections (line·generation); each
  // section has DISTINCT variants (Disc vs Drum, ABS…) shown as separate cards.
  function renderFamily(fam){
    const f=findFamily(fam); if(!f){ home(); return; }
    let html=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>${esc(f.name)}</b></div>
      <div class="sectitle">${esc(f.name)} — apni gaadi chuno</div>`;
    (f.sections||[]).forEach((s,si)=>{
      html+=`<div class="secthdr"><b>${esc(s.label)}</b>${s.years?`<small>${esc(s.years)}</small>`:''}</div>
        <div class="vgrid" style="margin-bottom:16px">`+
        (s.variants||[]).map((v,vi)=>`<div class="vcard vcard-var" onclick="H.openVariant('${esc(fam)}','${si}','${vi}')">
          <b>${esc(v.desc||'Standard')}</b>
          <small>${esc((v.codes||[]).join(', '))}</small>
          <div class="vcount">${v.nparts} parts <span class="vok">${v.nreg} ✓</span></div></div>`).join('')+`</div>`;
    });
    $('main').innerHTML=html;
  }

  // one variant -> its parts in ONE list (procured ✓ first, NS removed)
  let grpState=null;   // {key, list, shown, src}
  async function renderVariant(arg){
    const [fam,si,vi]=arg.split('|'); const f=findFamily(fam);
    const s=f&&(f.sections||[])[+si]; const v=s&&(s.variants||[])[+vi];
    if(!v){ home(); return; }
    const key=fam+'|'+si+'|'+vi;
    const crumb=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> ›
      <span style="cursor:pointer" onclick="H.openFamily('${esc(fam)}')">${esc(f.name)}</span> ›
      <b>${esc(s.label)}${v.desc?' · '+esc(v.desc):''}</b></div>`;
    $('main').innerHTML=crumb+'<div class="empty">Parts la rahe hain…</div>';
    if(!groupCache[key]){
      try{
        const d=await (await fetch('/api/honda/group-parts?ids='+encodeURIComponent((v.model_ids||[]).join(',')))).json();
        const all=(d.parts||[]).map(adaptPart);   // backend already sorts procured-first
        all.forEach(p=>{ if(!partIndex[p.part_no]) partIndex[p.part_no]=p; });
        groupCache[key]={all, nreg:all.filter(p=>p._regular).length};
      }catch(e){ $('main').innerHTML=crumb+'<div class="empty">Parts load nahi hue. Refresh karo.</div>'; return; }
    }
    const gc=groupCache[key];
    const title=`${esc(s.label)}${v.desc?' · '+esc(v.desc):''} — ${gc.all.length} parts <span style="color:var(--success)">(${gc.nreg} humare paas ✓)</span>`;
    mountList(crumb, title, gc.all);
  }

  // ── shared lazy list (used by variant / full range / common / vin) ──
  function mountList(crumb, titleHTML, list, ph, headHTML){
    $('main').innerHTML=crumb+(headHTML||'')+`
      <div class="sectitle">${titleHTML}</div>
      <div class="searchbox" style="margin-bottom:12px"><span class="si">🔍</span>
        <input id="grpSearch" placeholder="${ph||'Part number ya naam se dhoondo…'}" oninput="H.filterGroup()"></div>
      <div class="plist" id="grpList"></div>`;
    grpState={key:'_list', list, shown:0, src:list};
    appendGroup(150);
  }
  function appendGroup(n){
    if(!grpState || !$('grpList')) return;
    const next=grpState.list.slice(grpState.shown, grpState.shown+(n||120));
    if(!next.length) return;
    $('grpList').insertAdjacentHTML('beforeend', next.map(p=>rowHTML(p)).join(''));
    grpState.shown+=next.length;
  }
  function filterGroup(){
    if(!grpState) return;
    const src=grpState.src || (groupCache[grpState.key]&&groupCache[grpState.key].all) || [];
    const q=($('grpSearch').value||'').toLowerCase().trim();
    grpState.list = q ? src.filter(p=>matchQ(p,q)) : src;
    grpState.shown=0; $('grpList').innerHTML='';
    appendGroup(150);
  }
  // catalogue part {pn,desc,section,illus,regular,mrp} -> internal part shape
  function adaptPart(p){
    return {part_no:p.pn, name:p.desc, price:p.mrp, unit:'', vehicles:[],
            common_all:false, _regular:!!p.regular, _section:p.section, _illus:p.illus};
  }
  // full/common catalogue part {pn,desc,families,n_models,regular,mrp}
  function adaptFullPart(p){
    return {part_no:p.pn, name:p.desc, price:p.mrp, unit:'', vehicles:p.families||[],
            common_all:false, _regular:!!p.regular, _nmodels:p.n_models||0};
  }

  // ── new arrivals ────────────────────────────────────
  function fbatch(b){ try{ return new Date(b+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}); }catch(e){ return b; } }
  function renderNewArrivals(){
    const byPn=Object.fromEntries(parts.map(p=>[p.part_no,p]));
    let html=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>New Arrivals</b></div>
      <div class="sectitle">🆕 Newly received parts — ${newSet.size}</div>`;
    for(const bt of newBatches){
      const list=bt.part_nos.map(pn=>byPn[pn]).filter(Boolean);
      if(!list.length) continue;
      html+=`<div class="batch-line">📦 Received ${esc(fbatch(bt.batch))} · ${list.length} part${list.length!==1?'s':''}</div>
        <div class="plist" style="margin-bottom:18px">${list.map(p=>rowHTML(p)).join('')}</div>`;
    }
    $('main').innerHTML=html;
  }

  // ── full product range — the TOTAL catalogue (lazy 30k) ──────
  async function renderAll(){
    const crumb=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>Full product range</b></div>`;
    $('main').innerHTML=crumb+'<div class="empty">Poori list la rahe hain…</div>';
    if(!fullParts){
      try{
        const d=await (await fetch('/api/honda/allparts')).json();
        fullParts=(d.parts||[]).map(adaptFullPart)
          .sort((a,b)=>(a._regular===b._regular)?a.part_no.localeCompare(b.part_no):(a._regular?-1:1));
        fullParts.forEach(p=>{ if(!partIndex[p.part_no]) partIndex[p.part_no]=p; });
      }catch(e){ $('main').innerHTML=crumb+'<div class="empty">Load nahi hua. Refresh karo.</div>'; return; }
    }
    const nreg=fullParts.filter(p=>p._regular).length;
    mountList(crumb, `Full product range — ${fullParts.length} parts <span style="color:var(--success)">(${nreg} humare paas ✓)</span>`,
      fullParts, 'Filter all Honda parts…');
  }

  // ── parts common across many vehicles (backend fitment data) ──
  async function renderCommon(){
    const crumb=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>Common parts</b></div>`;
    $('main').innerHTML=crumb+'<div class="empty">Common parts la rahe hain…</div>';
    if(!commonParts){
      try{
        const d=await (await fetch('/api/honda/common')).json();
        commonParts=(d.parts||[]).map(adaptFullPart);   // already sorted most-shared first
        commonParts.forEach(p=>{ if(!partIndex[p.part_no]) partIndex[p.part_no]=p; });
      }catch(e){ $('main').innerHTML=crumb+'<div class="empty">Load nahi hua. Refresh karo.</div>'; return; }
    }
    const nreg=commonParts.filter(p=>p._regular).length;
    mountList(crumb, `Common parts — ${commonParts.length} fit many models <span style="color:var(--success)">(${nreg} humare paas ✓)</span>`,
      commonParts, 'Filter common parts…');
  }

  function partsForVehicle(v){
    if(v==='ALL MODELS')
      return parts.filter(p=>p.common_all).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    const own=parts.filter(p=>!p.common_all&&(p.vehicles||[]).includes(v));
    const common=parts.filter(p=>p.common_all);
    return own.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).concat(common);
  }

  function renderVehicle(v){
    const list=partsForVehicle(v);
    const title = v==='OTHER' ? 'Universal / Other' : (v==='ALL MODELS' ? 'All-model parts' : v);
    $('main').innerHTML=`
      <div class="crumb"><span style="cursor:pointer" onclick="H.home()">Vehicles</span> › <b>${esc(title)}</b></div>
      <div class="sectitle">${esc(title)} — ${list.length} parts</div>
      <div class="searchbox" style="margin-bottom:14px">
        <span class="si">🔍</span>
        <input id="vehSearch" placeholder="Filter within ${esc(title)}…" oninput="H.filterVehicle('${esc(v)}')">
      </div>
      <div class="plist" id="vehList">${list.map(p=>rowHTML(p,v)).join('')}</div>`;
  }
  function filterVehicle(v){
    const q=($('vehSearch').value||'').toLowerCase().trim();
    let list=partsForVehicle(v);
    if(q) list=list.filter(p=>matchQ(p,q));
    $('vehList').innerHTML = list.length ? list.map(p=>rowHTML(p,v)).join('') : '<div class="empty">No matching parts</div>';
  }

  function matchQ(p,q){
    const hay=normHay(p);
    return qWords(q).every(w=>hay.includes(w));
  }

  // ── vehicle-number lookup (VAHAN -> exact model -> parts) ──
  let vinResult=null;
  function vehCardHTML(v, reg){
    const rows=[['Gaadi', reg], ['Model', v&&v.model], ['Saal', v&&v.year],
                ['Rang', v&&v.colour], ['Chassis', v&&v.chassis]].filter(x=>x[1]);
    if(!rows.length) return '';
    return `<div class="vehcard">`+rows.map(r=>
      `<div class="vcr"><span>${r[0]}</span><b>${esc(String(r[1]))}</b></div>`).join('')+`</div>`;
  }
  async function lookupVin(){
    const el=$('vinInput'); if(!el) return;
    const reg=(el.value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!reg){ toast('Gaadi ka number daalo'); return; }
    const btn=$('vinBtn'); if(btn){ btn.disabled=true; btn.textContent='Dhoond rahe hain…'; }
    try{
      const r=await fetch('/api/honda/resolve-vehicle',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({reg_number:reg, firm:session.firm, contact:session.contact})});
      vinResult=await r.json();
    }catch(e){ vinResult={resolved:false, error:'Network problem. Dubara try karo.'}; }
    vinResult._reg=reg;
    if(btn){ btn.disabled=false; btn.textContent='Parts dekho'; }
    go('vin',null,true);
  }
  async function fetchAndMount(crumb, titlePrefix, model_ids, head){
    $('main').innerHTML=crumb+(head||'')+'<div class="empty">Parts la rahe hain…</div>';
    const ids=(model_ids||[]).filter(Boolean);
    let all=[];
    try{
      const d=await (await fetch('/api/honda/group-parts?ids='+encodeURIComponent(ids.join(',')))).json();
      all=(d.parts||[]).map(adaptPart);
      all.forEach(p=>{ if(!partIndex[p.part_no]) partIndex[p.part_no]=p; });
    }catch(e){ $('main').innerHTML=crumb+(head||'')+'<div class="empty">Parts load nahi hue. Refresh karo.</div>'; return; }
    const nreg=all.filter(p=>p._regular).length;
    mountList(crumb, `${titlePrefix} — ${all.length} parts <span style="color:var(--success)">(${nreg} humare paas ✓)</span>`,
      all, 'Part number ya naam se dhoondo…', head);
  }
  function renderVin(){
    const vr=vinResult||{};
    const crumb=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>Gaadi se parts</b></div>`;
    const veh=vehCardHTML(vr.vehicle, vr._reg);
    if(vr.resolved){
      const head=veh+`<div class="vinmodel">✅ Model milgaya: <b>${esc(vr.model_code||'')}</b>${vr.desc?' · '+esc(vr.desc):''}</div>`;
      fetchAndMount(crumb, 'Aapki gaadi ke parts', vr.model_ids, head);
      return;
    }
    if(vr.needs_filter){
      const q=vr.question||{};
      let html=crumb+veh+`<div class="vinask">${esc(q.ask||'Ek baat batao')}</div><div class="vgrid">`;
      (q.options||[]).forEach((o,i)=>{
        html+=`<div class="vcard vcard-var" onclick="H.vinPick(${i})"><b>${esc(o.label||('Option '+(i+1)))}</b>
          <small>${(o.model_ids||[]).length} model</small></div>`;
      });
      $('main').innerHTML=html+`</div>`;
      return;
    }
    $('main').innerHTML=crumb+veh+`<div class="empty">${esc(vr.error||'Kuch galat hua. Dubara try karo.')}</div>
      <div style="text-align:center;margin-top:14px"><button class="padd" onclick="H.home()">↩ Wapas jao</button></div>`;
  }
  function vinPick(i){
    const vr=vinResult||{}; const o=(vr.question&&vr.question.options||[])[i]; if(!o) return;
    const crumb=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> ›
      <span style="cursor:pointer" onclick="H.reopenVin()">Gaadi se parts</span> › <b>${esc(o.label||'')}</b></div>`;
    fetchAndMount(crumb, esc(o.label||'Aapki gaadi ke parts'), o.model_ids,
      vehCardHTML(vr.vehicle, vr._reg));
  }

  // ── search (Aerostar-style: live dropdown + Enter for full results) ──
  function searchHits(q){
    const words=qWords(q);
    if(!words.length) return [];
    return searchIndex.filter(x=>words.every(w=>x.s.includes(w))).map(x=>x.p);
  }
  function onSearch(){
    const q=($('search').value||'').trim();
    const clr=$('searchClear'); if(clr) clr.classList.toggle('show', !!q);
    if(!q){ hideDD(); return; }
    if(q.length>=3){ clearTimeout(_searchLogTimer);
      _searchLogTimer=setTimeout(()=>track('search',{detail:q.slice(0,60)}),1000); }
    renderDD(searchHits(q).slice(0,40), q);
  }
  function renderDD(results, q){
    const dd=$('searchDD'); searchFocusIdx=-1;
    if(!results.length){ dd.innerHTML=`<div class="search-none">No parts match “${esc(q)}”</div>`; dd.classList.remove('hidden'); return; }
    dd.innerHTML=`<div class="search-ddh">${results.length}${results.length===40?'+':''} result${results.length!==1?'s':''} — press Enter to see all</div>`+
      results.map((p,i)=>{
        const veh=(p.common_all?['ALL MODELS']:(p.vehicles||[])).filter(v=>v!=='OTHER').join(' · ');
        return `<div class="search-it" data-idx="${i}" onmousedown="H.pick('${esc(p.part_no)}')" onmouseover="H.focusDD(${i})">
          <div class="si-b"><div class="si-n">${hl(p.name,q)}</div>
            <div class="si-m"><span class="pn">${hl(p.part_no,q)}</span>${veh?`<span>${hl(veh,q)}</span>`:''}</div></div>
          <div class="si-p">${inr(p.price)}</div></div>`;
      }).join('');
    dd.classList.remove('hidden');
  }
  function hl(text,q){
    let s=esc(text);
    q.toLowerCase().split(/\s+/).filter(Boolean).forEach(w=>{
      const rx=new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');
      s=s.replace(rx,'<mark>$1</mark>');
    });
    return s;
  }
  function hideDD(){ const dd=$('searchDD'); if(dd) dd.classList.add('hidden'); searchFocusIdx=-1; }
  function focusDD(i){ searchFocusIdx=i; document.querySelectorAll('#searchDD .search-it').forEach((el,j)=>el.classList.toggle('foc',j===i)); }
  function clearSearch(){ const s=$('search'); if(s) s.value=''; const c=$('searchClear'); if(c) c.classList.remove('show'); hideDD(); }
  function onSearchKey(e){
    const items=document.querySelectorAll('#searchDD .search-it');
    if(e.key==='ArrowDown'){ e.preventDefault(); if(items.length){ searchFocusIdx=Math.min(searchFocusIdx+1,items.length-1); markFoc(items);} }
    else if(e.key==='ArrowUp'){ e.preventDefault(); if(items.length){ searchFocusIdx=Math.max(searchFocusIdx-1,0); markFoc(items);} }
    else if(e.key==='Enter'){ e.preventDefault();
      if(searchFocusIdx>=0 && items[searchFocusIdx]){ items[searchFocusIdx].dispatchEvent(new MouseEvent('mousedown')); }
      else { showResults(($('search').value||'').trim()); } }
    else if(e.key==='Escape'){ hideDD(); }
  }
  function markFoc(items){ items.forEach((el,i)=>{ el.classList.toggle('foc',i===searchFocusIdx); if(i===searchFocusIdx) el.scrollIntoView({block:'nearest'}); }); }
  function pick(pn){ hideDD(); const p=findPart(pn); if(!p) return; clearSearch(); go('one', p, true); }
  function showResults(q){ if(!q) return; hideDD(); go('search', q, true); }

  function renderOne(p){
    $('main').innerHTML=`
      <div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>${esc(p.part_no)}</b></div>
      <div class="sectitle">Part ${esc(p.part_no)}</div>
      <div class="plist">${rowHTML(p)}</div>`;
  }
  function renderSearch(q){
    const list=searchHits(q).slice(0,300);
    $('main').innerHTML=`
      <div class="crumb">Search results for <b>“${esc(q)}”</b></div>
      <div class="sectitle">${list.length} part${list.length!==1?'s':''} found${list.length===300?' (first 300)':''}</div>
      <div class="plist">${list.length?list.map(p=>rowHTML(p)).join(''):'<div class="empty">No parts match your search</div>'}</div>`;
  }

  // ── part row ────────────────────────────────────────
  function rowHTML(p, ctx){
    const inCart=basket[p.part_no];
    const vehicles = (p.common_all ? ['ALL MODELS'] : (p.vehicles||[])).filter(v=>v!=='OTHER');
    const newChip = newSet.has(p.part_no) ? '<span class="chip newc">🆕 NEW</span>' : '';
    const fitChip = (p._nmodels && p._nmodels>1) ? `<span class="chip all">🔧 ${p._nmodels} models</span>` : '';
    const shown=vehicles.slice(0,4);
    const chips=newChip+fitChip+shown
      .map(v=>`<span class="chip${v==='ALL MODELS'?' all':''}">${esc(v)}</span>`).join('')
      +(vehicles.length>shown.length?`<span class="chip">+${vehicles.length-shown.length}</span>`:'');
    const ctrl = inCart ? qstepHTML(p) : `<button class="padd" onclick="H.add('${esc(p.part_no)}')">+ Add</button>`;
    const tick = p._regular ? '<span class="rtick" title="Hum yeh part regular rakhte hain">✓</span> ' : '';
    return `<div class="prow ${inCart?'in':''}" id="row-${cssid(p.part_no)}">
      <div class="pinfo">
        <div class="pname">${tick}${esc(p.name)}</div>
        <div class="pmeta"><span class="pn">${esc(p.part_no)}</span>${chips}${p.unit?`<span>· ${esc(p.unit)}</span>`:''}
          <button class="flagbtn" title="Report wrong fitment / add vehicles"
            onclick="H.openFeedback('${esc(p.part_no)}')">🚩</button></div>
      </div>
      <div class="pprice">${inr(p.price)}</div>
      <div id="ctrl-${cssid(p.part_no)}">${ctrl}</div>
    </div>`;
  }
  function qstepHTML(p){
    const q=basket[p.part_no]?.qty||1;
    return `<div class="qstep">
      <button onclick="H.dec('${esc(p.part_no)}')">−</button>
      <input type="number" min="1" value="${q}" onchange="H.setQty('${esc(p.part_no)}',this.value)">
      <button onclick="H.inc('${esc(p.part_no)}')">+</button></div>`;
  }

  // ── fitment feedback ────────────────────────────────
  let fbPart=null;
  function openFeedback(pn){
    fbPart=findPart(pn); if(!fbPart) return;
    $('fbName').textContent=fbPart.name;
    $('fbPN').textContent=fbPart.part_no;
    $('fbCur').textContent=(fbPart.common_all?['ALL MODELS']:(fbPart.vehicles||[])).join(', ')||'—';
    $('fbText').value='';
    $('fbOverlay').classList.add('show'); $('fbModal').classList.add('show');
  }
  function closeFeedback(){ $('fbOverlay').classList.remove('show'); $('fbModal').classList.remove('show'); fbPart=null; }
  async function sendFeedback(){
    const txt=$('fbText').value.trim();
    if(!txt){ toast('Please write your comment'); return; }
    const body={ part_no:fbPart.part_no, name:fbPart.name,
      vehicles:fbPart.common_all?['ALL MODELS']:(fbPart.vehicles||[]),
      comment:txt, firm:session.firm, contact:session.contact };
    try{
      const r=await fetch('/api/honda/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const res=await r.json();
      if(res.success){ closeFeedback(); toast('✅ Thanks! Fitment feedback sent'); }
      else toast('⚠ '+(res.error||'Could not send'));
    }catch(e){ toast('⚠ Network error, please retry'); }
  }

  // ── basket ──────────────────────────────────────────
  function findPart(pn){ return partIndex[pn] || parts.find(p=>p.part_no===pn); }
  function add(pn){ const p=findPart(pn); if(!p) return; basket[pn]={part:p,qty:1}; refreshRow(pn); updateBadge(); saveBasket(); toast('Added to order'); }
  function inc(pn){ if(basket[pn]){ basket[pn].qty++; refreshRow(pn); updateBadge(); saveBasket(); } }
  function dec(pn){ if(basket[pn]){ basket[pn].qty--; if(basket[pn].qty<=0) delete basket[pn]; refreshRow(pn); updateBadge(); saveBasket(); } }
  function setQty(pn,v){ v=parseInt(v)||0; if(v<=0){ delete basket[pn]; } else if(basket[pn]){ basket[pn].qty=v; } refreshRow(pn); updateBadge(); saveBasket(); }
  function refreshRow(pn){
    const row=$('row-'+cssid(pn)), ctrl=$('ctrl-'+cssid(pn)); const p=findPart(pn);
    if(ctrl&&p) ctrl.innerHTML = basket[pn] ? qstepHTML(p) : `<button class="padd" onclick="H.add('${esc(pn)}')">+ Add</button>`;
    if(row) row.classList.toggle('in', !!basket[pn]);
    if($('drawer').classList.contains('show')) renderCart();
  }
  function updateBadge(){
    const n=Object.keys(basket).length, b=$('badge');
    b.textContent=n; b.classList.toggle('hidden', n===0);
  }

  function openCart(){ renderCart(); $('overlay').classList.add('show'); $('drawer').classList.add('show'); }
  function closeCart(){ $('overlay').classList.remove('show'); $('drawer').classList.remove('show'); }
  function renderCart(){
    const items=Object.values(basket);
    $('ditems').innerHTML = items.length ? items.map(({part:p,qty})=>`
      <div class="ditem">
        <div class="dn">${esc(p.name)}</div>
        <div class="dm"><span class="pn">${esc(p.part_no)}</span><span>${inr(p.price)} × ${qty}</span></div>
        <div class="dm">
          <div class="qstep">
            <button onclick="H.dec('${esc(p.part_no)}')">−</button>
            <input type="number" min="1" value="${qty}" onchange="H.setQty('${esc(p.part_no)}',this.value)">
            <button onclick="H.inc('${esc(p.part_no)}')">+</button>
          </div>
          <button class="drm" onclick="H.remove('${esc(p.part_no)}')">Remove</button>
        </div>
      </div>`).join('') : '<div class="empty">Your order is empty</div>';
    const nItems=items.length, qty=items.reduce((s,i)=>s+i.qty,0);
    const tot=items.reduce((s,i)=>s+(i.part.price||0)*i.qty,0);
    $('cItems').textContent=nItems; $('cQty').textContent=qty; $('cTot').textContent=inr(tot);
  }
  function remove(pn){ delete basket[pn]; refreshRow(pn); updateBadge(); saveBasket(); renderCart(); }

  // ── confirm & place order (Aerostar-style modal) ────
  function openCheckout(){
    const items=Object.values(basket);
    if(!items.length){ toast('Your order is empty'); return; }
    closeCart();
    $('coFirm').value=session.firm; $('coContact').value=session.contact;
    const qty=items.reduce((s,i)=>s+i.qty,0);
    $('coItems').textContent=`${items.length} item${items.length!==1?'s':''} · ${qty} pcs`;
    $('coList').innerHTML=items.map(({part:p,qty})=>`
      <div class="cm-li"><span class="pn">${esc(p.part_no)}</span>
        <span class="cl-d">${esc(p.name)}</span><span class="cl-q">×${qty}</span></div>`).join('');
    const m=$('coMsg'); m.className='cm-msg hidden';
    const b=$('coBtn'); b.disabled=false; b.textContent='✓ Place Order & Send';
    $('coOverlay').classList.add('show'); $('coModal').classList.add('show');
  }
  function closeCheckout(){ $('coOverlay').classList.remove('show'); $('coModal').classList.remove('show'); }

  async function placeOrder(){
    const items=Object.values(basket);
    if(!items.length){ return; }
    const b=$('coBtn'), m=$('coMsg');
    b.disabled=true; b.textContent='Placing order…';
    const firm=($('coFirm').value.trim()||session.firm);
    const contact=($('coContact').value.trim()||session.contact);
    const oid=Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const lines=items.map(({part:p,qty})=>({
      as_part_number:p.part_no, sai_part_number:p.code||'', description:p.name,
      vehicle:(p.common_all?['ALL MODELS']:(p.vehicles||[])).filter(v=>v!=='OTHER').join(', '),
      colour:p.unit||'', mrp:p.price, qty}));
    try{
      const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({firm_name:firm, contact_number:contact, portal:'honda', oid, items:lines})});
      const res=await r.json();
      if(res.success){
        saveOrder({oid, ts:Date.now(), portal:'honda',
          totalQty:items.reduce((s,i)=>s+i.qty,0),
          totalAmt:items.reduce((s,i)=>s+(i.part.price||0)*i.qty,0),
          items:items.map(({part:p,qty})=>({part_no:p.part_no, name:p.name, price:p.price, qty}))});
        m.className='cm-msg ok'; m.innerHTML='✅ Order placed!<br><small>📲 Notifying Rupani Automobiles on WhatsApp…</small>';
        if(res.download){ const a=document.createElement('a'); a.href='/download/'+res.download; a.download=res.download; a.click(); }
        b.textContent='✓ Order Placed!';
        basket={}; updateBadge(); saveBasket(); renderCart();
        setTimeout(closeCheckout,4500);
      } else {
        m.className='cm-msg err'; m.textContent=res.error||'Something went wrong.';
        b.disabled=false; b.textContent='✓ Place Order & Send';
      }
    }catch(e){ m.className='cm-msg err'; m.textContent='Network error, please retry.';
      b.disabled=false; b.textContent='✓ Place Order & Send'; }
  }

  // ── previous orders (server-backed, cross-device by mobile) ─────────
  let _ordersView=[];
  function mergeOrders(local,server){
    const map={};
    (server||[]).concat(local||[]).forEach(o=>{ const k=o.oid||('L'+o.ts); if(!map[k]) map[k]=o; });
    return Object.values(map).sort((a,b)=>(b.ts||0)-(a.ts||0));
  }
  async function openOrders(){
    $('ordBody').innerHTML='<div class="empty">Loading your orders…</div>';
    $('ordOverlay').classList.add('show'); $('ordModal').classList.add('show');
    let orders=getOrders();
    try{ const r=await fetch('/api/orders?contact='+encodeURIComponent(session.contact||''));
      if(r.ok) orders=mergeOrders(orders, await r.json()); }catch(e){}
    renderOrders(orders);
  }
  function renderOrders(orders){
    _ordersView=orders;
    $('ordBody').innerHTML = orders.length ? orders.map((o,idx)=>{
      const d=new Date(o.ts);
      const when=d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' · '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      const tag=o.portal==='honda'?'<span class="ord-tag">Honda</span>':'<span class="ord-tag aero">Aerostar</span>';
      const st=o.status||'pending';
      const stLbl={pending:'⏳ Pending',partial:'🚚 Partly sent',dispatched:'✅ Dispatched'}[st]||'⏳ Pending';
      const lines=o.items.map(it=>{
        const disp=Math.min(it.disp||0,it.qty);
        const s=disp>=it.qty?'<span class="oi-ok">✓ sent</span>'
              :disp>0?`<span class="oi-part">${disp}/${it.qty} sent · ${it.qty-disp} pending</span>`
              :'<span class="oi-pend">pending</span>';
        const alt=it.alt?` <span class="oi-alt">↔ sent as ${esc(it.alt)}</span>`:'';
        return `${esc(it.name)} <b>×${it.qty}</b> — ${s}${alt}`;
      }).join('<br>');
      const reorder=(o.portal==='honda')?`<button class="ord-reorder" onclick="H.reorder(${idx})">↺ Add these to cart</button>`:'';
      return `<div class="ord-card"><div class="ord-top"><span class="ord-date">${when}</span>
        <span style="display:flex;gap:6px;align-items:center"><span class="ord-st ${st}">${stLbl}</span>${tag}</span></div>
        <div class="ord-meta">${o.items.length} item(s) · ${o.totalQty} pcs · ₹${Number(o.totalAmt||0).toLocaleString('en-IN')}</div>
        <div class="ord-lines">${lines}</div>${reorder}</div>`;
    }).join('') : '<div class="empty">No previous orders yet. Your placed orders will appear here.</div>';
    $('ordOverlay').classList.add('show'); $('ordModal').classList.add('show');
  }
  function closeOrders(){ $('ordOverlay').classList.remove('show'); $('ordModal').classList.remove('show'); }
  function reorder(idx){
    const o=_ordersView[idx]; if(!o) return;
    let added=0;
    o.items.forEach(it=>{ const p=findPart(it.part_no); if(p){ basket[it.part_no]={part:p,qty:(basket[it.part_no]?.qty||0)+it.qty}; added++; } });
    updateBadge(); saveBasket(); closeOrders(); toast(added?`Added ${added} item(s) to cart`:'Those parts are no longer available');
  }

  let toastTimer=null;
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2200); }

  // ── init: auto-enter with shared credentials ─────────
  (function(){
    const s=getShared();
    if(s){ session=s; document.addEventListener('DOMContentLoaded',enter);
           if(document.readyState!=='loading') enter(); }
    else{
      try{ const p=JSON.parse(localStorage.getItem('ra_prefill')||'null');
        if(p&&$('firm')){ $('firm').value=p.firm||''; $('mobile').value=p.contact||''; } }catch(_){}
    }
  })();

  // close dropdown on outside click
  document.addEventListener('click', e=>{ if(!e.target.closest('.searchbox')) hideDD(); });
  // infinite scroll for the generation parts list (no "show all" button)
  window.addEventListener('scroll', ()=>{
    if(grpState && grpState.shown<grpState.list.length &&
       window.innerHeight+window.scrollY >= document.body.offsetHeight-700) appendGroup(120);
  });

  return {
    login, home, back, openVehicle:(v)=>go('vehicle',v,true),
    openFamily:(f)=>go('family',f,true),
    openVariant:(f,s,v)=>go('variant',f+'|'+s+'|'+v,true),
    lookupVin, vinPick, reopenVin:()=>go('vin',null,true),
    filterGroup, filterModels,
    openAll:()=>go('all',null,true), openCommon:()=>go('common',null,true), openNew:()=>go('new',null,true),
    onSearch, onSearchKey, focusDD, clearSearch, pick,
    filterVehicle, add, inc, dec, setQty, remove,
    openCart, closeCart, openCheckout, closeCheckout, placeOrder,
    openOrders, closeOrders, reorder,
    openFeedback, closeFeedback, sendFeedback
  };
})();

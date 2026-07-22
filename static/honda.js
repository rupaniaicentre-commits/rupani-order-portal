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
  let CATALOG = null;        // {scooters:[{family,name,groups}], motorcycles:[...]}
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
        try{ CATALOG=await (await fetch('/api/honda/catalog')).json(); }catch(_){ CATALOG=null; }
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
    else if(view==='group') renderGroup(arg);
    else if(view==='vehicle') renderVehicle(arg);
    else if(view==='search') renderSearch(arg);
    else if(view==='all') renderAll();
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
    const groups=DATA.vehicle_groups||[];
    const nCommon=(DATA.meta&&DATA.meta.common_all_count)||0;
    // full product range first (top)
    let html=`<div class="crumb"><b>Browse the full range</b> or pick a vehicle — search any part above</div>
      <div class="vgrid" style="margin-bottom:22px">
        ${newSet.size?`<div class="vcard vcard-new" onclick="H.openNew()">
          <div class="vic">🆕</div><b>New Arrivals</b><small>${newSet.size} newly received part${newSet.size!==1?'s':''}</small></div>`:''}
        <div class="vcard vcard-hero" onclick="H.openAll()">
          <div class="vic">📋</div>
          <b>Full product range</b><small>All ${parts.length} parts · A→Z</small>
        </div>
        ${nCommon?`<div class="vcard" onclick="H.openVehicle('ALL MODELS')">
          <div class="vic">🔧</div><b>Common to all</b><small>${nCommon} universal part${nCommon!==1?'s':''}</small></div>`:''}
      </div>`;
    // New catalogue browse: Scooters / Motorcycles → family
    if(CATALOG){
      for(const [cat,label,icon] of [['scooters','Scooters','🛵'],['motorcycles','Motorcycles','🏍️']]){
        const fams=CATALOG[cat]||[];
        html+=`<div class="sectitle">${icon} ${label}</div><div class="vgrid" style="margin-bottom:20px">`+
          fams.map(f=>`<div class="vcard" onclick="H.openFamily('${esc(f.family)}')">
            <div class="vic">${icon}</div><b>${esc(f.name)}</b>
            <small>${(f.groups||[]).length} model${(f.groups||[]).length!==1?'s':''}</small></div>`).join('')+`</div>`;
      }
    }
    $('main').innerHTML=html;
  }

  // family -> its generation groups (Activa 6G, 5G ...)
  function findFamily(fam){
    if(!CATALOG) return null;
    return (CATALOG.scooters||[]).concat(CATALOG.motorcycles||[]).find(f=>f.family===fam);
  }
  function renderFamily(fam){
    const f=findFamily(fam); if(!f){ home(); return; }
    let html=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> › <b>${esc(f.name)}</b></div>
      <div class="sectitle">${esc(f.name)} — apni gaadi chuno</div>
      <div class="vgrid">`+
      (f.groups||[]).map((g,i)=>`<div class="vcard" onclick="H.openGroup('${esc(fam)}','${i}')">
        <b>${esc(g.gen)}</b><small>${esc(g.years)}</small></div>`).join('')+`</div>`;
    $('main').innerHTML=html;
  }

  // generation group -> parts (procured first, then "search all")
  async function renderGroup(arg){
    const [fam,idx]=arg.split('|'); const f=findFamily(fam);
    const g=f&&(f.groups||[])[+idx]; if(!g){ home(); return; }
    const key=fam+'|'+idx;
    $('main').innerHTML=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> ›
      <span style="cursor:pointer" onclick="H.openFamily('${esc(fam)}')">${esc(f.name)}</span> › <b>${esc(g.gen)}</b></div>
      <div class="empty">Parts la rahe hain…</div>`;
    if(!groupCache[key]){
      try{
        const d=await (await fetch('/api/honda/group-parts?ids='+encodeURIComponent((g.model_ids||[]).join(',')))).json();
        const all=(d.parts||[]).map(adaptPart);
        all.forEach(p=>{ if(!partIndex[p.part_no]) partIndex[p.part_no]=p; });
        groupCache[key]={all, regular:all.filter(p=>p._regular), name:g.gen};
      }catch(e){ $('main').innerHTML='<div class="empty">Parts load nahi hue. Refresh karo.</div>'; return; }
    }
    const gc=groupCache[key];
    $('main').innerHTML=`<div class="crumb"><span style="cursor:pointer" onclick="H.home()">Home</span> ›
      <span style="cursor:pointer" onclick="H.openFamily('${esc(fam)}')">${esc(f.name)}</span> › <b>${esc(g.gen)}</b></div>
      <div class="sectitle">${esc(gc.name)} — hamare paas ${gc.regular.length} parts</div>
      <div class="plist" id="grpRegular">${gc.regular.length?gc.regular.map(p=>rowHTML(p)).join(''):'<div class="empty">Is model ke liye regular part nahi — neeche saare Honda parts search karo</div>'}</div>
      <div style="text-align:center;margin:18px 0">
        <button class="padd" style="padding:11px 20px;font-size:14px" onclick="H.showAllGroup('${esc(key)}')">🔍 Saare Honda parts dekho (${gc.all.length})</button>
      </div>
      <div id="grpAll"></div>`;
  }
  const GRP_CAP=80;
  function showAllGroup(key){
    const gc=groupCache[key]; if(!gc) return;
    const first=gc.all.slice(0,GRP_CAP);
    $('grpAll').innerHTML=`<div class="sectitle">Saare parts (${gc.all.length}) — search karo</div>
      <div class="searchbox" style="margin-bottom:12px"><span class="si">🔍</span>
      <input id="grpSearch" placeholder="Part number ya naam se dhoondo…" oninput="H.filterGroup('${esc(key)}')"></div>
      <div class="plist" id="grpAllList">${first.map(p=>rowHTML(p)).join('')}</div>
      ${gc.all.length>GRP_CAP?`<div class="empty" id="grpMore">Aur ${gc.all.length-GRP_CAP} parts — upar search karo</div>`:''}`;
    $('grpAll').scrollIntoView({behavior:'smooth'});
  }
  function filterGroup(key){
    const gc=groupCache[key]; if(!gc) return;
    const q=($('grpSearch').value||'').toLowerCase().trim();
    const list=(q?gc.all.filter(p=>matchQ(p,q)):gc.all).slice(0,GRP_CAP);
    const more=$('grpMore'); if(more) more.style.display=q?'none':'block';
    $('grpAllList').innerHTML=list.length?list.map(p=>rowHTML(p)).join(''):'<div class="empty">Koi part nahi mila</div>';
  }
  // catalogue part {pn,desc,section,illus,regular,mrp} -> internal part shape
  function adaptPart(p){
    return {part_no:p.pn, name:p.desc, price:p.mrp, unit:'', vehicles:[],
            common_all:false, _regular:!!p.regular, _section:p.section, _illus:p.illus};
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

  // ── all-parts explorer (sorted by part number) ──────
  let allAsc=true;
  function renderAll(){
    const list=parts.slice().sort((a,b)=>allAsc
      ? a.part_no.localeCompare(b.part_no)
      : b.part_no.localeCompare(a.part_no));
    $('main').innerHTML=`
      <div class="crumb"><span style="cursor:pointer" onclick="H.home()">Vehicles</span> › <b>All parts</b></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">
        <div class="sectitle" style="margin:0">All ${list.length} parts</div>
        <button class="padd" style="background:#eef1f5;color:var(--navy)" onclick="H.toggleSort()">
          Part No ${allAsc?'▲ ascending':'▼ descending'}</button>
      </div>
      <div class="searchbox" style="margin-bottom:14px">
        <span class="si">🔍</span>
        <input id="allSearch" placeholder="Filter all parts…" oninput="H.filterAll()">
      </div>
      <div class="plist" id="allList">${list.map(p=>rowHTML(p)).join('')}</div>`;
  }
  function toggleSort(){ allAsc=!allAsc; renderAll(); }
  function filterAll(){
    const q=($('allSearch').value||'').toLowerCase().trim();
    let list=parts.slice().sort((a,b)=>allAsc
      ? a.part_no.localeCompare(b.part_no)
      : b.part_no.localeCompare(a.part_no));
    if(q) list=list.filter(p=>matchQ(p,q));
    $('allList').innerHTML=list.length?list.map(p=>rowHTML(p)).join(''):'<div class="empty">No matching parts</div>';
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
    const vehicles = p.common_all ? ['ALL MODELS'] : (p.vehicles||[]);
    const newChip = newSet.has(p.part_no) ? '<span class="chip newc">🆕 NEW</span>' : '';
    const chips=newChip+vehicles.filter(v=>v!=='OTHER')
      .map(v=>`<span class="chip${v==='ALL MODELS'?' all':''}">${esc(v)}</span>`).join('');
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

  return {
    login, home, back, openVehicle:(v)=>go('vehicle',v,true),
    openFamily:(f)=>go('family',f,true), openGroup:(f,i)=>go('group',f+'|'+i,true),
    showAllGroup, filterGroup,
    openAll:()=>go('all',null,true), openNew:()=>go('new',null,true), toggleSort, filterAll,
    onSearch, onSearchKey, focusDD, clearSearch, pick,
    filterVehicle, add, inc, dec, setQty, remove,
    openCart, closeCart, openCheckout, closeCheckout, placeOrder,
    openOrders, closeOrders, reorder,
    openFeedback, closeFeedback, sendFeedback
  };
})();

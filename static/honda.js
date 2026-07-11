'use strict';
/* ══════════════════════════════════════════════════════
   RUPANI AUTOMOBILES — HONDA PARTS PORTAL  (honda.js)
   Variant-level vehicles, union fitment, universal search,
   customer fitment feedback.
   ══════════════════════════════════════════════════════ */
const H = (() => {
  let DATA = null;           // {vehicle_groups, parts}
  let parts = [];
  let session = { firm:'', contact:'' };
  let basket = {};           // part_no -> {part, qty}
  let stack = [];            // view history: {view, arg}

  const FAMILY_ICON = {
    ACTIVA:'🛵', SHINE:'🏍️', UNICORN:'🏍️', DREAM:'🏍️', DIO:'🛵', LIVO:'🏍️',
    TWISTER:'🏍️', AVIATOR:'🛵', 'CD 110':'🏍️', HORNET:'🏍️', GRAZIA:'🛵',
    STUNNER:'🏍️', NAVI:'🛵', OTHER:'🔩', 'ALL MODELS':'🔧'
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inr = n => n==null ? '—' : '₹'+Number(n).toLocaleString('en-IN');
  const cssid = s => String(s).replace(/[^A-Za-z0-9_-]/g,'_');

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
    enter();
  }
  function enter(){
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    boot();
  }

  async function boot(){
    if(!DATA){
      try{
        const r=await fetch('/api/honda/data'); DATA=await r.json();
        parts=DATA.parts||[];
      }catch(e){ $('main').innerHTML='<div class="empty">Failed to load parts. Please refresh.</div>'; return; }
    }
    home();
  }

  // ── navigation ──────────────────────────────────────
  function go(view, arg, push=true){
    if(push) stack.push({view, arg});
    if(view==='home') renderHome();
    else if(view==='vehicle') renderVehicle(arg);
    else if(view==='search') renderSearch(arg);
    else if(view==='all') renderAll();
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
    let html=`<div class="crumb"><b>Select your vehicle</b> — or search any part above</div>`;
    for(const g of groups){
      const fam=g.family;
      const label = fam==='OTHER' ? 'Universal / Other' : fam;
      html+=`<div class="sectitle">${FAMILY_ICON[fam]||'🏍️'} ${esc(label)}</div>
        <div class="vgrid" style="margin-bottom:20px">`+
        g.vehicles.map(v=>`
          <div class="vcard" onclick="H.openVehicle('${esc(v.name)}')">
            <b>${esc(v.name==='OTHER'?'Universal parts':v.name)}</b>
            <small>${v.part_count} part${v.part_count!==1?'s':''}</small>
          </div>`).join('')+`</div>`;
    }
    if(nCommon){
      html+=`<div class="sectitle">🔧 Common to all models</div>
        <div class="vgrid" style="margin-bottom:20px"><div class="vcard" onclick="H.openVehicle('ALL MODELS')">
          <b>All-model parts</b><small>${nCommon} part${nCommon!==1?'s':''}</small></div></div>`;
    }
    html+=`<div class="sectitle">📋 Explore full catalogue</div>
      <div class="vgrid"><div class="vcard" onclick="H.openAll()">
        <b>All parts A→Z</b><small>${parts.length} parts by part number</small></div></div>`;
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
    const hay=((p.name||'')+' '+(p.part_no||'')+' '+(p.vehicles||[]).join(' ')).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(tok=>hay.includes(tok));
  }

  let searchTimer=null;
  function onSearch(){
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      const q=($('search').value||'').toLowerCase().trim();
      if(!q){ if(stack[stack.length-1]?.view==='search'){ home(); } return; }
      go('search', q, stack[stack.length-1]?.view!=='search');
      if(stack[stack.length-1]?.view==='search') stack[stack.length-1].arg=q;
    },140);
  }
  function renderSearch(q){
    const list=parts.filter(p=>matchQ(p,q)).slice(0,300);
    $('main').innerHTML=`
      <div class="crumb">Search results for <b>“${esc(q)}”</b></div>
      <div class="sectitle">${list.length} part${list.length!==1?'s':''} found${list.length===300?' (showing first 300)':''}</div>
      <div class="plist">${list.length?list.map(p=>rowHTML(p)).join(''):'<div class="empty">No parts match your search</div>'}</div>`;
  }

  // ── part row ────────────────────────────────────────
  function rowHTML(p, ctx){
    const inCart=basket[p.part_no];
    const vehicles = p.common_all ? ['ALL MODELS'] : (p.vehicles||[]);
    const chips=vehicles.filter(v=>v!=='OTHER')
      .map(v=>`<span class="chip${v==='ALL MODELS'?' all':''}">${esc(v)}</span>`).join('');
    const ctrl = inCart ? qstepHTML(p) : `<button class="padd" onclick="H.add('${esc(p.part_no)}')">+ Add</button>`;
    return `<div class="prow ${inCart?'in':''}" id="row-${cssid(p.part_no)}">
      <div class="pinfo">
        <div class="pname">${esc(p.name)}</div>
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
  function findPart(pn){ return parts.find(p=>p.part_no===pn); }
  function add(pn){ const p=findPart(pn); if(!p) return; basket[pn]={part:p,qty:1}; refreshRow(pn); updateBadge(); toast('Added to order'); }
  function inc(pn){ if(basket[pn]){ basket[pn].qty++; refreshRow(pn); updateBadge(); } }
  function dec(pn){ if(basket[pn]){ basket[pn].qty--; if(basket[pn].qty<=0) delete basket[pn]; refreshRow(pn); updateBadge(); } }
  function setQty(pn,v){ v=parseInt(v)||0; if(v<=0){ delete basket[pn]; } else if(basket[pn]){ basket[pn].qty=v; } refreshRow(pn); updateBadge(); }
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
  function remove(pn){ delete basket[pn]; refreshRow(pn); updateBadge(); renderCart(); }

  async function placeOrder(){
    const items=Object.values(basket);
    if(!items.length){ toast('Your order is empty'); return; }
    const payload={
      firm_name:session.firm, contact_number:session.contact, portal:'honda',
      items:items.map(({part:p,qty})=>({
        as_part_number:p.part_no, sai_part_number:p.code||'', description:p.name,
        vehicle:(p.common_all?['ALL MODELS']:(p.vehicles||[])).filter(v=>v!=='OTHER').join(', '),
        colour:p.unit||'', mrp:p.price, qty
      }))
    };
    toast('Placing order…');
    try{
      const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const res=await r.json();
      if(res.success){ basket={}; updateBadge(); renderCart(); closeCart(); toast('✅ Order placed! Sent to Rupani Automobiles'); }
      else toast('⚠ '+(res.error||'Order failed'));
    }catch(e){ toast('⚠ Network error, please retry'); }
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

  return {
    login, home, back, openVehicle:(v)=>go('vehicle',v,true),
    openAll:()=>go('all',null,true), toggleSort, filterAll,
    onSearch, filterVehicle, add, inc, dec, setQty, remove,
    openCart, closeCart, placeOrder,
    openFeedback, closeFeedback, sendFeedback
  };
})();

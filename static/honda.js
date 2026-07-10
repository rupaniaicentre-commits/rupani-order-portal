'use strict';
/* ══════════════════════════════════════════════════════
   RUPANI AUTOMOBILES — HONDA PARTS PORTAL  (honda.js)
   Vehicle-wise Honda genuine parts + universal search.
   ══════════════════════════════════════════════════════ */
const H = (() => {
  let DATA = null;           // {families, vehicles, parts}
  let parts = [];
  let session = { firm:'', contact:'' };
  let basket = {};           // part_no -> {part, qty}
  let stack = [];            // view history: {view, arg}

  const FAMILY_ICON = {
    ACTIVA:'🛵', SHINE:'🏍️', UNICORN:'🏍️', DREAM:'🏍️', DIO:'🛵', LIVO:'🏍️',
    TWISTER:'🏍️', AVIATOR:'🛵', 'CD 110':'🏍️', HORNET:'🏍️', GRAZIA:'🛵',
    STUNNER:'🏍️', NAVI:'🛵', OTHER:'🔩'
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inr = n => n==null ? '—' : '₹'+Number(n).toLocaleString('en-IN');

  // ── login ───────────────────────────────────────────
  function login(){
    const firm=$('firm').value.trim(), mob=$('mobile').value.trim();
    const err=$('lerr');
    if(!firm){ err.textContent='Please enter your firm name'; err.classList.remove('hidden'); return; }
    if(!/^\d{10}$/.test(mob)){ err.textContent='Please enter a valid 10-digit mobile number'; err.classList.remove('hidden'); return; }
    session={firm, contact:mob};
    try{ localStorage.setItem('honda_sess', JSON.stringify(session)); }catch(e){}
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
    else if(view==='family') renderFamily(arg);
    else if(view==='search') renderSearch(arg);
    window.scrollTo(0,0);
  }
  function home(){ stack=[]; $('search').value=''; go('home',null,true); }
  function back(){
    if(stack.length>1){ stack.pop(); const t=stack[stack.length-1]; go(t.view,t.arg,false); }
    else home();
  }

  // ── views ───────────────────────────────────────────
  function renderHome(){
    const fams=DATA.families||[];
    const cards=fams.map(f=>`
      <div class="vcard" onclick="H.openFamily('${esc(f.name)}')">
        <div class="vic">${FAMILY_ICON[f.name]||'🏍️'}</div>
        <b>${esc(f.name==='OTHER'?'Universal / Other':f.name)}</b>
        <small>${f.part_count} part${f.part_count!==1?'s':''}</small>
      </div>`).join('');
    $('main').innerHTML=`
      <div class="crumb"><b>Select a vehicle</b> — or search any part above</div>
      <div class="sectitle">Honda Vehicles</div>
      <div class="vgrid">${cards}</div>`;
  }

  function partsForFamily(fam){
    return parts.filter(p=>(p.families||[]).includes(fam))
                .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  }

  function renderFamily(fam){
    const list=partsForFamily(fam);
    const title = fam==='OTHER' ? 'Universal / Other' : fam;
    $('main').innerHTML=`
      <div class="crumb"><span style="cursor:pointer" onclick="H.home()">Vehicles</span> › <b>${esc(title)}</b></div>
      <div class="sectitle">${esc(title)} — ${list.length} parts</div>
      <div class="searchbox" style="margin-bottom:14px">
        <span class="si">🔍</span>
        <input id="famSearch" placeholder="Filter within ${esc(title)}…" oninput="H.filterFamily('${esc(fam)}')">
      </div>
      <div class="plist" id="famList">${list.map(rowHTML).join('')}</div>`;
  }
  function filterFamily(fam){
    const q=($('famSearch').value||'').toLowerCase().trim();
    let list=partsForFamily(fam);
    if(q) list=list.filter(p=>matchQ(p,q));
    $('famList').innerHTML = list.length ? list.map(rowHTML).join('') : '<div class="empty">No matching parts</div>';
  }

  function matchQ(p,q){
    const hay=((p.name||'')+' '+(p.part_no||'')+' '+(p.vehicle||'')+' '+(p.families||[]).join(' ')).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(tok=>hay.includes(tok));  // all words must match
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
      <div class="plist">${list.length?list.map(rowHTML).join(''):'<div class="empty">No parts match your search</div>'}</div>`;
  }

  // ── part row ────────────────────────────────────────
  function rowHTML(p){
    const inCart=basket[p.part_no];
    const chips=(p.families||[]).filter(f=>f!=='OTHER').map(f=>`<span class="chip">${esc(f)}</span>`).join('');
    const ctrl = inCart ? qstepHTML(p) : `<button class="padd" onclick="H.add('${esc(p.part_no)}')">+ Add</button>`;
    return `<div class="prow ${inCart?'in':''}" id="row-${cssid(p.part_no)}">
      <div class="pinfo">
        <div class="pname">${esc(p.name)}</div>
        <div class="pmeta"><span class="pn">${esc(p.part_no)}</span>${chips}${p.unit?`<span>· ${esc(p.unit)}</span>`:''}</div>
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
  const cssid = s => String(s).replace(/[^A-Za-z0-9_-]/g,'_');

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
        vehicle:(p.families||[]).filter(f=>f!=='OTHER').join(', ')||p.vehicle||'',
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

  // restore session
  try{ const s=JSON.parse(localStorage.getItem('honda_sess')||'null'); if(s&&s.firm){ session=s; $('firm').value=s.firm; $('mobile').value=s.contact||''; } }catch(e){}

  return {
    login, home, back, openFamily:(f)=>go('family',f,true),
    onSearch, filterFamily, add, inc, dec, setQty, remove,
    openCart, closeCart, placeOrder
  };
})();

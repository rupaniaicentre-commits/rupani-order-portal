'use strict';
/* ══════════════════════════════════════════════════════
   RUPANI AUTOMOBILES — ORDER MANAGEMENT DASHBOARD
   Admin (Harsh) sees all; managers see their portal only.
   ══════════════════════════════════════════════════════ */
const D = (() => {
  let auth = null;           // {token, user, role, scope}
  let portal = 'all';        // admin filter: all|honda|aerostar
  let curTab = 'orders';
  let orders = [];
  let openOid = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inr = n => '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
  const fdate = ts => { const d=new Date(ts); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); };

  // ── auth ────────────────────────────────────────────
  async function login(){
    const u=$('u').value.trim(), p=$('p').value, err=$('lerr');
    if(!u||!p){ err.textContent='Enter username and password'; err.classList.remove('hidden'); return; }
    try{
      const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const d=await r.json();
      if(!d.success){ err.textContent=d.error||'Login failed'; err.classList.remove('hidden'); return; }
      auth=d; try{ localStorage.setItem('rupani_admin', JSON.stringify(d)); }catch(e){}
      enter();
    }catch(e){ err.textContent='Network error'; err.classList.remove('hidden'); }
  }
  function logout(){ auth=null; try{localStorage.removeItem('rupani_admin');}catch(e){} location.reload(); }
  function enter(){
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    portal = auth.scope==='all' ? 'all' : auth.scope;
    const scopeLabel = auth.scope==='all'?'All catalogues':(auth.scope==='honda'?'Honda':'Aerostar');
    $('who').textContent = `${auth.user} · ${auth.role==='admin'?'Admin':'Sales Manager'} · ${scopeLabel}`;
    // New Items tab is Honda-only
    if(auth.scope==='all'||auth.scope==='honda'){ $('tabNew').classList.remove('hidden'); loadNewBadge(); }
    // Traffic tab: admin + sales managers (managers see only their own portal)
    if($('tabTraffic')) $('tabTraffic').classList.remove('hidden');
    tab('orders');
  }
  async function loadNewBadge(){
    try{ const r=await fetch('/api/admin/honda-new?token='+encodeURIComponent(auth.token));
      const d=await r.json(); const b=$('newBadge');
      if(d.total>0){ b.textContent=d.total; b.classList.remove('hidden'); } else b.classList.add('hidden');
    }catch(e){}
  }

  // ── data ────────────────────────────────────────────
  async function loadOrders(){
    const r=await fetch('/api/admin/orders?token='+encodeURIComponent(auth.token)+(portal!=='all'?'&portal='+portal:''));
    if(r.status===401){ logout(); return; }
    const d=await r.json(); orders=d.orders||[];
  }

  // ── tabs ────────────────────────────────────────────
  function tab(t){
    curTab=t;
    $('tabOrders').classList.toggle('on',t==='orders');
    $('tabAnalytics').classList.toggle('on',t==='analytics');
    if($('tabTraffic')) $('tabTraffic').classList.toggle('on',t==='traffic');
    $('tabNew').classList.toggle('on',t==='new');
    if(t==='orders') renderOrders(); else if(t==='analytics') renderAnalytics();
    else if(t==='traffic') renderTraffic(); else renderNew();
  }
  async function renderTraffic(){
    const wrap=$('main');
    wrap.innerHTML='<div class="empty">Loading traffic…</div>';
    let d; try{ const r=await fetch('/api/admin/portal-analytics?token='+encodeURIComponent(auth.token));
      if(r.status===401){ logout(); return; } d=await r.json(); }catch(e){ wrap.innerHTML='<div class="empty">Error</div>'; return; }
    if(!d.success){ wrap.innerHTML='<div class="empty">'+esc(d.error||'Error')+'</div>'; return; }
    const t=d.totals||{};
    const kpi=(label,val)=>`<div class="kpi"><div class="k-l">${label}</div><div class="k-v">${val}</div></div>`;
    const maxDay=Math.max(1,...(d.logins_by_day||[]).map(x=>x.count));
    wrap.innerHTML=`
      <div class="kpis">${kpi('Total logins',t.logins_total||0)}${kpi('Searches',t.searches_total||0)}${kpi('Vehicle-no. lookups',t.vin_total||0)}${kpi('Open baskets',t.carts_total||0)}${kpi('Orders',t.orders_total||0)}</div>
      <div class="card"><h3>Logins per day — unique users (14 days)</h3>
        <table><thead><tr><th>Day</th><th class="num">Users</th><th></th></tr></thead><tbody>
        ${(d.logins_by_day||[]).map((x,i)=>`
          <tr class="lg-day" style="cursor:pointer" onclick="D.toggleDay(${i})">
            <td><span id="lg-ar-${i}">▸</span> ${esc(x.day)}</td>
            <td class="num">${x.count}</td>
            <td><div style="background:#1f3864;height:10px;border-radius:5px;width:${Math.round(x.count/maxDay*160)}px"></div></td></tr>
          <tr id="lg-u-${i}" class="hidden"><td colspan="3" style="padding:0 10px 10px">
            <table style="width:100%;background:#f7f9fc;border-radius:8px;margin:0">
              <thead><tr><th>Firm</th><th>Mobile</th><th class="num">Logins</th></tr></thead>
              <tbody>${(x.users||[]).map(u=>`<tr><td>${esc(u.firm||'—')}</td><td>${esc(u.mobile||'—')}</td><td class="num">${u.logins}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">—</td></tr>'}</tbody>
            </table></td></tr>`).join('')||'<tr><td colspan=3 class="empty">No logins yet</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Aerostar vs Honda</h3>
        <table><thead><tr><th>Portal</th><th class="num">Visits</th><th class="num">Users</th></tr></thead><tbody>
        ${(d.portals||[]).map(p=>`<tr><td>${esc(p.portal)}</td><td class="num">${p.views}</td><td class="num">${p.users}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">No data</td></tr>'}</tbody></table></div>
      <div class="card"><h3>🛒 Baskets not yet ordered — follow up</h3>
        <table><thead><tr><th>Firm</th><th>Mobile</th><th class="num">Items</th><th class="num">Value ₹</th><th>Last active</th><th></th></tr></thead><tbody>
        ${(d.open_carts||[]).map((c,i)=>`
          <tr class="lg-day" style="cursor:pointer" onclick="D.toggleCart(${i})">
            <td><span id="ct-ar-${i}">▸</span> ${esc(c.firm||'—')}${c.portal?` <span class="pill">${esc(c.portal)}</span>`:''}</td>
            <td>${esc(c.mobile||'—')}</td>
            <td class="num">${c.qty}</td>
            <td class="num">${Math.round(c.amt||0).toLocaleString('en-IN')}</td>
            <td>${ago(c.age_hrs)}</td>
            <td>${c.mobile?`<a href="https://wa.me/91${esc(String(c.mobile).replace(/\\D/g,''))}?text=${encodeURIComponent('Namaste '+(c.firm||'')+', aapke basket me '+c.qty+' items pending hain. Order confirm karein?')}" target="_blank" onclick="event.stopPropagation()" class="wa-link">💬 WhatsApp</a>`:''}</td></tr>
          <tr id="ct-u-${i}" class="hidden"><td colspan="6" style="padding:0 10px 10px">
            <table style="width:100%;background:#f7f9fc;border-radius:8px;margin:0">
              <thead><tr><th>Part No</th><th>Description</th><th class="num">Qty</th><th class="num">₹</th></tr></thead>
              <tbody>${(c.items||[]).map(it=>`<tr><td>${esc(it.part_no)}</td><td>${esc(it.name||'—')}</td><td class="num">${it.qty}</td><td class="num">${it.price?Math.round(it.price).toLocaleString('en-IN'):'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">—</td></tr>'}</tbody>
            </table></td></tr>`).join('')||'<tr><td colspan=6 class="empty">No open baskets right now 🎉</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Vehicle-number lookups per retailer (VAHAN API)</h3>
        <table><thead><tr><th>Firm</th><th>Mobile</th><th class="num">Lookups</th></tr></thead><tbody>
        ${(d.vin_by_retailer||[]).map(u=>`<tr><td>${esc(u.firm||'—')}</td><td>${esc(u.mobile)}</td><td class="num">${u.searches}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">No vehicle-number lookups yet</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Most searched</h3>
        <table><thead><tr><th>Search term</th><th class="num">Times</th></tr></thead><tbody>
        ${(d.top_search||[]).map(s=>`<tr><td>${esc(s.term)}</td><td class="num">${s.count}</td></tr>`).join('')||'<tr><td colspan=2 class="empty">No searches yet</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Searched but never ordered</h3>
        <table><thead><tr><th>Firm</th><th>Mobile</th><th class="num">Searches</th></tr></thead><tbody>
        ${(d.searched_no_order||[]).map(u=>`<tr><td>${esc(u.firm||'—')}</td><td>${esc(u.mobile)}</td><td class="num">${u.searches}</td></tr>`).join('')||'<tr><td colspan=3 class="empty">Everyone who searched has ordered 🎉</td></tr>'}</tbody></table></div>`;
  }
  function setPortal(p){ portal=p; if(curTab==='orders') renderOrders(); else renderAnalytics(); }

  function portalSeg(){
    if(auth.scope!=='all') return '';
    const b=(p,l)=>`<button class="${portal===p?'on':''}" onclick="D.setPortal('${p}')">${l}</button>`;
    return `<div class="seg">${b('all','All')}${b('honda','Honda')}${b('aerostar','Aerostar')}</div>`;
  }
  function dlPending(){
    const url='/api/admin/pending-export?token='+encodeURIComponent(auth.token)+(portal!=='all'?'&portal='+portal:'');
    const a=document.createElement('a'); a.href=url; a.download=''; document.body.appendChild(a); a.click(); a.remove();
  }
  const dlBtn = () => `<button class="dl" onclick="D.dlPending()">⬇ Download pending (Excel)</button>`;

  // ── ORDERS TAB ──────────────────────────────────────
  let statusFilter='all', q='';
  async function renderOrders(){
    $('main').innerHTML='<div class="empty">Loading orders…</div>';
    await loadOrders();
    const sb=(s,l)=>`<button class="${statusFilter===s?'on':''}" onclick="D.setStatus('${s}')">${l}</button>`;
    let list=orders.filter(o=>statusFilter==='all'||o.status===statusFilter);
    if(q){ const ql=q.toLowerCase(); list=list.filter(o=>(o.firm+' '+o.contact+' '+o.items.map(i=>i.part_no+' '+i.name).join(' ')).toLowerCase().includes(ql)); }
    const pend=orders.filter(o=>o.status!=='dispatched').length;
    $('main').innerHTML=`
      <div class="bar">${portalSeg()}
        <div class="seg">${sb('all','All')}${sb('pending','Pending')}${sb('partial','Partial')}${sb('dispatched','Dispatched')}</div>
        <div class="spacer"></div>
        ${dlBtn()}
        <input class="search" placeholder="Search firm / part / mobile…" value="${esc(q)}" oninput="D.setQ(this.value)">
      </div>
      <div class="card">
        <div class="card-h"><span>${list.length} order(s) · ${pend} not fully dispatched</span></div>
        ${list.length?list.map(orderRow).join(''):'<div class="empty">No orders</div>'}
      </div>`;
    if(openOid) toggleOrder(openOid,true);
  }
  function setStatus(s){ statusFilter=s; renderOrders(); }
  function setQ(v){ q=v; renderOrders(); }

  function orderRow(o){
    const val=o.items.reduce((s,i)=>s+((i.price||0)*i.qty),0);
    const dispVal=o.items.reduce((s,i)=>s+((i.price||0)*Math.min(i.disp||0,i.qty)),0);
    return `<div class="ord" id="ord-${esc(o.oid)}">
      <div class="ord-sum" onclick="D.toggleOrder('${esc(o.oid)}')">
        <div><div class="ord-firm">${esc(o.firm||'—')}</div><div class="ord-sub">${esc(o.contact||'')} · ${fdate(o.ts)}</div></div>
        <div class="hide-s"><span class="tag ${o.portal}">${o.portal==='honda'?'Honda':'Aerostar'}</span></div>
        <div class="num">${o.items.length} items</div>
        <div class="num">${o.totalQty} pcs</div>
        <div class="num">${inr(val)}<div class="pill">${inr(dispVal)} sent</div></div>
        <div style="text-align:right"><span class="st ${o.status}">${o.status}</span></div>
      </div>
      <div class="ord-det hidden" id="det-${esc(o.oid)}"></div>
    </div>`;
  }
  function toggleOrder(oid,keep){
    const det=$('det-'+oid); if(!det) return;
    const isOpen=!det.classList.contains('hidden');
    if(isOpen&&!keep){ det.classList.add('hidden'); openOid=null; return; }
    const o=orders.find(x=>x.oid===oid); if(!o) return;
    openOid=oid;
    det.innerHTML=`
      <table><thead><tr><th>Ordered Part</th><th>Description</th><th>Alternate part sent</th><th class="num">Ordered</th><th class="num">Dispatched</th><th class="num">Pending</th></tr></thead>
      <tbody>${o.items.map((it,i)=>{
        const disp=Math.min(it.disp||0,it.qty), pend=it.qty-disp;
        return `<tr><td>${esc(it.part_no)}</td><td>${esc(it.name)}</td>
          <td><input class="alti" id="a-${esc(oid)}-${i}" type="text" placeholder="same as ordered" value="${esc(it.alt||'')}"></td>
          <td class="num">${it.qty}</td>
          <td class="num"><input class="qi" id="q-${esc(oid)}-${i}" type="number" min="0" max="${it.qty}" value="${disp}"></td>
          <td class="num" style="color:${pend?'#b45309':'#065f46'};font-weight:600">${pend}</td></tr>`;
      }).join('')}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
        <button class="markall" onclick="D.markAll('${esc(oid)}')">✓ Mark all dispatched</button>
        <button class="save" onclick="D.saveDispatch('${esc(oid)}')">Save dispatch</button>
      </div>`;
    det.classList.remove('hidden');
  }
  async function saveDispatch(oid){
    const o=orders.find(x=>x.oid===oid); if(!o) return;
    const items=o.items.map((it,i)=>({part_no:it.part_no, disp:parseInt($(`q-${oid}-${i}`).value)||0, alt:($(`a-${oid}-${i}`)?.value||'').trim()}));
    await postDispatch({oid, items});
  }
  async function markAll(oid){ await postDispatch({oid, mark_all:true}); }
  async function postDispatch(body){
    const r=await fetch('/api/admin/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:auth.token,...body})});
    const d=await r.json();
    if(d.success){ const o=orders.find(x=>x.oid===body.oid); if(o){o.items=d.items;o.status=d.status;} renderOrders(); }
    else alert(d.error||'Update failed');
  }

  // ── ANALYTICS TAB ───────────────────────────────────
  async function renderAnalytics(){
    $('main').innerHTML='<div class="empty">Loading analytics…</div>';
    const r=await fetch('/api/admin/analytics?token='+encodeURIComponent(auth.token)+(portal!=='all'?'&portal='+portal:''));
    if(r.status===401){ logout(); return; }
    const a=await r.json();
    const sc=a.status_counts||{};
    $('main').innerHTML=`
      <div class="bar">${portalSeg()}<div class="spacer"></div>${dlBtn()}<span class="pill">${a.portal==='all'?'All catalogues':a.portal} · ${a.n_orders} orders</span></div>
      <div class="kpis">
        <div class="kpi"><div class="k-l">Total Order Value</div><div class="k-v">${inr(a.ordered_val)}</div><div class="k-s">${a.ordered_qty} pcs ordered</div></div>
        <div class="kpi good"><div class="k-l">Dispatched</div><div class="k-v">${inr(a.disp_val)}</div><div class="k-s">${a.disp_qty} pcs sent</div></div>
        <div class="kpi bad"><div class="k-l">Pending (missed size)</div><div class="k-v">${inr(a.pend_val)}</div><div class="k-s">${a.ordered_qty-a.disp_qty} pcs pending</div></div>
        <div class="kpi ${a.fill_ratio>=80?'good':a.fill_ratio>=50?'warn':'bad'}"><div class="k-l">Fill Ratio</div><div class="k-v">${a.fill_ratio}%</div>
          <div class="fillbar"><div style="width:${a.fill_ratio}%"></div></div></div>
      </div>
      <div class="kpis">
        <div class="kpi warn"><div class="k-l">Pending Orders</div><div class="k-v">${sc.pending||0}</div></div>
        <div class="kpi"><div class="k-l">Partial</div><div class="k-v">${sc.partial||0}</div></div>
        <div class="kpi good"><div class="k-l">Fully Dispatched</div><div class="k-v">${sc.dispatched||0}</div></div>
      </div>
      <div class="card">
        <div class="card-h"><span>🔴 Top pending items — order more / fulfil first</span><span class="pill">by pending qty</span></div>
        <table><thead><tr><th>Part No</th><th>Description</th><th class="num">Ordered</th><th class="num">Sent</th><th class="num">Pending</th><th class="num">Pending ₹</th></tr></thead>
        <tbody>${(a.top_pending||[]).map(p=>`<tr><td>${esc(p.part_no)}</td><td>${esc(p.name)}</td><td class="num">${p.ordered}</td><td class="num">${p.disp}</td>
          <td class="num" style="color:#b45309;font-weight:700">${p.pending}</td><td class="num">${inr((p.pending)*(p.val/Math.max(p.ordered,1)))}</td></tr>`).join('')||'<tr><td colspan=6 class="empty">Nothing pending 🎉</td></tr>'}</tbody></table>
      </div>
      <div class="card">
        <div class="card-h"><span>📈 Most-ordered items — demand (procure to stock)</span><span class="pill">by total qty ordered</span></div>
        <table><thead><tr><th>Part No</th><th>Description</th><th class="num">Total Ordered</th><th class="num">Order Value</th></tr></thead>
        <tbody>${(a.top_demand||[]).map(p=>`<tr><td>${esc(p.part_no)}</td><td>${esc(p.name)}</td><td class="num" style="font-weight:700">${p.ordered}</td><td class="num">${inr(p.val)}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">No data</td></tr>'}</tbody></table>
      </div>`;
  }

  // ── NEW ITEMS TAB (Honda) ───────────────────────────
  async function renderNew(){
    $('main').innerHTML='<div class="empty">Loading new items…</div>';
    const r=await fetch('/api/admin/honda-new?token='+encodeURIComponent(auth.token));
    if(r.status===401){ logout(); return; }
    const d=await r.json();
    if(!d.total){
      $('main').innerHTML=`<div class="card"><div class="empty">No new parts yet.<br>
        <span class="pill">When the Honda parts list is updated, newly added part numbers appear here grouped by the date they were received.</span></div></div>`;
      return;
    }
    const fb=b=>b==='baseline'?b:new Date(b+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
    $('main').innerHTML=`
      <div class="bar"><span class="pill">${d.total} new part(s) added across ${d.batches.length} update(s)</span></div>
      ${d.batches.map(bt=>`
        <div class="batch-h"><span class="bd">📦 Received ${fb(bt.batch)}</span><span class="bc">${bt.count} new</span></div>
        <div class="card"><table>
          <thead><tr><th>Part No</th><th>Description</th><th>Vehicle(s)</th><th class="num">Price</th></tr></thead>
          <tbody>${bt.items.map(it=>`<tr><td>${esc(it.part_no)}</td><td>${esc(it.name)}</td>
            <td>${esc(it.vehicles||'—')}</td><td class="num">${it.price?inr(it.price):'—'}</td></tr>`).join('')}</tbody>
        </table></div>`).join('')}`;
  }

  // ── restore session ─────────────────────────────────
  (function(){ try{ const s=JSON.parse(localStorage.getItem('rupani_admin')||'null'); if(s&&s.token){ auth=s; enter(); } }catch(e){} })();

  function toggleDay(i){
    const el=document.getElementById('lg-u-'+i), ar=document.getElementById('lg-ar-'+i);
    if(!el) return;
    const nowHidden=el.classList.toggle('hidden');
    if(ar) ar.textContent=nowHidden?'▸':'▾';
  }
  function toggleCart(i){
    const el=document.getElementById('ct-u-'+i), ar=document.getElementById('ct-ar-'+i);
    if(!el) return;
    const nowHidden=el.classList.toggle('hidden');
    if(ar) ar.textContent=nowHidden?'▸':'▾';
  }
  function ago(hrs){
    hrs=Number(hrs)||0;
    if(hrs<1) return Math.max(1,Math.round(hrs*60))+'m ago';
    if(hrs<24) return Math.round(hrs)+'h ago';
    return Math.round(hrs/24)+'d ago';
  }
  return { login, logout, tab, setPortal, setStatus, setQ, toggleOrder, saveDispatch, markAll, dlPending, toggleDay, toggleCart };
})();

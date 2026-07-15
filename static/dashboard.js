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
    tab('orders');
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
    if(t==='orders') renderOrders(); else renderAnalytics();
  }
  function setPortal(p){ portal=p; if(curTab==='orders') renderOrders(); else renderAnalytics(); }

  function portalSeg(){
    if(auth.scope!=='all') return '';
    const b=(p,l)=>`<button class="${portal===p?'on':''}" onclick="D.setPortal('${p}')">${l}</button>`;
    return `<div class="seg">${b('all','All')}${b('honda','Honda')}${b('aerostar','Aerostar')}</div>`;
  }

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
      <table><thead><tr><th>Part No</th><th>Description</th><th class="num">Ordered</th><th class="num">Dispatched</th><th class="num">Pending</th><th class="num">Value</th></tr></thead>
      <tbody>${o.items.map((it,i)=>{
        const disp=Math.min(it.disp||0,it.qty), pend=it.qty-disp;
        return `<tr><td>${esc(it.part_no)}</td><td>${esc(it.name)}</td>
          <td class="num">${it.qty}</td>
          <td class="num"><input class="qi" id="q-${esc(oid)}-${i}" type="number" min="0" max="${it.qty}" value="${disp}"></td>
          <td class="num" style="color:${pend?'#b45309':'#065f46'};font-weight:600">${pend}</td>
          <td class="num">${inr((it.price||0)*it.qty)}</td></tr>`;
      }).join('')}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
        <button class="markall" onclick="D.markAll('${esc(oid)}')">✓ Mark all dispatched</button>
        <button class="save" onclick="D.saveDispatch('${esc(oid)}')">Save dispatch</button>
      </div>`;
    det.classList.remove('hidden');
  }
  async function saveDispatch(oid){
    const o=orders.find(x=>x.oid===oid); if(!o) return;
    const items=o.items.map((it,i)=>({part_no:it.part_no, disp:parseInt($(`q-${oid}-${i}`).value)||0}));
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
      <div class="bar">${portalSeg()}<div class="spacer"></div><span class="pill">${a.portal==='all'?'All catalogues':a.portal} · ${a.n_orders} orders</span></div>
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

  // ── restore session ─────────────────────────────────
  (function(){ try{ const s=JSON.parse(localStorage.getItem('rupani_admin')||'null'); if(s&&s.token){ auth=s; enter(); } }catch(e){} })();

  return { login, logout, tab, setPortal, setStatus, setQ, toggleOrder, saveDispatch, markAll };
})();

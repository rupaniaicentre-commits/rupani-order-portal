'use strict';

/* ══════════════════════════════════════════════════════
   RUPANI AUTOMOBILES — ORDER PORTAL  (app.js)
   ══════════════════════════════════════════════════════ */

const App = (() => {
  // ── STATE ────────────────────────────────────────────
  let allProducts   = [];
  let basket        = {};          // { part_number: { ...product, qty } }
  let session       = { firm: '', contact: '' };
  let navStack      = [];          // [ { view, params, title } ]
  let searchIndex   = [];          // flat array for instant search
  let searchActive  = false;
  let searchFocusIdx = -1;

  const BRAND_COLORS = {
    'Hero':         'brand-hero',
    'Honda':        'brand-honda',
    'Bajaj':        'brand-bajaj',
    'Tvs':          'brand-tvs',
    'Suzuki':       'brand-suzuki',
    'Yamaha':       'brand-yamaha',
  };
  const BRAND_DISPLAY = {
    'Hero': 'HERO', 'Honda': 'HONDA', 'Bajaj': 'BAJAJ',
    'Tvs': 'TVS', 'Suzuki': 'SUZUKI', 'Yamaha': 'YAMAHA',
    'Royal Enfield': 'ROYAL ENFIELD', 'Ktm': 'KTM',
  };
  const CAT_ICONS = {
    'Front Fender': '🏍', 'Head Light Visor': '💡', 'Headlight Visor': '💡',
    'Side Cowl Set': '🔷', 'Rear Cowl Set': '🔶', 'Rear Cowl Back Plate': '🔵',
    'T.P.F.C Set': '🔧', 'Tpfc Set': '🔧', 'Nose': '👃',
    'Engine Guard': '🛡', 'Body Parts Full Kit': '📦',
    'Fuel Tank Cover': '⛽', 'Lower Body Cover': '⬇', 'Lower': '⬇',
    'Foot Trim Set': '👣', 'Front Body Cover': '🔲', 'Rear Cowl Center Plate': '🔵',
    'Back Plate': '◼', 'Leg Guard': '🦵', 'Side Panel': '▪',
    'Meter Visor': '🕐', 'Mudguard': '🔰', 'Tail Panel': '🔚',
    'Engine Cover': '⚙', 'Side Cover': '▫', 'Front Cover': '🔳',
    'Front Center Plate': '🔺', 'Grab Rail': '✋',
  };

  // ── INIT ─────────────────────────────────────────────
  function init() {
    loadBasketFromStorage();
    // Auto-login if remembered
    const remembered = localStorage.getItem('ra_remember');
    if (remembered) {
      try {
        session = JSON.parse(remembered);
        if (session.firm) { showApp(); return; }
      } catch(_) {}
    }
    // Restore session storage (same tab)
    const saved = sessionStorage.getItem('ra_session');
    if (saved) {
      try { session = JSON.parse(saved); } catch(_) {}
    }
    if (session.firm) {
      showApp();
      return;
    }
    // Pre-fill remembered credentials if checkbox was set before
    const prefill = localStorage.getItem('ra_prefill');
    if (prefill) {
      try {
        const p = JSON.parse(prefill);
        const fi = document.getElementById('firmNameInput');
        const mi = document.getElementById('mobileInput');
        const cb = document.getElementById('rememberMe');
        if (fi) fi.value = p.firm || '';
        if (mi) mi.value = p.contact || '';
        if (cb) cb.checked = true;
      } catch(_) {}
    }
  }

  function showApp() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('active');
    loadBasketFromStorage();   // restore this user's saved basket
    loadProducts();
    loadSettings();
  }

  // ── AUTH ─────────────────────────────────────────────
  function login() {
    const firm    = document.getElementById('firmNameInput').value.trim();
    const contact = document.getElementById('mobileInput').value.trim();
    const errEl   = document.getElementById('loginError');

    if (!firm) {
      showLoginError('Please enter your firm / shop name.'); return;
    }
    if (!contact || !/^\d{10}$/.test(contact)) {
      showLoginError('Please enter a valid 10-digit mobile number.'); return;
    }
    errEl.classList.add('hidden');
    session = { firm, contact };
    sessionStorage.setItem('ra_session', JSON.stringify(session));

    const remember = document.getElementById('rememberMe');
    if (remember && remember.checked) {
      localStorage.setItem('ra_remember', JSON.stringify(session));
      localStorage.setItem('ra_prefill', JSON.stringify(session));
    } else {
      localStorage.removeItem('ra_remember');
      localStorage.setItem('ra_prefill', JSON.stringify(session));
    }
    showApp();
  }

  function showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // Allow Enter key on login inputs
  document.addEventListener('DOMContentLoaded', () => {
    ['firmNameInput','mobileInput'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    });
    init();
  });

  // ── PRODUCT LOADING ───────────────────────────────────
  function loadProducts() {
    showLoader('Loading product catalogue…');
    fetch('/api/products')
      .then(r => r.json())
      .then(data => {
        allProducts = data;
        buildSearchIndex();
        hideLoader();
        renderHome();
      })
      .catch(() => {
        hideLoader();
        renderHome();
      });
  }

  function buildSearchIndex() {
    searchIndex = allProducts.map(p => ({
      ...p,
      _search: [
        p.as_part_number, p.sai_part_number,
        p.description, p.vehicle, p.brand, p.category, p.colour
      ].join(' ').toLowerCase()
    }));
  }

  // ── NAVIGATION ────────────────────────────────────────
  function renderHome() {
    navStack = [{ view: 'home', title: 'Home' }];
    renderBreadcrumb();
    document.getElementById('backBtn').style.visibility = 'hidden';

    const cats   = uniqueValues(allProducts, 'category').filter(Boolean).sort();
    const total  = allProducts.length;

    const html = `
      <div class="home-hero">
        <div>
          <div class="home-hero-title">Welcome, ${esc(session.firm)}</div>
          <div class="home-hero-sub">Browse and order fibre parts across all vehicles</div>
        </div>
        <div class="home-hero-badge">${total.toLocaleString()} Products</div>
      </div>

      <div class="section-title">Quick Access</div>
      <div class="quick-cards">
        <div class="quick-card" onclick="App.navigateTo('allProducts',{})">
          <div class="quick-card-icon">📋</div>
          <div class="quick-card-label">All Products</div>
          <div class="quick-card-sub">View complete catalogue</div>
        </div>
        <div class="quick-card" onclick="App.openBasketQuick()">
          <div class="quick-card-icon">🛒</div>
          <div class="quick-card-label">My Basket</div>
          <div class="quick-card-sub">${basketCount()} item(s) added</div>
        </div>
        <div class="quick-card" onclick="App.openVehicleLookup()">
          <div class="quick-card-icon">🔍</div>
          <div class="quick-card-label">Find by Vehicle No.</div>
          <div class="quick-card-sub">Enter RC number to find parts</div>
        </div>
      </div>

      <div class="section-title">Browse by Category</div>
      <div class="category-grid">
        ${cats.map(cat => `
          <div class="category-card" onclick="App.navigateTo('brands',{category:'${esc(cat)}'})">
            <div class="cat-icon">${CAT_ICONS[cat] || '🔩'}</div>
            <div class="cat-label">${esc(cat)}</div>
            <div class="cat-count">${allProducts.filter(p=>p.category===cat).length} parts</div>
          </div>
        `).join('')}
      </div>`;

    document.getElementById('mainContent').innerHTML = html;
  }

  function navigateTo(view, params) {
    navStack.push({ view, params, title: getTitleForView(view, params) });
    renderView(view, params);
    renderBreadcrumb();
    document.getElementById('mainContent').scrollTop = 0;
    document.getElementById('backBtn').style.visibility = navStack.length > 1 ? 'visible' : 'hidden';
  }

  function goBack() {
    if (navStack.length <= 1) return;
    navStack.pop();
    const cur = navStack[navStack.length - 1];
    renderView(cur.view, cur.params);
    renderBreadcrumb();
    document.getElementById('backBtn').style.visibility = navStack.length > 1 ? 'visible' : 'hidden';
    document.getElementById('mainContent').scrollTop = 0;
  }

  function goHome() {
    clearSearch();
    renderHome();
  }

  function getTitleForView(view, params) {
    if (view === 'brands')         return params.category;
    if (view === 'vehicles')       return params.brand;
    if (view === 'parts')          return params.vehicle || params.brand;
    if (view === 'allProducts')    return 'All Products';
    if (view === 'vehicleLookup')  return 'Find by Vehicle No.';
    return view;
  }

  function renderView(view, params) {
    if (view === 'home')          return renderHome();
    if (view === 'brands')        return renderBrands(params);
    if (view === 'vehicles')      return renderVehicles(params);
    if (view === 'parts')         return renderParts(params);
    if (view === 'allProducts')   return renderAllProducts(params);
    if (view === 'vehicleLookup') return renderVehicleLookupScreen();
  }

  // ── INLINE FILTER ─────────────────────────────────────
  function filterInlineList(val, selector) {
    const q = val.toLowerCase().trim();
    document.querySelectorAll(selector).forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
    const countEl = document.getElementById('inlineFilterCount');
    if (countEl) {
      const visible = document.querySelectorAll(selector + ':not([style*="none"])').length;
      countEl.textContent = q ? `${visible} result(s)` : '';
    }
  }

  function inlineSearchBar(placeholder) {
    return `
      <div class="inline-search-wrap">
        <span class="inline-search-icon">🔍</span>
        <input class="inline-search-input" type="text" placeholder="${placeholder}"
          oninput="App.filterInlineList(this.value,'${placeholder.includes('vehicle') ? '.vehicle-item' : placeholder.includes('brand') ? '.brand-card' : '.part-card,.parts-table tbody tr'}')"
          autocomplete="off" />
        <span id="inlineFilterCount" class="inline-filter-count"></span>
      </div>`;
  }

  // ── BRANDS ────────────────────────────────────────────
  function renderBrands({ category }) {
    const products = allProducts.filter(p => p.category === category);
    const brands   = uniqueValues(products, 'brand').filter(Boolean).sort();

    const html = `
      <div class="page-title">${esc(category)}</div>
      ${inlineSearchBar('Search brand...')}
      <div class="brand-grid">
        ${brands.map(b => {
          const cls = BRAND_COLORS[b] || 'brand-other';
          const cnt = products.filter(p => p.brand === b).length;
          return `
            <div class="brand-card" onclick="App.navigateTo('vehicles',{category:'${esc(category)}',brand:'${esc(b)}'})">
              <div class="brand-logo ${cls}">${b.charAt(0)}</div>
              <div class="brand-name">${BRAND_DISPLAY[b] || esc(b)}</div>
              <div class="brand-count">${cnt} parts</div>
            </div>`;
        }).join('')}
      </div>`;

    document.getElementById('mainContent').innerHTML = html;
  }

  // ── VEHICLES ──────────────────────────────────────────
  function renderVehicles({ category, brand }) {
    const products  = allProducts.filter(p => p.category === category && p.brand === brand);
    const vehicles  = uniqueValues(products, 'vehicle').filter(Boolean).sort();

    const html = `
      <div class="page-title">${BRAND_DISPLAY[brand] || esc(brand)} — ${esc(category)}</div>
      ${inlineSearchBar('Search vehicle model...')}
      <div class="vehicle-list">
        ${vehicles.map(v => {
          const cnt = products.filter(p => p.vehicle === v).length;
          return `
            <div class="vehicle-item" onclick="App.navigateTo('parts',{category:'${esc(category)}',brand:'${esc(brand)}',vehicle:'${esc(v)}'})">
              <div>
                <div class="vehicle-name">${esc(v)}</div>
                <div class="vehicle-meta">${cnt} colour variants</div>
              </div>
              <div class="vehicle-arrow">›</div>
            </div>`;
        }).join('')}
      </div>`;

    document.getElementById('mainContent').innerHTML = html;
  }

  // ── PARTS TABLE ───────────────────────────────────────
  function renderParts({ category, brand, vehicle, searchResults }) {
    let products;
    let subtitle = '';

    if (searchResults) {
      products = searchResults;
      subtitle = `${products.length} result(s) found`;
    } else {
      products = allProducts.filter(p =>
        (!category || p.category === category) &&
        (!brand    || p.brand    === brand   ) &&
        (!vehicle  || p.vehicle  === vehicle )
      );
      subtitle = `${products.length} parts · ${esc(vehicle || brand || category || '')}`;
    }

    const html = `
      <div class="parts-toolbar">
        <div>
          <div class="page-title">${esc(vehicle || brand || category || 'Search Results')}</div>
          <div class="parts-filter-note">${subtitle}</div>
        </div>
        <span class="parts-count-badge">${products.length}</span>
      </div>

      <div class="inline-search-wrap">
        <span class="inline-search-icon">🔍</span>
        <input class="inline-search-input" type="text" placeholder="Filter parts by name, part no, colour…"
          oninput="App.filterInlineList(this.value,'.part-card,.parts-table tbody tr')"
          autocomplete="off" />
        <span id="inlineFilterCount" class="inline-filter-count"></span>
      </div>

      <!-- MOBILE CARDS -->
      <div class="parts-list">
        ${products.map(p => buildPartCard(p)).join('')}
      </div>

      <!-- DESKTOP TABLE -->
      <div class="parts-table-wrap">
        <table class="parts-table">
          <thead>
            <tr>
              <th>Part No. (AS / SAI)</th>
              <th>Description</th>
              <th>Colour</th>
              <th>MRP (₹)</th>
              <th>Qty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => buildPartRow(p)).join('')}
          </tbody>
        </table>
      </div>`;

    document.getElementById('mainContent').innerHTML = html;
  }

  // ── PRODUCT IMAGE ─────────────────────────────────────
  // Prefer the image extracted directly from the Aerostar catalogue (keyed by
  // AS part number — guaranteed correct), then fall back to the SAI image, then
  // hide the frame if nothing is found.
  function partImgChain(p) {
    const srcs = [];
    if (p.as_part_number)
      srcs.push('/static/images_as/' + encodeURIComponent(p.as_part_number) + '.jpg');
    if (p.sai_part_number) {
      srcs.push('/static/images/' + encodeURIComponent(p.sai_part_number) + '.jpeg');
      srcs.push('/static/images/' + encodeURIComponent(p.sai_part_number) + '.png');
    }
    return srcs;
  }

  function partImg(p) {
    const srcs = partImgChain(p);
    if (!srcs.length) return '';
    return `<div class="part-img-wrap"><img class="part-img" src="${srcs[0]}" `
         + `data-srcs="${srcs.join('|')}" data-idx="0" `
         + `onerror="App.imgFallback(this)" loading="lazy" /></div>`;
  }

  function imgFallback(img) {
    const srcs = (img.dataset.srcs || '').split('|').filter(Boolean);
    let i = parseInt(img.dataset.idx || '0', 10) + 1;
    if (i < srcs.length) {
      img.dataset.idx = String(i);
      img.src = srcs[i];
    } else if (img.parentElement) {
      img.parentElement.style.display = 'none';
    }
  }

  function buildPartCard(p) {
    const inBasket = basket[p.as_part_number];
    const qty      = inBasket ? inBasket.qty : 1;
    const cardCls  = inBasket ? ' in-basket' : '';
    return `
      <div class="part-card${cardCls}" id="card-${esc(p.as_part_number)}">
        ${partImg(p)}
        <div class="part-card-top">
          <div class="part-card-pns">
            <span class="pn-as">${esc(p.as_part_number)}</span>
            ${p.sai_part_number ? `<span class="pn-sai">${esc(p.sai_part_number)}</span>` : ''}
          </div>
          <div class="part-card-mrp">${p.mrp ? '₹' + Number(p.mrp).toLocaleString('en-IN') : '—'}</div>
        </div>
        <div class="part-card-desc">${esc(p.description)}</div>
        <div class="part-card-meta">
          <span class="colour-badge">${esc(p.colour || 'N/A')}</span>
          ${p.std_packing ? `<span class="std-pkg-badge">📦 ${esc(p.std_packing)}</span>` : ''}
        </div>
        <div class="part-card-actions">
          <input class="qty-input" type="number" min="1" value="${qty}"
            id="qty-${esc(p.as_part_number)}"
            onkeydown="if(event.key==='Enter')App.addToBasket('${esc(p.as_part_number)}')" />
          <button class="add-btn${inBasket ? ' added' : ''}"
            id="btn-${esc(p.as_part_number)}"
            onclick="App.addToBasket('${esc(p.as_part_number)}')">
            ${inBasket ? '✓ Added' : '+ Add to Basket'}
          </button>
        </div>
      </div>`;
  }

  function buildPartRow(p) {
    const inBasket = basket[p.as_part_number];
    const qty      = inBasket ? inBasket.qty : 1;
    return `
      <tr id="row-${esc(p.as_part_number)}" class="${inBasket ? 'in-basket' : ''}">
        <td class="td-pn">
          <div class="pn-as">${esc(p.as_part_number)}</div>
          ${p.sai_part_number ? `<div class="pn-sai" style="margin-top:3px">${esc(p.sai_part_number)}</div>` : ''}
        </td>
        <td class="td-desc">${esc(p.description)}</td>
        <td class="td-colour">
          <span class="colour-badge">${esc(p.colour || 'N/A')}</span>
          ${p.std_packing ? `<div class="std-pkg-badge" style="margin-top:3px">📦 ${esc(p.std_packing)}</div>` : ''}
        </td>
        <td class="td-mrp">${p.mrp ? '₹' + Number(p.mrp).toLocaleString('en-IN') : '—'}</td>
        <td class="td-qty">
          <input class="qty-input" type="number" min="1" value="${qty}"
            id="qty-dt-${esc(p.as_part_number)}"
            onkeydown="if(event.key==='Enter')App.addToBasket('${esc(p.as_part_number)}')" />
        </td>
        <td class="td-action">
          <button class="add-btn${inBasket ? ' added' : ''}"
            id="btn-dt-${esc(p.as_part_number)}"
            onclick="App.addToBasketDt('${esc(p.as_part_number)}')">
            ${inBasket ? '✓ Added' : '+ Add'}
          </button>
        </td>
      </tr>`;
  }

  function renderAllProducts({ page = 0, filter = '' } = {}) {
    const PAGE_SIZE = 200;
    let products = allProducts;
    if (filter) {
      const q = filter.toLowerCase();
      products = allProducts.filter(p => p._search && p._search.includes(q));
    }
    const total  = products.length;
    const sliced = products.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);

    const paginationHtml = total > PAGE_SIZE ? `
      <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
        ${page > 0 ? `<button class="btn-outline" onclick="App.navigateTo('allProducts',{page:${page-1}})">← Prev</button>` : ''}
        <span style="font-size:13px;color:var(--text-muted)">
          Showing ${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE, total)} of ${total}
        </span>
        ${(page+1)*PAGE_SIZE < total ? `<button class="btn-outline" onclick="App.navigateTo('allProducts',{page:${page+1}})">Next →</button>` : ''}
      </div>` : '';

    const html = `
      <div class="all-products-note">
        📋 Showing <strong>${sliced.length}</strong> of <strong>${total}</strong> total products.
        Use the search bar above to filter instantly.
      </div>

      <!-- MOBILE CARDS -->
      <div class="parts-list">
        ${sliced.map(p => buildPartCard(p)).join('')}
      </div>

      <!-- DESKTOP TABLE -->
      <div class="parts-table-wrap">
        <table class="parts-table">
          <thead>
            <tr>
              <th>Part No.</th>
              <th>Description</th>
              <th>Colour</th>
              <th>MRP (₹)</th>
              <th>Qty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sliced.map(p => buildPartRow(p)).join('')}
          </tbody>
        </table>
      </div>
      ${paginationHtml}`;

    document.getElementById('mainContent').innerHTML = html;
  }

  // ── SEARCH (TALLY STYLE) ──────────────────────────────
  let _searchTimer = null;

  function onSearch(val) {
    const clear = document.getElementById('searchClear');
    if (val.trim()) {
      clear.classList.add('visible');
    } else {
      clear.classList.remove('visible');
      hideSearchDropdown();
      return;
    }
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => runSearch(val.trim()), 0);  // instant, no debounce delay
  }

  function runSearch(query) {
    if (!query) { hideSearchDropdown(); return; }
    const MAX   = 40;
    // Split into words — ALL words must match (like Tally)
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

    const results = searchIndex.filter(p => {
      if (!p._search) return false;
      return words.every(w => p._search.includes(w));
    }).slice(0, MAX);

    renderSearchDropdown(results, query);
  }

  function renderSearchDropdown(results, query) {
    const dd = document.getElementById('searchDropdown');
    if (!results.length) {
      dd.innerHTML = `<div class="search-no-result">No results for "<strong>${esc(query)}</strong>"</div>`;
      dd.classList.remove('hidden');
      searchFocusIdx = -1;
      return;
    }

    const items = results.map((p, i) => {
      const desc  = highlightMatch(p.description, query);
      const pnAS  = highlightMatch(p.as_part_number, query);
      const pnSAI = p.sai_part_number ? highlightMatch(p.sai_part_number, query) : '';
      const mrp   = p.mrp ? `₹${Number(p.mrp).toLocaleString('en-IN')}` : '';
      const meta  = [p.brand, p.vehicle, p.category].filter(Boolean).join(' · ');
      return `
        <div class="search-item" data-idx="${i}"
          onmousedown="App.searchItemClick('${esc(p.as_part_number)}')"
          onmouseover="App.setSearchFocus(${i})">
          <div class="search-item-pns">
            <span class="pn-as" style="font-size:11px">${pnAS}</span>
            ${pnSAI ? `<span class="pn-sai">${pnSAI}</span>` : ''}
          </div>
          <div class="search-item-body">
            <div class="search-item-desc">${desc}</div>
            <div class="search-item-meta">${esc(meta)}</div>
          </div>
          <div class="search-item-mrp">${mrp}</div>
        </div>`;
    });

    dd.innerHTML = `<div class="search-header-row">${results.length} result(s) for "${esc(query)}"</div>` + items.join('');
    dd.classList.remove('hidden');
    searchFocusIdx = -1;
  }

  function highlightMatch(text, query) {
    if (!text || !query) return esc(text || '');
    const safe = esc(text);
    const safeQ = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
    } catch(_) {
      return safe;
    }
  }

  function showSearchDropdown() {
    const val = document.getElementById('searchInput').value.trim();
    if (val) runSearch(val);
  }

  function hideSearchDropdown() {
    const dd = document.getElementById('searchDropdown');
    dd.classList.add('hidden');
    searchFocusIdx = -1;
  }

  function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.remove('visible');
    hideSearchDropdown();
  }

  function onSearchKey(e) {
    const dd    = document.getElementById('searchDropdown');
    const items = dd.querySelectorAll('.search-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchFocusIdx = Math.min(searchFocusIdx + 1, items.length - 1);
      updateSearchFocusHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchFocusIdx = Math.max(searchFocusIdx - 1, 0);
      updateSearchFocusHighlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchFocusIdx >= 0 && items[searchFocusIdx]) {
        items[searchFocusIdx].dispatchEvent(new MouseEvent('mousedown'));
      } else {
        // Navigate to full search results
        const q = document.getElementById('searchInput').value.trim();
        showSearchResults(q);
      }
    } else if (e.key === 'Escape') {
      hideSearchDropdown();
    }
  }

  function updateSearchFocusHighlight(items) {
    items.forEach((el, i) => {
      el.classList.toggle('focused', i === searchFocusIdx);
      if (i === searchFocusIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function setSearchFocus(idx) {
    searchFocusIdx = idx;
    const items = document.querySelectorAll('.search-item');
    items.forEach((el, i) => el.classList.toggle('focused', i === idx));
  }

  function searchItemClick(partNo) {
    hideSearchDropdown();
    const p = allProducts.find(x => x.as_part_number === partNo);
    if (!p) return;

    // Show ONLY this part — never the full vehicle list
    clearSearch();
    navStack = [{ view: 'home', title: 'Home' }];
    if (p.category) navStack.push({ view: 'brands',   params: { category: p.category },                        title: p.category });
    if (p.brand)    navStack.push({ view: 'vehicles',  params: { category: p.category, brand: p.brand },        title: p.brand });
    if (p.vehicle)  navStack.push({ view: 'parts',     params: { category: p.category, brand: p.brand, vehicle: p.vehicle }, title: p.vehicle });
    navStack.push({ view: 'parts', params: { searchResults: [p] }, title: partNo });

    renderBreadcrumb();
    renderParts({ searchResults: [p] });
    document.getElementById('backBtn').style.visibility = 'visible';
    document.getElementById('mainContent').scrollTop = 0;
  }

  function showSearchResults(query) {
    if (!query) return;
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const results = searchIndex.filter(p => p._search && words.every(w => p._search.includes(w)));
    hideSearchDropdown();
    navStack = [
      { view: 'home', title: 'Home' },
      { view: 'parts', params: { searchResults: results }, title: `"${query}"` }
    ];
    renderBreadcrumb();
    renderParts({ searchResults: results });
    document.getElementById('backBtn').style.visibility = 'visible';
  }

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#searchWrap')) hideSearchDropdown();
  });

  // ── BREADCRUMB ────────────────────────────────────────
  function renderBreadcrumb() {
    const bar = document.getElementById('breadcrumbBar');
    bar.innerHTML = navStack.map((item, i) => {
      const isLast = i === navStack.length - 1;
      const sep    = i > 0 ? '<span class="breadcrumb-sep"> › </span>' : '';
      const cls    = isLast ? 'active' : '';
      return `${sep}<span class="breadcrumb-item ${cls}" onclick="App.jumpTo(${i})">${esc(item.title)}</span>`;
    }).join('');
  }

  function jumpTo(idx) {
    if (idx >= navStack.length - 1) return;
    navStack = navStack.slice(0, idx + 1);
    const cur = navStack[navStack.length - 1];
    renderView(cur.view, cur.params || {});
    renderBreadcrumb();
    document.getElementById('backBtn').style.visibility = navStack.length > 1 ? 'visible' : 'hidden';
  }

  // ── BASKET ────────────────────────────────────────────
  function addToBasket(partNo) {
    const qtyEl = document.getElementById(`qty-${partNo}`);
    const qty   = qtyEl ? Math.max(1, parseInt(qtyEl.value) || 1) : 1;
    const p     = allProducts.find(x => x.as_part_number === partNo);
    if (!p) return;

    basket[partNo] = { ...p, qty };
    saveBasketToStorage();
    updateBasketUI();

    // Update mobile card
    const btn  = document.getElementById(`btn-${partNo}`);
    const card = document.getElementById(`card-${partNo}`);
    if (btn)  { btn.textContent = '✓ Added'; btn.classList.add('added'); }
    if (card) card.classList.add('in-basket');

    // Update desktop table row
    const btnDt = document.getElementById(`btn-dt-${partNo}`);
    const row   = document.getElementById(`row-${partNo}`);
    if (btnDt) { btnDt.textContent = '✓ Added'; btnDt.classList.add('added'); }
    if (row)   row.classList.add('in-basket');
  }

  function addToBasketDt(partNo) {
    const qtyEl = document.getElementById(`qty-dt-${partNo}`);
    const qty   = qtyEl ? Math.max(1, parseInt(qtyEl.value) || 1) : 1;
    const p     = allProducts.find(x => x.as_part_number === partNo);
    if (!p) return;
    basket[partNo] = { ...p, qty };
    saveBasketToStorage();
    updateBasketUI();

    const btnDt = document.getElementById(`btn-dt-${partNo}`);
    const row   = document.getElementById(`row-${partNo}`);
    if (btnDt) { btnDt.textContent = '✓ Added'; btnDt.classList.add('added'); }
    if (row)   row.classList.add('in-basket');

    const btn  = document.getElementById(`btn-${partNo}`);
    const card = document.getElementById(`card-${partNo}`);
    if (btn)  { btn.textContent = '✓ Added'; btn.classList.add('added'); }
    if (card) card.classList.add('in-basket');
  }

  function removeFromBasket(partNo) {
    delete basket[partNo];
    saveBasketToStorage();
    updateBasketUI();
    renderBasketItems();
    // Reset mobile card
    const btn  = document.getElementById(`btn-${partNo}`);
    const card = document.getElementById(`card-${partNo}`);
    if (btn)  { btn.textContent = '+ Add to Basket'; btn.classList.remove('added'); }
    if (card) card.classList.remove('in-basket');
    // Reset desktop row
    const btnDt = document.getElementById(`btn-dt-${partNo}`);
    const row   = document.getElementById(`row-${partNo}`);
    if (btnDt) { btnDt.textContent = '+ Add'; btnDt.classList.remove('added'); }
    if (row)   row.classList.remove('in-basket');
  }

  function updateBasketQty(partNo, delta) {
    if (!basket[partNo]) return;
    basket[partNo].qty = Math.max(1, basket[partNo].qty + delta);
    saveBasketToStorage();
    renderBasketItems();
    updateBasketUI();
  }

  function clearBasket() {
    basket = {};
    saveBasketToStorage();
    renderBasketItems();
    updateBasketUI();
    // Reset all add buttons (both mobile cards and desktop table)
    document.querySelectorAll('.add-btn.added').forEach(b => {
      b.textContent = b.id && b.id.startsWith('btn-dt-') ? '+ Add' : '+ Add to Basket';
      b.classList.remove('added');
    });
    // Remove in-basket highlight from cards and table rows
    document.querySelectorAll('.part-card.in-basket, .parts-table tr.in-basket').forEach(el => {
      el.classList.remove('in-basket');
    });
  }

  function basketCount() {
    return Object.keys(basket).length;
  }

  function basketTotalQty() {
    return Object.values(basket).reduce((s, i) => s + i.qty, 0);
  }

  function basketTotalMrp() {
    return Object.values(basket).reduce((s, i) => s + (i.mrp || 0) * i.qty, 0);
  }

  function updateBasketUI() {
    const cnt = basketCount();
    document.getElementById('basketCount').textContent = cnt;
  }

  function renderBasketItems() {
    const items   = Object.values(basket);
    const el      = document.getElementById('basketItems');
    const footer  = document.getElementById('basketFooter');

    if (!items.length) {
      el.innerHTML = '<div class="basket-empty">Your basket is empty</div>';
      footer.style.display = 'none';
      return;
    }

    footer.style.display = 'flex';
    document.getElementById('basketTotalQty').textContent = basketTotalQty();
    document.getElementById('basketTotalMrp').textContent =
      '₹' + basketTotalMrp().toLocaleString('en-IN', { maximumFractionDigits: 0 });

    el.innerHTML = items.map(item => `
      <div class="basket-item">
        <div class="bi-info">
          <div class="bi-pn">${esc(item.as_part_number)}${item.sai_part_number ? ' · ' + esc(item.sai_part_number) : ''}</div>
          <div class="bi-desc" title="${esc(item.description)}">${esc(item.description)}</div>
          <div class="bi-colour">${esc(item.colour || '')} ${item.mrp ? '· ₹' + Number(item.mrp).toLocaleString('en-IN') : ''}</div>
        </div>
        <div class="bi-qty-wrap">
          <div class="bi-qty-ctrl">
            <button class="bi-qty-btn" onclick="App.updateBasketQty('${esc(item.as_part_number)}',-1)">−</button>
            <span class="bi-qty-num">${item.qty}</span>
            <button class="bi-qty-btn" onclick="App.updateBasketQty('${esc(item.as_part_number)}',1)">+</button>
          </div>
          <button class="bi-remove" onclick="App.removeFromBasket('${esc(item.as_part_number)}')">Remove</button>
        </div>
      </div>`).join('');
  }

  function toggleBasket() {
    const panel   = document.getElementById('basketPanel');
    const overlay = document.getElementById('basketOverlay');
    const isOpen  = panel.classList.contains('open');
    if (isOpen) {
      panel.classList.remove('open');
      overlay.classList.add('hidden');
    } else {
      renderBasketItems();
      panel.classList.add('open');
      overlay.classList.remove('hidden');
    }
  }

  function openBasketQuick() {
    renderBasketItems();
    const panel   = document.getElementById('basketPanel');
    const overlay = document.getElementById('basketOverlay');
    panel.classList.add('open');
    overlay.classList.remove('hidden');
  }

  // per-user persistence (survives logout / long gaps on the same device)
  function userKey() { return ((session.firm||'')+'|'+(session.contact||'')).toLowerCase().replace(/[^a-z0-9|]/g,''); }
  function basketStoreKey() { return 'ra_basket_' + userKey(); }
  function ordersStoreKey() { return 'ra_orders_' + userKey(); }   // shared with Honda

  function saveBasketToStorage() {
    try { localStorage.setItem(basketStoreKey(), JSON.stringify(basket)); } catch(_) {}
  }

  function loadBasketFromStorage() {
    try {
      let saved = localStorage.getItem(basketStoreKey());
      if (!saved && session.firm) {            // one-time migration from the old global key
        const legacy = localStorage.getItem('ra_basket');
        if (legacy) { saved = legacy; localStorage.removeItem('ra_basket'); }
      }
      basket = saved ? JSON.parse(saved) : {};
    } catch(_) { basket = {}; }
    updateBasketUI();
  }

  function getOrderHistory() {
    try { return JSON.parse(localStorage.getItem(ordersStoreKey()) || '[]'); } catch(_) { return []; }
  }
  function saveOrderToHistory(rec) {
    try { const o = getOrderHistory(); o.unshift(rec); localStorage.setItem(ordersStoreKey(), JSON.stringify(o.slice(0,50))); } catch(_) {}
  }

  // ── CHECKOUT ──────────────────────────────────────────
  function openCheckout() {
    const items = Object.values(basket);
    if (!items.length) return;

    document.getElementById('co_firm').value          = session.firm;
    document.getElementById('co_contact').value = session.contact;
    document.getElementById('co_items').textContent   = `${items.length} items · ${basketTotalQty()} pcs`;

    document.getElementById('co_list').innerHTML = items.map(i => `
      <div class="ol-item">
        <span class="ol-pn">${esc(i.as_part_number)}</span>
        <span class="ol-desc">${esc(i.description)}</span>
        <span class="ol-qty">×${i.qty}</span>
      </div>`).join('');

    const msg = document.getElementById('checkoutMsg');
    msg.classList.add('hidden');
    msg.className = 'checkout-msg hidden';
    document.getElementById('placeOrderBtn').disabled = false;
    document.getElementById('placeOrderBtn').textContent = '✓ Place Order & Send';

    document.getElementById('checkoutOverlay').classList.remove('hidden');
    document.getElementById('checkoutModal').classList.remove('hidden');

    // Close basket
    document.getElementById('basketPanel').classList.remove('open');
    document.getElementById('basketOverlay').classList.add('hidden');
  }

  function closeCheckout() {
    document.getElementById('checkoutOverlay').classList.add('hidden');
    document.getElementById('checkoutModal').classList.add('hidden');
  }

  // ── PREVIOUS ORDERS (server-backed, cross-device by mobile) ──────────
  function mergeOrders(local, server) {
    const map = {};
    (server || []).concat(local || []).forEach(o => {
      const k = o.oid || ('L' + o.ts);
      if (!map[k]) map[k] = o;
    });
    return Object.values(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  async function openOrders() {
    const body = document.getElementById('ordersBody');
    body.innerHTML = '<div class="ord-empty">Loading your orders…</div>';
    document.getElementById('ordersOverlay').classList.remove('hidden');
    document.getElementById('ordersModal').classList.remove('hidden');
    let orders = getOrderHistory();
    try {
      const r = await fetch('/api/orders?contact=' + encodeURIComponent(session.contact || ''));
      if (r.ok) orders = mergeOrders(orders, await r.json());
    } catch (_) {}
    renderOrders(orders);
  }
  let _ordersView = [];
  function renderOrders(orders) {
    _ordersView = orders;
    const body = document.getElementById('ordersBody');
    body.innerHTML = orders.length ? orders.map((o, idx) => {
      const d = new Date(o.ts);
      const when = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' +
                   d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      const tag = o.portal === 'honda'
        ? '<span class="ord-tag honda">Honda</span>' : '<span class="ord-tag aero">Aerostar</span>';
      const st = o.status || 'pending';
      const stLbl = {pending:'⏳ Pending', partial:'🚚 Partly sent', dispatched:'✅ Dispatched'}[st] || '⏳ Pending';
      const statusBadge = `<span class="ord-st ${st}">${stLbl}</span>`;
      const lines = o.items.map(it => {
        const disp = Math.min(it.disp||0, it.qty);
        const s = disp>=it.qty ? '<span class="oi-ok">✓ sent</span>'
                : disp>0 ? `<span class="oi-part">${disp}/${it.qty} sent · ${it.qty-disp} pending</span>`
                : '<span class="oi-pend">pending</span>';
        return `${esc(it.name)} <b>×${it.qty}</b> — ${s}`;
      }).join('<br>');
      const canReorder = o.portal !== 'honda';
      const reorder = canReorder ? `<button class="ord-reorder" onclick="App.reorder(${idx})">↺ Add these to basket</button>` : '';
      return `<div class="ord-card">
        <div class="ord-top"><span class="ord-date">${when}</span><span style="display:flex;gap:6px;align-items:center">${statusBadge}${tag}</span></div>
        <div class="ord-meta">${o.items.length} item(s) · ${o.totalQty} pcs${o.totalAmt?` · ₹${Number(o.totalAmt).toLocaleString('en-IN')}`:''}</div>
        <div class="ord-lines">${lines}</div>${reorder}</div>`;
    }).join('') : '<div class="ord-empty">No previous orders yet. Orders you place will appear here.</div>';
    document.getElementById('ordersOverlay').classList.remove('hidden');
    document.getElementById('ordersModal').classList.remove('hidden');
  }
  function closeOrders() {
    document.getElementById('ordersOverlay').classList.add('hidden');
    document.getElementById('ordersModal').classList.add('hidden');
  }
  function reorder(idx) {
    const o = _ordersView[idx];
    if (!o) return;
    let added = 0;
    o.items.forEach(it => {
      const p = allProducts.find(x => x.as_part_number === it.part_no);
      if (p) { basket[it.part_no] = { ...p, qty: (basket[it.part_no]?.qty || 0) + it.qty }; added++; }
    });
    saveBasketToStorage();
    updateBasketUI();
    closeOrders();
  }

  function placeOrder() {
    const items = Object.values(basket).map(i => ({
      as_part_number:  i.as_part_number,
      sai_part_number: i.sai_part_number || '',
      description:     i.description,
      vehicle:         i.vehicle || '',
      colour:          i.colour || '',
      mrp:             i.mrp || '',
      qty:             i.qty,
    }));

    if (!items.length) return;

    const oid = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const btn = document.getElementById('placeOrderBtn');
    btn.disabled    = true;
    btn.textContent = 'Placing order…';

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firm_name:      (document.getElementById('co_firm').value.trim() || session.firm),
        contact_number: (document.getElementById('co_contact').value.trim() || session.contact),
        portal: 'aerostar', oid,
        items,
      })
    })
    .then(r => r.json())
    .then(data => {
      const msg = document.getElementById('checkoutMsg');
      if (data.success) {
        saveOrderToHistory({
          oid, ts: Date.now(), portal: 'aerostar',
          totalQty: items.reduce((s,i)=>s+(i.qty||0),0),
          totalAmt: items.reduce((s,i)=>s+((Number(i.mrp)||0)*(i.qty||0)),0),
          items: items.map(i => ({ part_no: i.as_part_number, name: i.description, price: (Number(i.mrp)||null), qty: i.qty }))
        });
        msg.innerHTML = `✅ Order placed!<br><small>📲 Notifying Fiber order grp on WhatsApp…</small>`;
        msg.className   = 'checkout-msg success';
        msg.classList.remove('hidden');
        btn.textContent = '✓ Order Placed!';

        if (data.download) {
          const a = document.createElement('a');
          a.href  = `/download/${data.download}`;
          a.download = data.download;
          a.click();
        }
        clearBasket();
        setTimeout(closeCheckout, 5000);
      } else {
        msg.textContent = data.error || 'Something went wrong.';
        msg.className   = 'checkout-msg error';
        msg.classList.remove('hidden');
        btn.disabled    = false;
        btn.textContent = '✓ Place Order & Send';
      }
    })
    .catch(() => {
      const msg = document.getElementById('checkoutMsg');
      msg.textContent = 'Network error. Please try again.';
      msg.className   = 'checkout-msg error';
      msg.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = '✓ Place Order & Send';
    });
  }

  // ── SETTINGS ──────────────────────────────────────────
  function loadSettings() {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        document.getElementById('cfg_email').value     = c.order_email || '';
        document.getElementById('cfg_smtp_host').value = c.smtp_host   || 'smtp.gmail.com';
        document.getElementById('cfg_smtp_port').value = c.smtp_port   || 587;
        document.getElementById('cfg_smtp_user').value = c.smtp_user   || '';
      })
      .catch(() => {});
  }

  function openSettings() {
    loadSettings();
    document.getElementById('settingsMsg').classList.add('hidden');
    document.getElementById('settingsOverlay').classList.remove('hidden');
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  function closeSettings() {
    document.getElementById('settingsOverlay').classList.add('hidden');
    document.getElementById('settingsModal').classList.add('hidden');
  }

  function saveSettings() {
    const cfg = {
      order_email: document.getElementById('cfg_email').value.trim(),
      smtp_host:   document.getElementById('cfg_smtp_host').value.trim(),
      smtp_port:   parseInt(document.getElementById('cfg_smtp_port').value) || 587,
      smtp_user:   document.getElementById('cfg_smtp_user').value.trim(),
      smtp_pass:   document.getElementById('cfg_smtp_pass').value,
    };

    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    })
    .then(r => r.json())
    .then(() => {
      const msg = document.getElementById('settingsMsg');
      msg.textContent = 'Settings saved!';
      msg.className   = 'checkout-msg success';
      msg.classList.remove('hidden');
      setTimeout(closeSettings, 1500);
    })
    .catch(() => {
      const msg = document.getElementById('settingsMsg');
      msg.textContent = 'Failed to save settings.';
      msg.className   = 'checkout-msg error';
      msg.classList.remove('hidden');
    });
  }

  // ── UTILS ─────────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uniqueValues(arr, key) {
    return [...new Set(arr.map(x => x[key]).filter(Boolean))];
  }

  function showLoader(text = 'Loading…') {
    document.getElementById('loaderText').textContent = text;
    document.getElementById('loadingOverlay').classList.remove('hidden');
  }

  function hideLoader() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  // ── VEHICLE LOOKUP ────────────────────────────────────

  function renderVehicleLookupScreen() {
    document.getElementById('mainContent').innerHTML = `
      <div class="vehicle-lookup-wrap">
        <div class="lookup-hero">
          <div class="lookup-icon">🏍️</div>
          <h2>Find Parts by Vehicle</h2>
          <p>Enter your vehicle registration number to instantly find all compatible parts</p>
        </div>

        <div class="lookup-form">
          <div class="lookup-input-wrap">
            <input id="regNumberInput" class="lookup-input" type="text"
              placeholder="e.g. MH12AB1234"
              maxlength="12"
              oninput="this.value=this.value.toUpperCase()"
              onkeydown="if(event.key==='Enter')App.doVehicleLookup()" />
            <button class="btn-primary lookup-btn" onclick="App.doVehicleLookup()">
              🔍 Find Parts
            </button>
          </div>
          <div class="lookup-hint">Works with any Indian vehicle registration (RC) number</div>
        </div>

        <div id="lookupResult" class="lookup-result hidden"></div>
      </div>`;
    // Focus input
    const inp = document.getElementById('regNumberInput');
    if (inp) setTimeout(() => inp.focus(), 60);
  }

  function openVehicleLookup() {
    navStack.push({ view: 'vehicleLookup', title: 'Find by Vehicle No.' });
    renderBreadcrumb();
    document.getElementById('backBtn').style.visibility = 'visible';
    renderVehicleLookupScreen();
  }

  async function doVehicleLookup() {
    const regEl = document.getElementById('regNumberInput');
    if (!regEl) return;
    const reg = regEl.value.trim();
    if (!reg) return;

    const resultEl = document.getElementById('lookupResult');
    resultEl.innerHTML = '<div class="lookup-loading">🔄 Looking up vehicle…</div>';
    resultEl.classList.remove('hidden');

    try {
      const res  = await fetch('/api/vehicle-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reg_number: reg })
      });
      const data = await res.json();

      if (data.success) {
        const v = data.vehicle;
        const modelDisplay = (v.model || data.model || '').replace(/_/g,' ');
        const noPartsMsg   = data.parts_count === 0
          ? `<div class="lv-no-parts">⚠️ No parts found in catalogue for this model yet</div>` : '';
        resultEl.innerHTML = `
          <div class="lookup-vehicle-card">
            <div class="lv-header">
              <span class="lv-reg">${esc(v.rc_number || reg)}</span>
              <span class="lv-badge ${BRAND_COLORS[data.brand] || 'brand-other'}">${esc(data.brand || '')}</span>
            </div>
            <div class="lv-model">${esc(modelDisplay)}</div>
            <div class="lv-meta">
              ${v.year         ? `<span>📅 ${esc(v.year)}</span>`          : ''}
              ${v.fuel_type    ? `<span>⛽ ${esc(v.fuel_type)}</span>`     : ''}
              ${v.colour       ? `<span>🎨 ${esc(v.colour)}</span>`        : ''}
              ${v.vehicle_class? `<span>🏍️ ${esc(v.vehicle_class)}</span>`: ''}
            </div>
            ${v.owner_name ? `<div class="lv-owner">👤 ${esc(v.owner_name)}</div>` : ''}
            ${noPartsMsg}
            <div class="lv-parts-count">${data.parts_count} compatible parts found</div>
            <button class="btn-primary btn-full" style="margin-top:16px" ${data.parts_count===0?'disabled':''}
              onclick="App.showPartsForVehicle('${esc(data.brand)}','${esc(data.model)}')">
              ${data.parts_count > 0 ? `View ${data.parts_count} Compatible Parts →` : 'No Parts Available'}
            </button>
          </div>`;
      } else {
        resultEl.innerHTML = `<div class="lookup-error">❌ ${esc(data.error)}</div>`;
      }
    } catch(e) {
      resultEl.innerHTML = '<div class="lookup-error">❌ Network error. Please try again.</div>';
    }
  }

  function showPartsForVehicle(brand, model) {
    if (!brand && !model) return;

    const brandLower = brand.toLowerCase();
    const modelUpper = model.toUpperCase();

    // Normalise model to keywords (strip noise words)
    const noise = new Set(['BS6','BS4','BS-6','BS-4','FI','STD','DLX','DELUXE','DRUM','DISC']);
    const modelWords = modelUpper.split(/\s+/).filter(w => w.length > 1 && !noise.has(w));

    const matched = allProducts.filter(p => {
      if (brand && (p.brand || '').toLowerCase() !== brandLower) return false;
      if (!modelWords.length) return true;
      const v = (p.vehicle || '').toUpperCase();
      return modelWords.some(w => v.includes(w));
    });

    const title = `${brand} ${model}`.trim();
    navStack.push({ view: 'parts', params: { searchResults: matched }, title });
    renderBreadcrumb();
    document.getElementById('backBtn').style.visibility = 'visible';
    renderParts({ searchResults: matched });
    document.getElementById('mainContent').scrollTop = 0;
  }

  // ── PUBLIC API ────────────────────────────────────────
  return {
    login, navigateTo, goBack, goHome, jumpTo,
    addToBasket, addToBasketDt, removeFromBasket, updateBasketQty, clearBasket,
    toggleBasket, openBasketQuick,
    openCheckout, closeCheckout, placeOrder,
    openOrders, closeOrders, reorder,
    openSettings, closeSettings, saveSettings,
    onSearch, onSearchKey, showSearchDropdown, clearSearch,
    searchItemClick, setSearchFocus,
    filterInlineList,
    openVehicleLookup, doVehicleLookup, showPartsForVehicle,
    imgFallback,
  };
})();

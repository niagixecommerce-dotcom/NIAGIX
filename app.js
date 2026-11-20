(() => {
  'use strict';

  const STORAGE_KEY = 'niagakira_state_v2';

  const CATEGORIES = {
    income: [
      { id: 'Jualan Produk', label: 'Jualan Produk', icon: '🛍️', color: '#6338EC', bg: '#EDE8FE' },
      { id: 'Perkhidmatan', label: 'Perkhidmatan', icon: '💼', color: '#16A34A', bg: '#E8F9EE' },
      { id: 'Tempahan Khas', label: 'Tempahan Khas', icon: '✨', color: '#4F46E5', bg: '#E9EDFE' },
      { id: 'Lain-lain Masuk', label: 'Lain-lain Masuk', icon: '💰', color: '#0EA5E9', bg: '#E0F2FE' }
    ],
    expense: [
      { id: 'Stok & Bahan', label: 'Stok & Bahan', icon: '📦', color: '#6338EC', bg: '#EDE8FE' },
      { id: 'Pengangkutan', label: 'Pengangkutan', icon: '🚚', color: '#F59E0B', bg: '#FEF0E4' },
      { id: 'Makan & Jamuan', label: 'Makan & Jamuan', icon: '☕', color: '#EC4899', bg: '#FCEAF4' },
      { id: 'Pemasaran', label: 'Pemasaran', icon: '📣', color: '#8B5CF6', bg: '#F3E8FF' },
      { id: 'Utiliti & Sewa', label: 'Utiliti & Sewa', icon: '⚡', color: '#06B6D4', bg: '#CFFAFE' },
      { id: 'Gaji & Upah', label: 'Gaji & Upah', icon: '👥', color: '#10B981', bg: '#D1FAE5' },
      { id: 'Lain-lain', label: 'Lain-lain', icon: '🧾', color: '#64748B', bg: '#F1F5F9' }
    ]
  };

  function isoDaysAgo(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }

  function createDefaultState() {
    return {
      profile: {
        bizName: 'Perniagaan Saya',
        ownerName: 'Usahawan',
        ssm: '',
        phone: '',
        email: '',
        address: '',
        receiptPrefix: 'RES',
        monthlyBudget: 0
      },
      accounts: [
        {
          id: 'acc_bank',
          name: 'Akaun Bank Perniagaan',
          brand: 'BANK',
          last4: '0000',
          openingBalance: 0,
          toggles: { lockCard: false, onlinePay: true, duitNow: true, contactless: false }
        },
        {
          id: 'acc_cash',
          name: 'Tunai di Tangan',
          brand: 'TUNAI',
          last4: '0001',
          openingBalance: 0,
          toggles: { lockCard: false, onlinePay: false, duitNow: false, contactless: false }
        }
      ],
      activeAccountId: 'acc_bank',
      transactions: [],
      receipts: [],
      products: [],
      chartMode: 'expense'
    };
  }

  let state = loadState();
  let currentPreviewReceiptId = null;
  let pendingTxImageData = '';
  let pendingProdImageData = '';
  let pendingProfileLogo = '';

  const FIREBASE_DB_URL = 'https://niagix-default-rtdb.asia-southeast1.firebasedatabase.app';
  const TOKEN_KEY = 'niagakira_token';
  const LOCAL_USERS_KEY = 'niagix_local_users_v1';
  const IS_HTTP = location.protocol.startsWith('http');
  const IS_STATIC_HOST = !IS_HTTP || location.hostname.endsWith('github.io');

  function emailToFirebaseKey(email) {
    const clean = String(email || '').trim().toLowerCase();
    return btoa(unescape(encodeURIComponent(clean)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function hashPasswordClient(pw) {
    const raw = `niagix_salt_${pw}`;
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return btoa(unescape(encodeURIComponent(raw)));
  }

  async function fbRequest(path, method = 'GET', body = null) {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== null ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ralat Firebase (${res.status}): ${errText || 'Gagal berhubung dengan pangkalan data'}`);
    }
    return res.json();
  }

  function getAuthToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function loadLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveLocalUsers(users) {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  async function apiRequest(url, options = {}) {
    const token = getAuthToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, Object.assign({}, options, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Ralat pelayan');
    }
    return data;
  }

  function loadState() {
    try {
      localStorage.removeItem('niagakira_state_v1');
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.products)) {
          parsed.products = [];
        }
        return parsed;
      }
    } catch (e) {
      console.warn('Gagal membaca localStorage:', e);
    }
    return createDefaultState();
  }

  let syncTimer = null;
  function saveState(nextState = state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      const token = getAuthToken();
      if (token.startsWith('local:')) {
        const email = token.slice(6);
        const users = loadLocalUsers();
        if (users[email]) {
          users[email].state = nextState;
          saveLocalUsers(users);
        }
      }
    } catch (e) {
      showToast('Amaran: Storan penuh, cuba buang gambar bersaiz besar.');
    }
    const token = getAuthToken();
    if (token.startsWith('fb:')) {
      const userKey = emailToFirebaseKey(token.slice(3));
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        fbRequest(`users/${userKey}/state`, 'PUT', nextState)
          .catch((err) => console.warn('Gagal segerak ke Firebase:', err.message));
      }, 250);
    } else if (!IS_STATIC_HOST && token) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        apiRequest('/api/state', {
          method: 'PUT',
          body: JSON.stringify({ state: nextState })
        }).catch((err) => console.warn('Gagal segerak ke pelayan:', err.message));
      }, 250);
    }
  }

  function compressImageToDataUrl(file, maxSide = 600, callback) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w >= h) { h = Math.round((h * maxSide) / w); w = maxSide; }
          else { w = Math.round((w * maxSide) / h); h = maxSide; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function uploadOrKeepImage(file, maxSide, onDone) {
    compressImageToDataUrl(file, maxSide, async (dataUrl) => {
      if (!IS_STATIC_HOST && getAuthToken()) {
        try {
          const res = await apiRequest('/api/upload', {
            method: 'POST',
            body: JSON.stringify({ dataUrl })
          });
          onDone(res.url);
          return;
        } catch (err) {
          console.warn('Muat naik ke pelayan gagal, guna dataUrl:', err.message);
        }
      }
      onDone(dataUrl);
    });
  }

  // Formatting Helpers
  function rm(num) {
    const val = Number(num) || 0;
    return 'RM ' + val.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function rmShort(num) {
    const val = Number(num) || 0;
    return 'RM ' + Math.round(val).toLocaleString('en-MY');
  }

  function formatDateMY(iso) {
    if (!iso) return '-';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getCategoryMeta(type, catId) {
    const list = CATEGORIES[type] || CATEGORIES.expense;
    return list.find(c => c.id === catId) || { id: catId, label: catId, icon: '📌', color: '#6338EC', bg: '#EDE8FE' };
  }

  function getAccountName(accId) {
    const acc = state.accounts.find(a => a.id === accId);
    return acc ? acc.name : 'Tunai';
  }

  function calcAccountBalance(acc) {
    const delta = state.transactions
      .filter(t => t.accountId === acc.id)
      .reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);
    return (Number(acc.openingBalance) || 0) + delta;
  }

  function calcTotalBalance() {
    return state.accounts.reduce((sum, acc) => sum + calcAccountBalance(acc), 0);
  }

  function calcReceiptTotal(rec) {
    const subtotal = rec.items.reduce((s, it) => s + (Number(it.qty) * Number(it.price)), 0);
    const afterDisc = Math.max(0, subtotal - (Number(rec.discount) || 0));
    const tax = afterDisc * ((Number(rec.taxPct) || 0) / 100);
    return { subtotal, tax, total: afterDisc + tax };
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // Navigation
  function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    renderAll();
  }

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('[data-view-jump]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.viewJump));
  });

  // Desktop / Mobile Layout Mode
  function setLayoutMode(mode) {
    const resolved = mode === 'mobile' ? 'mobile' : 'desktop';
    state.layoutMode = resolved;
    document.body.classList.toggle('mode-mobile', resolved === 'mobile');
    document.querySelectorAll('[data-layout]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === resolved);
    });
    saveState();
  }

  document.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => setLayoutMode(btn.dataset.layout));
  });

  // Modals
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });

  // Greeting & Header
  function renderHeader() {
    const hr = new Date().getHours();
    let greet = 'Selamat pagi,';
    if (hr >= 12 && hr < 15) greet = 'Selamat tengah hari,';
    else if (hr >= 15 && hr < 19) greet = 'Selamat petang,';
    else if (hr >= 19) greet = 'Selamat malam,';

    document.getElementById('greetingTime').textContent = greet;
    document.getElementById('headerOwnerName').textContent = `${state.profile.ownerName} 👋`;
    document.getElementById('sidebarBizName').textContent = state.profile.bizName;
    document.getElementById('sidebarSsm').textContent = `SSM: ${state.profile.ssm || '-'}`;

    const initials = state.profile.bizName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('') || 'NK';
    document.getElementById('sidebarAvatar').textContent = initials;
    document.getElementById('headerAvatarText').textContent = initials;
  }

  // Dashboard (View 1)
  function renderHome() {
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const monthTxs = state.transactions.filter(t => t.date.startsWith(ym));
    const monthIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const monthExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const netProfit = monthIncome - monthExpense;

    document.getElementById('heroTotalBalance').textContent = rm(calcTotalBalance());
    document.getElementById('heroNetProfit').textContent = rm(netProfit);
    document.getElementById('heroMonthIncome').textContent = rmShort(monthIncome);
    document.getElementById('heroMonthExpense').textContent = rmShort(monthExpense);

    renderHomeDonut(monthTxs.filter(t => t.type === 'expense'), monthExpense);
    renderTxList(
      [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      'homeRecentTx',
      false
    );
    renderHomeRecentReceipts();
  }

  function renderHomeDonut(expenseTxs, totalExp) {
    const wrap = document.getElementById('homeDonutChart');
    const legend = document.getElementById('homeDonutLegend');

    const grouped = {};
    expenseTxs.forEach(t => {
      grouped[t.category] = (grouped[t.category] || 0) + Number(t.amount);
    });

    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 4);

    if (!entries.length || totalExp <= 0) {
      wrap.innerHTML = `<div class="donut-center"><strong>RM 0</strong><span>Bulan Ini</span></div>`;
      legend.innerHTML = `<div class="empty-state">Tiada perbelanjaan direkodkan bulan ini.</div>`;
      return;
    }

    const r = 56;
    const c = 2 * Math.PI * r;
    let offset = 0;

    const circles = entries.map(([catId, val]) => {
      const meta = getCategoryMeta('expense', catId);
      const frac = val / totalExp;
      const dash = frac * c;
      const seg = `<circle cx="76" cy="76" r="${r}" fill="none" stroke="${meta.color}" stroke-width="20" stroke-dasharray="${dash} ${c}" stroke-dashoffset="${-offset}" stroke-linecap="butt" />`;
      offset += dash;
      return seg;
    }).join('');

    wrap.innerHTML = `
      <svg width="152" height="152" viewBox="0 0 152 152" style="transform: rotate(-90deg);">
        <circle cx="76" cy="76" r="${r}" fill="none" stroke="#F1EEFA" stroke-width="20" />
        ${circles}
      </svg>
      <div class="donut-center">
        <strong>${rmShort(totalExp)}</strong>
        <span>Bulan Ini</span>
      </div>
    `;

    legend.innerHTML = entries.map(([catId, val]) => {
      const meta = getCategoryMeta('expense', catId);
      const pct = Math.round((val / totalExp) * 100);
      return `
        <div class="legend-row">
          <div class="legend-left">
            <span class="legend-dot" style="background:${meta.color}"></span>
            <span>${meta.label}</span>
          </div>
          <span class="legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  function renderHomeRecentReceipts() {
    const container = document.getElementById('homeRecentReceipts');
    const list = [...state.receipts].slice(0, 3);
    if (!list.length) {
      container.innerHTML = `<div class="empty-state">Belum ada resit dijana.</div>`;
      return;
    }
    container.innerHTML = list.map(rec => {
      const { total } = calcReceiptTotal(rec);
      return `
        <div class="tx-row">
          <div class="tx-left">
            <div class="tx-badge" style="background:#EDE8FE">🧾</div>
            <div class="tx-info">
              <div class="tx-title">${escapeHtml(rec.customerName)}</div>
              <div class="tx-meta">${rec.number} · ${formatDateMY(rec.date)}</div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount">${rm(total)}</div>
            <div class="tx-actions-mini">
              <button class="mini-chip-btn" onclick="window._niaga.previewReceipt('${rec.id}')">Lihat Resit</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Sales & Products (View 2A) & Expenses (View 2B)
  function populateSeparatedFilters() {
    const months = [...new Set(state.transactions.map(t => t.date.slice(0, 7)))].sort().reverse();

    const sCat = document.getElementById('salesFilterCategory');
    const prevSCat = sCat.value;
    sCat.innerHTML = `<option value="all">Semua Kategori Jualan</option>` +
      CATEGORIES.income.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
    sCat.value = prevSCat || 'all';

    const sMonth = document.getElementById('salesFilterMonth');
    const prevSMonth = sMonth.value;
    sMonth.innerHTML = `<option value="all">Semua Bulan</option>` +
      months.map(m => `<option value="${m}">${m}</option>`).join('');
    sMonth.value = prevSMonth || 'all';

    const eCat = document.getElementById('expFilterCategory');
    const prevECat = eCat.value;
    eCat.innerHTML = `<option value="all">Semua Kategori Belanja</option>` +
      CATEGORIES.expense.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
    eCat.value = prevECat || 'all';

    const eMonth = document.getElementById('expFilterMonth');
    const prevEMonth = eMonth.value;
    eMonth.innerHTML = `<option value="all">Semua Bulan</option>` +
      months.map(m => `<option value="${m}">${m}</option>`).join('');
    eMonth.value = prevEMonth || 'all';
  }

  function renderProductsGrid() {
    const grid = document.getElementById('productsGrid');
    document.getElementById('productsCountLabel').textContent = `${state.products.length} produk`;
    if (!state.products.length) {
      grid.innerHTML = `<div class="empty-state">Belum ada produk. Klik "+ Tambah Produk" untuk menambah katalog jualan anda.</div>`;
      return;
    }

    grid.innerHTML = state.products.map(p => `
      <div class="product-card">
        <div class="prod-top">
          <div class="prod-emoji">
            ${p.image
              ? `<img src="${p.image}" class="prod-thumb" alt="${escapeHtml(p.name)}" />`
              : escapeHtml(p.emoji || '🛍️')}
          </div>
          <div class="tx-actions-mini">
            <button class="mini-chip-btn" onclick="window._niaga.editProduct('${p.id}')">Edit</button>
            <button class="mini-chip-btn danger" onclick="window._niaga.deleteProduct('${p.id}')">Padam</button>
          </div>
        </div>
        <div>
          <div class="prod-name">${escapeHtml(p.name)}</div>
          <div class="prod-cat">${escapeHtml(p.category)} · Kod Resit: <strong>${escapeHtml(p.receiptPrefix || state.profile.receiptPrefix || 'RES')}</strong></div>
        </div>
        <div class="prod-price">${rm(p.price)} ${p.unit ? `<span class="prod-unit">/ ${escapeHtml(p.unit)}</span>` : ''}</div>
        <div class="prod-actions">
          <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center;" onclick="window._niaga.sellProduct('${p.id}')">+ Jual Produk Ini</button>
        </div>
      </div>
    `).join('');
  }

  function renderSalesView() {
    populateSeparatedFilters();
    renderProductsGrid();

    const q = document.getElementById('salesSearch').value.trim().toLowerCase();
    const catF = document.getElementById('salesFilterCategory').value;
    const monthF = document.getElementById('salesFilterMonth').value;

    const filtered = state.transactions
      .filter(t => {
        if (t.type !== 'income') return false;
        if (catF !== 'all' && t.category !== catF) return false;
        if (monthF !== 'all' && !t.date.startsWith(monthF)) return false;
        if (q && !(`${t.title} ${t.category} ${t.notes || ''}`).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const totSales = filtered.reduce((s, t) => s + Number(t.amount), 0);
    const withReceipt = filtered.filter(t => t.receiptId && state.receipts.some(r => r.id === t.receiptId)).length;

    document.getElementById('salesSummaryStrip').innerHTML = `
      <div class="strip-box"><span>Jumlah Jualan (Tapisan)</span><strong style="color:var(--success)">+${rm(totSales)}</strong></div>
      <div class="strip-box"><span>Bilangan Jualan</span><strong>${filtered.length} rekod</strong></div>
      <div class="strip-box"><span>Resit Dijana</span><strong style="color:var(--primary)">${withReceipt} / ${filtered.length}</strong></div>
    `;

    renderTxList(filtered, 'salesList', true);
  }

  function renderExpensesView() {
    populateSeparatedFilters();

    const q = document.getElementById('expSearch').value.trim().toLowerCase();
    const catF = document.getElementById('expFilterCategory').value;
    const monthF = document.getElementById('expFilterMonth').value;

    const filtered = state.transactions
      .filter(t => {
        if (t.type !== 'expense') return false;
        if (catF !== 'all' && t.category !== catF) return false;
        if (monthF !== 'all' && !t.date.startsWith(monthF)) return false;
        if (q && !(`${t.title} ${t.category} ${t.notes || ''}`).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const totExp = filtered.reduce((s, t) => s + Number(t.amount), 0);
    const byCat = {};
    filtered.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

    document.getElementById('expSummaryStrip').innerHTML = `
      <div class="strip-box"><span>Jumlah Perbelanjaan</span><strong style="color:var(--danger)">-${rm(totExp)}</strong></div>
      <div class="strip-box"><span>Bilangan Rekod</span><strong>${filtered.length} rekod</strong></div>
      <div class="strip-box"><span>Kategori Tertinggi</span><strong>${topCat ? escapeHtml(topCat[0]) : '-'}</strong></div>
    `;

    renderTxList(filtered, 'expensesList', true);
  }

  function renderTxList(list, containerId, showControls) {
    const container = document.getElementById(containerId);
    if (!list.length) {
      container.innerHTML = `<div class="empty-state">Tiada transaksi ditemui.</div>`;
      return;
    }

    container.innerHTML = list.map(t => {
      const meta = getCategoryMeta(t.type, t.category);
      const sign = t.type === 'income' ? '+' : '-';
      const linkedRec = t.receiptId ? state.receipts.find(r => r.id === t.receiptId) : null;
      const saleReceiptBtn = t.type === 'income'
        ? (linkedRec
            ? `<button class="mini-chip-btn" onclick="window._niaga.previewReceipt('${linkedRec.id}')">🧾 Lihat Resit</button>`
            : `<button class="mini-chip-btn" onclick="window._niaga.generateReceiptFromSale('${t.id}')">🧾 Jana Resit</button>`)
        : '';
      return `
        <div class="tx-row">
          <div class="tx-left">
            <div class="tx-badge" style="background:${meta.bg}">${meta.icon}</div>
            <div class="tx-info">
              <div class="tx-title">${escapeHtml(t.title)}</div>
              <div class="tx-meta">
                <span>${meta.label}</span> ·
                <span>${formatDateMY(t.date)}</span> ·
                <span>${escapeHtml(getAccountName(t.accountId))}</span>
                ${t.receiptImg ? `· <button class="mini-chip-btn" onclick="window._niaga.viewImage('${t.id}')">📎 Resit</button>` : ''}
              </div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${t.type}">${sign} ${rm(t.amount)}</div>
            <div class="tx-actions-mini">
              ${saleReceiptBtn}
              ${showControls ? `
                <button class="mini-chip-btn" onclick="window._niaga.editTx('${t.id}')">Edit</button>
                <button class="mini-chip-btn danger" onclick="window._niaga.deleteTx('${t.id}')">Padam</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Add / Edit Transaction Modal
  function setTxModalType(type) {
    document.querySelectorAll('.type-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.txType === type);
    });
    const catSelect = document.getElementById('txCategory');
    catSelect.innerHTML = CATEGORIES[type].map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');

    const accSelect = document.getElementById('txAccount');
    accSelect.innerHTML = state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    const autoRecWrap = document.getElementById('txAutoReceiptWrap');
    if (autoRecWrap) {
      autoRecWrap.style.display = type === 'income' ? 'flex' : 'none';
    }

    const receiptGroup = document.getElementById('txReceiptUploadGroup');
    if (receiptGroup) {
      receiptGroup.style.display = type === 'expense' ? 'flex' : 'none';
    }

    const titleLabel = document.getElementById('txTitleLabel');
    const titleInput = document.getElementById('txTitle');
    if (titleLabel && titleInput) {
      if (type === 'income') {
        titleLabel.textContent = 'Nama Pelanggan / Penerangan Jualan';
        titleInput.placeholder = 'Cth: Ahmad — Kek Batik';
      } else {
        titleLabel.textContent = 'Penerangan / Nama Pembekal';
        titleInput.placeholder = 'Cth: Beli bahan mentah / Bil Elektrik';
      }
    }

    const prodWrap = document.getElementById('txProductPickerWrap');
    if (prodWrap) {
      prodWrap.style.display = type === 'income' ? 'grid' : 'none';
      const prodSelect = document.getElementById('txProductSelect');
      prodSelect.innerHTML = `<option value="">-- Pilih Produk --</option>` +
        state.products.map(p => `<option value="${p.id}">${escapeHtml(p.emoji || '🛍️')} ${escapeHtml(p.name)} (${rm(p.price)})</option>`).join('');
    }
  }

  function applySelectedProductToTx() {
    const prodId = document.getElementById('txProductSelect').value;
    if (!prodId) return;
    const prod = state.products.find(p => p.id === prodId);
    if (!prod) return;
    const qty = Math.max(1, parseInt(document.getElementById('txQty').value, 10) || 1);
    document.getElementById('txAmount').value = (Number(prod.price) * qty).toFixed(2);
    document.getElementById('txTitle').value = qty > 1 ? `${prod.name} (${qty}x)` : prod.name;
    document.getElementById('txCategory').value = prod.category;
  }

  document.getElementById('txProductSelect').addEventListener('change', applySelectedProductToTx);
  document.getElementById('txQty').addEventListener('input', applySelectedProductToTx);

  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => setTxModalType(pill.dataset.txType));
  });

  function openTxModal(defaultType = 'expense', txToEdit = null, presetProductId = '') {
    document.getElementById('txForm').reset();
    pendingTxImageData = '';
    document.getElementById('txImagePreviewWrap').classList.add('hidden');
    document.getElementById('txQty').value = 1;

    if (txToEdit) {
      document.getElementById('txModalTitle').textContent = 'Kemaskini Transaksi';
      document.getElementById('txId').value = txToEdit.id;
      setTxModalType(txToEdit.type);
      document.getElementById('txAmount').value = txToEdit.amount;
      document.getElementById('txDate').value = txToEdit.date;
      document.getElementById('txTitle').value = txToEdit.title;
      document.getElementById('txCategory').value = txToEdit.category;
      document.getElementById('txAccount').value = txToEdit.accountId;
      document.getElementById('txNotes').value = txToEdit.notes || '';
      if (txToEdit.receiptImg) {
        pendingTxImageData = txToEdit.receiptImg;
        document.getElementById('txImagePreview').src = txToEdit.receiptImg;
        document.getElementById('txImagePreviewWrap').classList.remove('hidden');
      }
    } else {
      document.getElementById('txModalTitle').textContent = defaultType === 'income' ? 'Rekod Jualan Baru' : 'Rekod Perbelanjaan Baru';
      document.getElementById('txId').value = '';
      setTxModalType(defaultType);
      document.getElementById('txDate').value = new Date().toISOString().slice(0, 10);
      if (presetProductId && defaultType === 'income') {
        document.getElementById('txProductSelect').value = presetProductId;
        applySelectedProductToTx();
      }
    }
    openModal('txModal');
  }

  // Product Modal
  function openProductModal(prodToEdit = null) {
    document.getElementById('productForm').reset();
    pendingProdImageData = '';
    document.getElementById('prodImagePreviewWrap').classList.add('hidden');
    document.getElementById('prodCategory').innerHTML = CATEGORIES.income
      .map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');

    if (prodToEdit) {
      document.getElementById('productModalTitle').textContent = 'Kemaskini Produk';
      document.getElementById('prodId').value = prodToEdit.id;
      document.getElementById('prodName').value = prodToEdit.name;
      document.getElementById('prodPrice').value = prodToEdit.price;
      document.getElementById('prodCategory').value = prodToEdit.category;
      document.getElementById('prodUnit').value = prodToEdit.unit || '';
      document.getElementById('prodReceiptPrefix').value = prodToEdit.receiptPrefix || 'RES';
      document.getElementById('prodEmoji').value = prodToEdit.emoji || '🛍️';
      if (prodToEdit.image) {
        pendingProdImageData = prodToEdit.image;
        document.getElementById('prodImagePreview').src = prodToEdit.image;
        document.getElementById('prodImagePreviewWrap').classList.remove('hidden');
      }
    } else {
      document.getElementById('productModalTitle').textContent = 'Tambah Produk / Servis Baru';
      document.getElementById('prodId').value = '';
      document.getElementById('prodReceiptPrefix').value = '';
      document.getElementById('prodEmoji').value = '🛍️';
    }
    openModal('productModal');
  }

  document.getElementById('prodImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadOrKeepImage(file, 450, (url) => {
      pendingProdImageData = url;
      document.getElementById('prodImagePreview').src = url;
      document.getElementById('prodImagePreviewWrap').classList.remove('hidden');
    });
  });

  document.getElementById('btnRemoveProdImg').addEventListener('click', () => {
    pendingProdImageData = '';
    document.getElementById('prodImage').value = '';
    document.getElementById('prodImagePreviewWrap').classList.add('hidden');
  });

  document.getElementById('productForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('prodId').value;
    const payload = {
      id: id || 'prod_' + Date.now(),
      name: document.getElementById('prodName').value.trim(),
      price: parseFloat(document.getElementById('prodPrice').value) || 0,
      category: document.getElementById('prodCategory').value,
      unit: document.getElementById('prodUnit').value.trim(),
      receiptPrefix: (document.getElementById('prodReceiptPrefix').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'RES'),
      emoji: document.getElementById('prodEmoji').value.trim() || '🛍️',
      image: pendingProdImageData
    };

    if (id) {
      const idx = state.products.findIndex(p => p.id === id);
      if (idx !== -1) state.products[idx] = payload;
      showToast('Produk berjaya dikemaskini.');
    } else {
      state.products.unshift(payload);
      showToast('Produk baru ditambah ke katalog!');
    }
    saveState();
    closeModal('productModal');
    renderAll();
  });

  document.getElementById('txReceiptImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadOrKeepImage(file, 800, (url) => {
      pendingTxImageData = url;
      document.getElementById('txImagePreview').src = url;
      document.getElementById('txImagePreviewWrap').classList.remove('hidden');
    });
  });

  document.getElementById('btnRemoveTxImg').addEventListener('click', () => {
    pendingTxImageData = '';
    document.getElementById('txReceiptImage').value = '';
    document.getElementById('txImagePreviewWrap').classList.add('hidden');
  });

  function generateNextReceiptNumber(rawPrefix) {
    const prefix = (String(rawPrefix || 'RES').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'RES');
    const yr = new Date().getFullYear();
    const head = `${prefix}-${yr}-`;
    let maxSeq = 0;
    state.receipts.forEach(r => {
      if (typeof r.number === 'string' && r.number.startsWith(head)) {
        const n = parseInt(r.number.slice(head.length), 10);
        if (!Number.isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    return `${head}${String(maxSeq + 1).padStart(3, '0')}`;
  }

  function resolveReceiptPrefix(productId, fallbackTitle = '') {
    if (productId) {
      const p = state.products.find(pr => pr.id === productId);
      if (p && p.receiptPrefix) return p.receiptPrefix;
    }
    if (fallbackTitle) {
      const low = String(fallbackTitle).toLowerCase();
      const matched = state.products.find(pr => low.includes(String(pr.name || '').toLowerCase()));
      if (matched && matched.receiptPrefix) return matched.receiptPrefix;
    }
    return (state.profile && state.profile.receiptPrefix) ? state.profile.receiptPrefix : 'RES';
  }

  document.getElementById('txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('txId').value;
    const activePill = document.querySelector('.type-pill.active');
    const type = activePill ? activePill.dataset.txType : 'expense';
    const selectedProductId = type === 'income' ? (document.getElementById('txProductSelect').value || '') : '';

    const payload = {
      id: id || 'tx_' + Date.now(),
      type,
      amount: parseFloat(document.getElementById('txAmount').value) || 0,
      date: document.getElementById('txDate').value,
      title: document.getElementById('txTitle').value.trim(),
      category: document.getElementById('txCategory').value,
      accountId: document.getElementById('txAccount').value,
      notes: document.getElementById('txNotes').value.trim(),
      productId: selectedProductId,
      receiptImg: pendingTxImageData
    };

    if (id) {
      const idx = state.transactions.findIndex(t => t.id === id);
      if (idx !== -1) {
        payload.receiptId = state.transactions[idx].receiptId || '';
        if (!payload.productId && state.transactions[idx].productId) {
          payload.productId = state.transactions[idx].productId;
        }
        state.transactions[idx] = payload;
      }
      showToast('Transaksi berjaya dikemaskini.');
      saveState();
      closeModal('txModal');
      renderAll();
      return;
    }

    let autoReceiptId = null;
    const shouldAutoReceipt = type === 'income' && document.getElementById('txAutoReceipt').checked;
    if (shouldAutoReceipt) {
      const prefix = resolveReceiptPrefix(selectedProductId, payload.title);
      const recNumber = generateNextReceiptNumber(prefix);
      const accName = getAccountName(payload.accountId);
      const methodGuess = accName.toLowerCase().includes('tunai')
        ? 'Tunai'
        : (accName.toLowerCase().includes('wallet') || accName.toLowerCase().includes('qr') ? 'DuitNow QR' : 'Pemindahan Bank');

      const newRec = {
        id: 'rec_' + Date.now(),
        number: recNumber,
        date: payload.date,
        customerName: payload.notes || payload.title,
        customerPhone: '',
        method: methodGuess,
        status: 'paid',
        discount: 0,
        taxPct: 0,
        linkedTxId: payload.id,
        items: [{ name: payload.title, qty: 1, price: payload.amount }]
      };
      payload.receiptId = newRec.id;
      state.receipts.unshift(newRec);
      autoReceiptId = newRec.id;
    }

    state.transactions.unshift(payload);
    saveState();
    closeModal('txModal');
    renderAll();

    if (autoReceiptId) {
      showToast('Jualan direkod & resit rasmi dijana!');
      previewReceipt(autoReceiptId);
    } else {
      showToast('Transaksi baru telah direkodkan!');
    }
  });

  // Receipts (View 3)
  function renderReceiptsView() {
    const grid = document.getElementById('receiptsListGrid');
    if (!state.receipts.length) {
      grid.innerHTML = `<div class="card empty-state">Belum ada resit rasmi. Klik "+ Bina Resit Baru" untuk bermula.</div>`;
      return;
    }

    grid.innerHTML = state.receipts.map(rec => {
      const { total } = calcReceiptTotal(rec);
      const isPaid = rec.status === 'paid';
      return `
        <div class="receipt-card">
          <div class="receipt-card-top">
            <span class="rec-no">${escapeHtml(rec.number)}</span>
            <span class="status-pill ${isPaid ? 'paid' : 'unpaid'}">${isPaid ? 'Dibayar' : 'Belum Bayar'}</span>
          </div>
          <div>
            <div class="rec-customer">${escapeHtml(rec.customerName)}</div>
            <div class="muted-label">${formatDateMY(rec.date)} · ${escapeHtml(rec.method)}</div>
          </div>
          <div class="rec-total">${rm(total)}</div>
          <div class="muted-label">${rec.items.length} item disenaraikan</div>
          <div class="rec-actions">
            <button class="btn btn-primary btn-sm" onclick="window._niaga.previewReceipt('${rec.id}')">Pratonton &amp; Cetak</button>
            ${!isPaid ? `<button class="btn btn-soft btn-sm" onclick="window._niaga.markReceiptPaid('${rec.id}')">Tanda Dibayar</button>` : ''}
            <button class="mini-chip-btn danger" onclick="window._niaga.deleteReceipt('${rec.id}')">Padam</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function addReceiptItemRow(name = '', qty = 1, price = '') {
    const container = document.getElementById('receiptItemsContainer');
    const row = document.createElement('div');
    row.className = 'rec-item-row';
    row.innerHTML = `
      <input type="text" class="input rec-it-name" placeholder="Nama produk / servis" value="${escapeHtml(name)}" required />
      <input type="number" class="input rec-it-qty" min="1" step="1" value="${qty}" required />
      <input type="number" class="input rec-it-price" min="0" step="0.01" placeholder="Harga (RM)" value="${price}" required />
      <button type="button" class="btn-xs-danger">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      if (container.children.length > 1) {
        row.remove();
        updateReceiptFormTotal();
      }
    });
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateReceiptFormTotal));
    container.appendChild(row);
    updateReceiptFormTotal();
  }

  function updateReceiptFormTotal() {
    let subtotal = 0;
    document.querySelectorAll('.rec-item-row').forEach(row => {
      const q = parseFloat(row.querySelector('.rec-it-qty').value) || 0;
      const p = parseFloat(row.querySelector('.rec-it-price').value) || 0;
      subtotal += q * p;
    });
    const disc = parseFloat(document.getElementById('recDiscount').value) || 0;
    const taxPct = parseFloat(document.getElementById('recTax').value) || 0;
    const afterDisc = Math.max(0, subtotal - disc);
    const grand = afterDisc + (afterDisc * (taxPct / 100));
    document.getElementById('recGrandTotalPreview').textContent = rm(grand);
  }

  function applySaleToReceiptForm(saleTx) {
    document.getElementById('recLinkedTxId').value = saleTx ? saleTx.id : '';
    document.getElementById('receiptItemsContainer').innerHTML = '';
    if (!saleTx) {
      document.getElementById('recCustomerName').value = '';
      document.getElementById('recDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('recStatus').value = 'paid';
      document.getElementById('recAutoRecordTx').checked = true;
      addReceiptItemRow('', 1, '');
      return;
    }

    const accName = getAccountName(saleTx.accountId).toLowerCase();
    const methodGuess = accName.includes('tunai')
      ? 'Tunai'
      : (accName.includes('wallet') || accName.includes('qr') ? 'DuitNow QR' : 'Pemindahan Bank');

    document.getElementById('recCustomerName').value = saleTx.notes || saleTx.title;
    document.getElementById('recDate').value = saleTx.date;
    document.getElementById('recMethod').value = methodGuess;
    document.getElementById('recStatus').value = 'paid';
    document.getElementById('recAutoRecordTx').checked = false;
    addReceiptItemRow(saleTx.title, 1, saleTx.amount);
  }

  function openReceiptFormModal(saleTx = null) {
    document.getElementById('receiptForm').reset();
    const saleSelect = document.getElementById('recFromSaleSelect');
    const unlinkedSales = state.transactions
      .filter(t => t.type === 'income' && !t.receiptId)
      .sort((a, b) => b.date.localeCompare(a.date));

    saleSelect.innerHTML = `<option value="">-- Masukkan butiran manual --</option>` +
      unlinkedSales.map(t => `<option value="${t.id}">${formatDateMY(t.date)} · ${escapeHtml(t.title)} (${rm(t.amount)})</option>`).join('');

    if (saleTx && saleTx.id) {
      saleSelect.value = saleTx.id;
      applySaleToReceiptForm(saleTx);
    } else {
      saleSelect.value = '';
      applySaleToReceiptForm(null);
    }
    openModal('receiptFormModal');
  }

  document.getElementById('recFromSaleSelect').addEventListener('change', (e) => {
    const tx = state.transactions.find(t => t.id === e.target.value) || null;
    applySaleToReceiptForm(tx);
  });

  document.getElementById('btnAddReceiptItem').addEventListener('click', () => addReceiptItemRow());
  document.getElementById('recDiscount').addEventListener('input', updateReceiptFormTotal);
  document.getElementById('recTax').addEventListener('input', updateReceiptFormTotal);

  document.getElementById('receiptForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const items = [];
    document.querySelectorAll('.rec-item-row').forEach(row => {
      const name = row.querySelector('.rec-it-name').value.trim();
      const qty = parseFloat(row.querySelector('.rec-it-qty').value) || 1;
      const price = parseFloat(row.querySelector('.rec-it-price').value) || 0;
      if (name) items.push({ name, qty, price });
    });

    const linkedTxId = document.getElementById('recLinkedTxId').value;
    const linkedTxObj = linkedTxId ? state.transactions.find(t => t.id === linkedTxId) : null;
    const firstItemName = items[0] ? items[0].name : '';
    const prefix = resolveReceiptPrefix(linkedTxObj ? linkedTxObj.productId : '', linkedTxObj ? linkedTxObj.title : firstItemName);
    const recNumber = generateNextReceiptNumber(prefix);

    const newRec = {
      id: 'rec_' + Date.now(),
      number: recNumber,
      date: document.getElementById('recDate').value,
      customerName: document.getElementById('recCustomerName').value.trim(),
      customerPhone: document.getElementById('recCustomerPhone').value.trim(),
      method: document.getElementById('recMethod').value,
      status: document.getElementById('recStatus').value,
      discount: parseFloat(document.getElementById('recDiscount').value) || 0,
      taxPct: parseFloat(document.getElementById('recTax').value) || 0,
      linkedTxId: linkedTxId || '',
      items
    };

    state.receipts.unshift(newRec);

    if (linkedTxId) {
      const linkedTx = state.transactions.find(t => t.id === linkedTxId);
      if (linkedTx) linkedTx.receiptId = newRec.id;
    } else if (newRec.status === 'paid' && document.getElementById('recAutoRecordTx').checked) {
      const { total } = calcReceiptTotal(newRec);
      const newTxId = 'tx_' + Date.now();
      newRec.linkedTxId = newTxId;
      state.transactions.unshift({
        id: newTxId,
        type: 'income',
        amount: total,
        date: newRec.date,
        title: `Resit ${newRec.number} — ${newRec.customerName}`,
        category: 'Jualan Produk',
        accountId: state.activeAccountId || state.accounts[0].id,
        notes: `Bayaran ${newRec.method}`,
        receiptImg: '',
        receiptId: newRec.id
      });
    }

    saveState();
    closeModal('receiptFormModal');
    renderAll();
    showToast(`Resit ${newRec.number} berjaya dijana!`);
    previewReceipt(newRec.id);
  });

  function getReceiptRecipientName(rec) {
    if (rec && rec.linkedTxId) {
      const linkedTx = state.transactions.find(t => t.id === rec.linkedTxId);
      const firstItem = rec.items && rec.items[0] ? rec.items[0].name : '';
      if (linkedTx && linkedTx.notes && (!rec.customerName || rec.customerName === firstItem || rec.customerName === linkedTx.title)) {
        return linkedTx.notes;
      }
    }
    return (rec && rec.customerName) ? rec.customerName : '-';
  }

  function previewReceipt(recId) {
    const rec = state.receipts.find(r => r.id === recId);
    if (!rec) return;
    currentPreviewReceiptId = recId;
    const { subtotal, tax, total } = calcReceiptTotal(rec);
    const p = state.profile;

    document.getElementById('printableReceiptArea').innerHTML = `
      ${p.logo ? `<div class="pr-logo-center" style="text-align:center;margin-bottom:12px;"><img src="${p.logo}" alt="Logo ${escapeHtml(p.bizName)}" style="max-height:52px;max-width:130px;width:auto;height:auto;object-fit:contain;display:inline-block;border-radius:8px;" /></div>` : ''}
      <div class="pr-header">
        <div>
          <div class="pr-biz-name">${escapeHtml(p.bizName)}</div>
          <div class="pr-meta">No. SSM: ${escapeHtml(p.ssm || '-')}</div>
          <div class="pr-meta">${escapeHtml(p.address || '')}</div>
          <div class="pr-meta">Tel: ${escapeHtml(p.phone || '-')} · ${escapeHtml(p.email || '')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:800;color:var(--primary)">RESIT RASMI</div>
          <div class="pr-meta"><strong>${escapeHtml(rec.number)}</strong></div>
          <div class="pr-meta">Tarikh: ${formatDateMY(rec.date)}</div>
          <div style="margin-top:4px"><span class="status-pill ${rec.status === 'paid' ? 'paid' : 'unpaid'}">${rec.status === 'paid' ? 'DIBAYAR' : 'BELUM BAYAR'}</span></div>
        </div>
      </div>

      <div style="margin-bottom:12px;font-size:13px;">
        <strong>Diterima Daripada:</strong> ${escapeHtml(getReceiptRecipientName(rec))}
        ${rec.customerPhone ? `(${escapeHtml(rec.customerPhone)})` : ''} <br/>
        <strong>Kaedah Bayaran:</strong> ${escapeHtml(rec.method)}
      </div>

      <table class="pr-table">
        <thead>
          <tr><th>Item / Perkhidmatan</th><th>Kuan.</th><th>Harga</th><th>Jumlah</th></tr>
        </thead>
        <tbody>
          ${rec.items.map(it => `
            <tr>
              <td>${escapeHtml(it.name)}</td>
              <td>${it.qty}</td>
              <td>${rm(it.price)}</td>
              <td>${rm(it.qty * it.price)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="pr-totals">
        <div class="pr-total-line"><span>Subjumlah</span><span>${rm(subtotal)}</span></div>
        ${rec.discount > 0 ? `<div class="pr-total-line"><span>Diskaun</span><span>-${rm(rec.discount)}</span></div>` : ''}
        ${rec.taxPct > 0 ? `<div class="pr-total-line"><span>Cukai (${rec.taxPct}%)</span><span>${rm(tax)}</span></div>` : ''}
        <div class="pr-total-line pr-grand"><span>JUMLAH BESAR</span><span>${rm(total)}</span></div>
      </div>

      <div class="pr-footer">
        Terima kasih kerana berurusan dengan ${escapeHtml(p.bizName)}!<br/>
        Resit ini dijana secara digital dan sah tanpa tandatangan.
      </div>
    `;
    openModal('receiptPreviewModal');
  }

  document.getElementById('btnPrintReceiptNow').addEventListener('click', () => {
    document.body.classList.add('printing-receipt');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-receipt');
  });

  document.getElementById('btnCopyWhatsappReceipt').addEventListener('click', () => {
    const rec = state.receipts.find(r => r.id === currentPreviewReceiptId);
    if (!rec) return;
    const { total } = calcReceiptTotal(rec);
    const lines = [
      `*RESIT RASMI — ${state.profile.bizName}*`,
      `No. Resit: ${rec.number}`,
      `Tarikh: ${formatDateMY(rec.date)}`,
      `Pelanggan: ${getReceiptRecipientName(rec)}`,
      `----------------`,
      ...rec.items.map(i => `• ${i.name} (${i.qty}x) = ${rm(i.qty * i.price)}`),
      `----------------`,
      `*JUMLAH: ${rm(total)}*`,
      `Status: ${rec.status === 'paid' ? 'DIBAYAR ✅' : 'BELUM BAYAR ⏳'}`,
      `Terima kasih!`
    ].join('\n');

    navigator.clipboard.writeText(lines).then(() => {
      showToast('Teks resit disalin! Sedia ditampal ke WhatsApp.');
    }).catch(() => showToast('Gagal menyalin teks.'));
  });

  // Reports (View 4)
  function getPeriodTransactions(period) {
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYm = lastMonthDate.toISOString().slice(0, 7);

    if (period === 'this_month') return state.transactions.filter(t => t.date.startsWith(ym));
    if (period === 'last_month') return state.transactions.filter(t => t.date.startsWith(lastYm));
    if (period === 'last_90') {
      const cut = isoDaysAgo(90);
      return state.transactions.filter(t => t.date >= cut);
    }
    return state.transactions;
  }

  function matchTxToProduct(tx, prod) {
    if (!tx || tx.type !== 'income' || !prod) return false;
    if (tx.productId && tx.productId === prod.id) return true;
    const lowTitle = String(tx.title || '').toLowerCase();
    const lowProd = String(prod.name || '').toLowerCase();
    return Boolean(lowProd && lowTitle.includes(lowProd));
  }

  function renderProductSalesBars(incomeTxs) {
    const container = document.getElementById('reportProductBars');
    if (!container) return;

    const totalInc = incomeTxs.reduce((s, t) => s + Number(t.amount), 0);
    const byProd = {};

    incomeTxs.forEach(t => {
      const matched = state.products.find(p => matchTxToProduct(t, p));
      const key = matched ? matched.id : '__other__';
      if (!byProd[key]) {
        byProd[key] = {
          name: matched ? matched.name : (t.title || 'Jualan Lain'),
          emoji: matched ? (matched.emoji || '🛍️') : '💰',
          image: matched ? (matched.image || '') : '',
          prefix: matched ? (matched.receiptPrefix || state.profile.receiptPrefix || 'RES') : '',
          total: 0,
          count: 0
        };
      }
      byProd[key].total += Number(t.amount);
      byProd[key].count += 1;
    });

    const sorted = Object.values(byProd).sort((a, b) => b.total - a.total);
    const countEl = document.getElementById('reportProdCount');
    if (countEl) countEl.textContent = `${sorted.length} produk`;

    if (!sorted.length) {
      container.innerHTML = `<div class="empty-state">Tiada jualan produk direkodkan dalam tempoh ini.</div>`;
      return;
    }

    container.innerHTML = sorted.map(item => {
      const pct = totalInc > 0 ? Math.round((item.total / totalInc) * 100) : 0;
      return `
        <div class="cat-prog-item">
          <div class="tx-badge" style="background:#EDE8FE;overflow:hidden;">
            ${item.image ? `<img src="${item.image}" class="prod-thumb" alt="${escapeHtml(item.name)}" />` : escapeHtml(item.emoji)}
          </div>
          <div class="cat-prog-body">
            <div class="cat-prog-top">
              <span>${escapeHtml(item.name)} <span class="cat-prog-sub">(${item.count} jualan · ${pct}%${item.prefix ? ` · ${escapeHtml(item.prefix)}` : ''})</span></span>
              <span style="color:var(--success)">${rm(item.total)}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%; background:var(--primary)"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderReportsView() {
    const period = document.getElementById('reportPeriod').value;
    const prodSelect = document.getElementById('reportProductFilter');
    const prevProd = prodSelect ? prodSelect.value : 'all';
    if (prodSelect) {
      prodSelect.innerHTML = `<option value="all">Semua Produk</option>` +
        state.products.map(p => `<option value="${p.id}">${escapeHtml(p.emoji || '🛍️')} ${escapeHtml(p.name)} (${escapeHtml(p.receiptPrefix || state.profile.receiptPrefix || 'RES')})</option>`).join('');
      prodSelect.value = state.products.some(p => p.id === prevProd) ? prevProd : 'all';
    }
    const selectedProdId = prodSelect ? prodSelect.value : 'all';
    const selectedProd = selectedProdId !== 'all' ? state.products.find(p => p.id === selectedProdId) : null;

    const periodLabelMap = {
      this_month: 'Bulan Ini',
      last_month: 'Bulan Lepas',
      last_90: '3 Bulan Terakhir',
      all: 'Semua Masa'
    };
    const periodLabel = selectedProd
      ? `${periodLabelMap[period]} · ${selectedProd.name}`
      : periodLabelMap[period];
    document.getElementById('plPeriodLabel').textContent = periodLabel;

    const p = state.profile;
    const todayStr = formatDateMY(new Date().toISOString().slice(0, 10));
    document.getElementById('printReportHeader').innerHTML = `
      <div>
        <div style="font-size:18px;font-weight:800;color:#4821B8;">${escapeHtml(p.bizName)}</div>
        <div style="font-size:11.5px;color:#475569;">No. SSM: ${escapeHtml(p.ssm || '-')}</div>
        <div style="font-size:11.5px;color:#475569;">${escapeHtml(p.address || '')}</div>
        <div style="font-size:11.5px;color:#475569;">Tel: ${escapeHtml(p.phone || '-')} · ${escapeHtml(p.email || '')}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:15px;font-weight:800;color:#1B1633;">PENYATA KEWANGAN &amp; PERBELANJAAN</div>
        <div style="font-size:12px;font-weight:700;color:#6338EC;margin-top:2px;">Tempoh: ${escapeHtml(periodLabel)}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px;">Tarikh Dijana: ${todayStr}</div>
      </div>
    `;

    document.getElementById('printReportFooter').innerHTML = `
      <div>
        <div style="margin-bottom:26px;">Disediakan oleh:</div>
        <div style="border-top:1px solid #94A3B8;padding-top:4px;max-width:220px;">
          <strong>${escapeHtml(p.ownerName)}</strong><br/>
          <span>Pemilik / Pengurus</span>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="margin-bottom:26px;">Pengesahan &amp; Cop Perniagaan:</div>
        <div style="border-top:1px solid #94A3B8;padding-top:4px;max-width:220px;margin-left:auto;">
          <strong>${escapeHtml(p.bizName)}</strong><br/>
          <span>Tarikh: ${todayStr}</span>
        </div>
      </div>
    `;

    const periodTxs = getPeriodTransactions(period);
    const txs = selectedProd
      ? periodTxs.filter(t => t.type === 'income' && matchTxToProduct(t, selectedProd))
      : periodTxs;
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const net = income - expense;
    const margin = income > 0 ? Math.round((net / income) * 100) : 0;

    document.getElementById('reportKpiGrid').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Jumlah Jualan</div><div class="kpi-val" style="color:var(--success)">${rm(income)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Jumlah Perbelanjaan</div><div class="kpi-val" style="color:var(--danger)">${rm(expense)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Untung Bersih</div><div class="kpi-val">${rm(net)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Margin Untung</div><div class="kpi-val" style="color:var(--primary)">${margin}%</div></div>
    `;

    const mode = state.chartMode || 'expense';
    const modeTxs = txs.filter(t => t.type === mode);
    const modeTotal = mode === 'expense' ? expense : income;
    document.getElementById('reportTotalSpendBig').textContent = rm(modeTotal);

    const budget = Number(state.profile.monthlyBudget) || 0;
    const deltaEl = document.getElementById('reportSpendDelta');
    if (mode === 'expense' && budget > 0) {
      const pctUsed = Math.round((expense / budget) * 100);
      deltaEl.innerHTML = `<span style="color:${pctUsed > 100 ? 'var(--danger)' : 'var(--success)'}">${pctUsed}% daripada bajet bulanan (${rmShort(budget)})</span>`;
    } else {
      deltaEl.textContent = `${modeTxs.length} transaksi direkodkan`;
    }

    renderAreaChart(modeTxs);
    renderCategoryBars(txs.filter(t => t.type === 'expense'), expense);
    renderProductSalesBars(txs.filter(t => t.type === 'income'));
    renderPLTable(txs, income, expense, net);
  }

  function renderAreaChart(txs) {
    const wrap = document.getElementById('reportAreaChart');
    if (!txs.length) {
      wrap.innerHTML = `<div class="empty-state">Tiada data untuk tempoh ini.</div>`;
      return;
    }

    const byDate = {};
    txs.forEach(t => {
      byDate[t.date] = (byDate[t.date] || 0) + Number(t.amount);
    });
    const points = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
    if (points.length === 1) {
      points.unshift([points[0][0], 0]);
    }

    const W = 520;
    const H = 200;
    const padX = 42;
    const padTop = 36;
    const padBot = 28;
    const maxVal = Math.max(...points.map(p => p[1]), 10);

    const coords = points.map(([d, v], idx) => {
      const x = padX + (idx / (points.length - 1)) * (W - padX * 2);
      const y = padTop + (1 - v / maxVal) * (H - padTop - padBot);
      return { x, y, d, v };
    });

    const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${H - padBot} L ${coords[0].x.toFixed(1)} ${H - padBot} Z`;

    const peak = coords.reduce((best, cur) => (cur.v > best.v ? cur : best), coords[0]);
    const labelIdx = [0, Math.floor(coords.length / 2), coords.length - 1];

    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="210" preserveAspectRatio="none">
        <defs>
          <linearGradient id="purpleAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6338EC" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#6338EC" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#purpleAreaGrad)" />
        <path d="${linePath}" fill="none" stroke="#6338EC" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${peak.x}" cy="${peak.y}" r="5" fill="#fff" stroke="#6338EC" stroke-width="3" />
        <rect x="${Math.min(Math.max(peak.x - 40, 6), W - 86)}" y="${Math.max(peak.y - 32, 4)}" width="80" height="22" rx="11" fill="#4821B8" />
        <text x="${Math.min(Math.max(peak.x, 46), W - 46)}" y="${Math.max(peak.y - 17, 19)}" text-anchor="middle" fill="#fff" font-size="10.5" font-weight="700">${rmShort(peak.v)}</text>
        ${labelIdx.map(i => `
          <text x="${coords[i].x}" y="${H - 6}" text-anchor="middle" fill="#7C7696" font-size="10.5">${formatDateMY(coords[i].d)}</text>
        `).join('')}
      </svg>
    `;
  }

  function renderCategoryBars(expenseTxs, totalExp) {
    const container = document.getElementById('reportCategoryBars');
    const grouped = {};
    expenseTxs.forEach(t => {
      grouped[t.category] = (grouped[t.category] || 0) + Number(t.amount);
    });
    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    document.getElementById('reportCatCount').textContent = `${sorted.length} kategori`;

    if (!sorted.length) {
      container.innerHTML = `<div class="empty-state">Tiada perbelanjaan dalam tempoh ini.</div>`;
      return;
    }

    container.innerHTML = sorted.map(([catId, val]) => {
      const meta = getCategoryMeta('expense', catId);
      const pct = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
      return `
        <div class="cat-prog-item">
          <div class="tx-badge" style="background:${meta.bg}">${meta.icon}</div>
          <div class="cat-prog-body">
            <div class="cat-prog-top">
              <span>${meta.label} <span class="cat-prog-sub">(${pct}%)</span></span>
              <span>${rm(val)}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%; background:${meta.color}"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPLTable(txs, income, expense, net) {
    const table = document.getElementById('plTable');
    const incMap = {};
    const expMap = {};
    txs.forEach(t => {
      if (t.type === 'income') incMap[t.category] = (incMap[t.category] || 0) + Number(t.amount);
      else expMap[t.category] = (expMap[t.category] || 0) + Number(t.amount);
    });

    const incRows = Object.entries(incMap).sort((a, b) => b[1] - a[1]);
    const expRows = Object.entries(expMap).sort((a, b) => b[1] - a[1]);
    const margin = income > 0 ? Math.round((net / income) * 100) : 0;

    table.innerHTML = `
      <thead><tr><th>Butiran Akaun</th><th>Peratus</th><th>Jumlah (RM)</th></tr></thead>
      <tbody>
        <tr class="pl-section-row"><td colspan="3">A. Pendapatan / Jualan</td></tr>
        ${incRows.length
          ? incRows.map(([c, v]) => `<tr><td>${escapeHtml(c)}</td><td>${income > 0 ? Math.round((v / income) * 100) : 0}%</td><td style="color:var(--success)">${rm(v)}</td></tr>`).join('')
          : `<tr><td colspan="3" style="color:var(--muted)">Tiada rekod pendapatan</td></tr>`}
        <tr class="pl-subtotal-row">
          <td colspan="2">Jumlah Pendapatan</td>
          <td style="color:var(--success)">${rm(income)}</td>
        </tr>

        <tr class="pl-section-row"><td colspan="3">B. Perbelanjaan Operasi</td></tr>
        ${expRows.length
          ? expRows.map(([c, v]) => `<tr><td>${escapeHtml(c)}</td><td>${expense > 0 ? Math.round((v / expense) * 100) : 0}%</td><td style="color:var(--danger)">(${rm(v)})</td></tr>`).join('')
          : `<tr><td colspan="3" style="color:var(--muted)">Tiada rekod perbelanjaan</td></tr>`}
        <tr class="pl-subtotal-row">
          <td colspan="2">Jumlah Perbelanjaan</td>
          <td style="color:var(--danger)">(${rm(expense)})</td>
        </tr>

        <tr class="pl-total-row">
          <td>UNTUNG / (RUGI) BERSIH</td>
          <td style="font-size:12px;color:var(--primary)">Margin: ${margin}%</td>
          <td style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${rm(net)}</td>
        </tr>
      </tbody>
    `;
  }

  // Accounts & Profile (View 5)
  function renderAccountsView() {
    const acc = state.accounts.find(a => a.id === state.activeAccountId) || state.accounts[0];
    if (acc) {
      document.getElementById('cardBankName').textContent = acc.name;
      document.querySelector('.visa-brand').textContent = acc.brand;
      document.getElementById('cardNumberMask').textContent = `•••• •••• •••• ${acc.last4}`;
      document.getElementById('cardBalanceVal').textContent = rm(calcAccountBalance(acc));
      document.getElementById('cardHolderName').textContent = state.profile.ownerName;

      const toggleDefs = [
        { key: 'lockCard', icon: '🔒', label: 'Kunci Kad / Akaun Sementara' },
        { key: 'onlinePay', icon: '🌐', label: 'Pembayaran Dalam Talian' },
        { key: 'duitNow', icon: '📱', label: 'Terima DuitNow QR' },
        { key: 'contactless', icon: '📶', label: 'Bayaran Tanpa Sentuh (PayWave)' }
      ];

      document.getElementById('cardSettingsToggles').innerHTML = toggleDefs.map(td => `
        <div class="toggle-row">
          <div class="toggle-label"><span>${td.icon}</span><span>${td.label}</span></div>
          <label class="switch">
            <input type="checkbox" ${acc.toggles[td.key] ? 'checked' : ''} onchange="window._niaga.toggleAccountSetting('${acc.id}', '${td.key}', this.checked)" />
            <span class="slider"></span>
          </label>
        </div>
      `).join('');
    }

    document.getElementById('accountSelectorPills').innerHTML = state.accounts.map(a => `
      <button type="button" class="acc-pill ${a.id === acc.id ? 'active' : ''}" onclick="window._niaga.selectAccount('${a.id}')">${escapeHtml(a.name)}</button>
    `).join('');

    const p = state.profile;
    document.getElementById('profBizName').value = p.bizName || '';
    document.getElementById('profOwner').value = p.ownerName || '';
    document.getElementById('profSsm').value = p.ssm || '';
    document.getElementById('profPhone').value = p.phone || '';
    document.getElementById('profEmail').value = p.email || '';
    document.getElementById('profAddress').value = p.address || '';
    document.getElementById('profBudgetLimit').value = p.monthlyBudget || 0;
    pendingProfileLogo = p.logo || '';
    const logoWrap = document.getElementById('profLogoPreviewWrap');
    const logoImg = document.getElementById('profLogoPreview');
    if (pendingProfileLogo) {
      logoImg.src = pendingProfileLogo;
      logoWrap.classList.remove('hidden');
    } else {
      logoWrap.classList.add('hidden');
    }
  }

  document.getElementById('profLogoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadOrKeepImage(file, 450, (url) => {
      pendingProfileLogo = url;
      document.getElementById('profLogoPreview').src = url;
      document.getElementById('profLogoPreviewWrap').classList.remove('hidden');
    });
  });

  document.getElementById('btnRemoveProfLogo').addEventListener('click', () => {
    pendingProfileLogo = '';
    document.getElementById('profLogoInput').value = '';
    document.getElementById('profLogoPreviewWrap').classList.add('hidden');
  });

  document.getElementById('bizProfileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.profile = {
      bizName: document.getElementById('profBizName').value.trim(),
      ownerName: document.getElementById('profOwner').value.trim(),
      ssm: document.getElementById('profSsm').value.trim(),
      phone: document.getElementById('profPhone').value.trim(),
      email: document.getElementById('profEmail').value.trim(),
      address: document.getElementById('profAddress').value.trim(),
      monthlyBudget: parseFloat(document.getElementById('profBudgetLimit').value) || 0,
      logo: pendingProfileLogo,
      receiptPrefix: (state.profile && state.profile.receiptPrefix) || 'RES'
    };
    saveState();
    renderAll();
    showToast('Profil perniagaan berjaya disimpan!');
  });

  document.getElementById('btnResetDemo').addEventListener('click', () => {
    if (!confirm('Adakah anda pasti mahu memadam semua rekod jualan, perbelanjaan, produk, dan resit?')) return;
    state = createDefaultState();
    saveState();
    renderAll();
    showToast('Semua data telah dikosongkan.');
  });

  document.getElementById('btnAddAccount').addEventListener('click', () => {
    const name = prompt('Nama Akaun / Bank Baru (cth: Bank Islam SME):');
    if (!name || !name.trim()) return;
    const bal = parseFloat(prompt('Baki Permulaan (RM):', '0')) || 0;
    const newAcc = {
      id: 'acc_' + Date.now(),
      name: name.trim(),
      brand: 'AKAUN',
      last4: String(Math.floor(1000 + Math.random() * 9000)),
      openingBalance: bal,
      toggles: { lockCard: false, onlinePay: true, duitNow: true, contactless: false }
    };
    state.accounts.push(newAcc);
    state.activeAccountId = newAcc.id;
    saveState();
    renderAll();
    showToast(`Akaun "${newAcc.name}" ditambah.`);
  });

  // CSV Exports
  function exportCsv(filename, rows) {
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('btnExportSalesCsv').addEventListener('click', () => {
    const rows = [['Tarikh', 'Penerangan Jualan', 'Kategori', 'Akaun', 'Jumlah (RM)', 'Nota']];
    state.transactions.filter(t => t.type === 'income').forEach(t => {
      rows.push([t.date, t.title, t.category, getAccountName(t.accountId), t.amount, t.notes || '']);
    });
    exportCsv(`niagakira-jualan-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    showToast('Fail CSV jualan dimuat turun.');
  });

  document.getElementById('btnExportExpensesCsv').addEventListener('click', () => {
    const rows = [['Tarikh', 'Penerangan Belanja', 'Kategori', 'Akaun', 'Jumlah (RM)', 'Nota']];
    state.transactions.filter(t => t.type === 'expense').forEach(t => {
      rows.push([t.date, t.title, t.category, getAccountName(t.accountId), t.amount, t.notes || '']);
    });
    exportCsv(`niagakira-perbelanjaan-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    showToast('Fail CSV perbelanjaan dimuat turun.');
  });

  document.getElementById('btnExportReportCsv').addEventListener('click', () => {
    const period = document.getElementById('reportPeriod').value;
    const txs = getPeriodTransactions(period);
    const rows = [['Tarikh', 'Jenis', 'Kategori', 'Penerangan', 'Jumlah (RM)']];
    txs.forEach(t => rows.push([t.date, t.type === 'income' ? 'Masuk' : 'Keluar', t.category, t.title, t.amount]));
    exportCsv(`niagakira-laporan-${period}.csv`, rows);
    showToast('Laporan CSV berjaya dieksport.');
  });

  document.getElementById('btnPrintReport').addEventListener('click', () => window.print());

  // Event Listeners
  document.getElementById('qaAddIncome').addEventListener('click', () => openTxModal('income'));
  document.getElementById('qaAddExpense').addEventListener('click', () => openTxModal('expense'));
  document.getElementById('qaNewReceipt').addEventListener('click', openReceiptFormModal);
  document.getElementById('btnQuickReceiptHeader').addEventListener('click', openReceiptFormModal);
  document.getElementById('btnOpenAddProduct').addEventListener('click', () => openProductModal());
  document.getElementById('btnOpenAddSale').addEventListener('click', () => openTxModal('income'));
  document.getElementById('btnOpenAddExpense').addEventListener('click', () => openTxModal('expense'));
  document.getElementById('btnCreateReceipt').addEventListener('click', openReceiptFormModal);
  document.getElementById('openQuickActionBtn').addEventListener('click', () => openTxModal('income'));
  document.getElementById('btnNotifications').addEventListener('click', () => {
    const unpaid = state.receipts.filter(r => r.status === 'unpaid').length;
    showToast(unpaid > 0 ? `Anda ada ${unpaid} resit belum dibayar.` : 'Semua resit telah dijelaskan!');
  });

  ['salesSearch', 'salesFilterCategory', 'salesFilterMonth'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderSalesView);
    document.getElementById(id).addEventListener('change', renderSalesView);
  });

  ['expSearch', 'expFilterCategory', 'expFilterMonth'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderExpensesView);
    document.getElementById(id).addEventListener('change', renderExpensesView);
  });

  document.getElementById('reportPeriod').addEventListener('change', renderReportsView);
  document.getElementById('reportProductFilter').addEventListener('change', renderReportsView);
  document.querySelectorAll('[data-chart-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-chart-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartMode = btn.dataset.chartMode;
      renderReportsView();
    });
  });

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Global bridge for inline onclick handlers
  window._niaga = {
    editProduct(id) {
      const prod = state.products.find(p => p.id === id);
      if (prod) openProductModal(prod);
    },
    deleteProduct(id) {
      state.products = state.products.filter(p => p.id !== id);
      saveState();
      renderAll();
      showToast('Produk dipadamkan.');
    },
    sellProduct(prodId) {
      openTxModal('income', null, prodId);
    },
    editTx(id) {
      const tx = state.transactions.find(t => t.id === id);
      if (tx) openTxModal(tx.type, tx);
    },
    deleteTx(id) {
      state.transactions = state.transactions.filter(t => t.id !== id);
      saveState();
      renderAll();
      showToast('Transaksi dipadamkan.');
    },
    viewImage(txId) {
      const tx = state.transactions.find(t => t.id === txId);
      if (tx && tx.receiptImg) {
        document.getElementById('viewerImg').src = tx.receiptImg;
        openModal('imageViewerModal');
      }
    },
    previewReceipt,
    generateReceiptFromSale(txId) {
      const tx = state.transactions.find(t => t.id === txId);
      if (!tx) return;
      if (tx.receiptId && state.receipts.some(r => r.id === tx.receiptId)) {
        previewReceipt(tx.receiptId);
        return;
      }
      openReceiptFormModal(tx);
    },
    markReceiptPaid(id) {
      const rec = state.receipts.find(r => r.id === id);
      if (!rec) return;
      rec.status = 'paid';
      const { total } = calcReceiptTotal(rec);
      const newTxId = 'tx_' + Date.now();
      rec.linkedTxId = newTxId;
      state.transactions.unshift({
        id: newTxId,
        type: 'income',
        amount: total,
        date: new Date().toISOString().slice(0, 10),
        title: `Resit ${rec.number} — ${rec.customerName}`,
        category: 'Jualan Produk',
        accountId: state.activeAccountId || state.accounts[0].id,
        notes: `Bayaran ${rec.method}`,
        receiptImg: '',
        receiptId: rec.id
      });
      saveState();
      renderAll();
      showToast(`Resit ${rec.number} ditanda dibayar & direkod ke Jualan.`);
    },
    deleteReceipt(id) {
      state.receipts = state.receipts.filter(r => r.id !== id);
      state.transactions.forEach(t => {
        if (t.receiptId === id) t.receiptId = '';
      });
      saveState();
      renderAll();
      showToast('Resit dipadamkan.');
    },
    selectAccount(id) {
      state.activeAccountId = id;
      saveState();
      renderAccountsView();
    },
    toggleAccountSetting(accId, key, val) {
      const acc = state.accounts.find(a => a.id === accId);
      if (acc) {
        acc.toggles[key] = val;
        saveState();
        showToast('Tetapan kad dikemaskini.');
      }
    }
  };

  function renderAll() {
    renderHeader();
    renderHome();
    renderSalesView();
    renderExpensesView();
    renderReceiptsView();
    renderReportsView();
    renderAccountsView();
  }

  // Authentication Controller
  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.authMode === mode);
    });
    document.getElementById('authNameGroup').classList.toggle('hidden', mode !== 'register');
    document.getElementById('authSubmitBtn').textContent = mode === 'register' ? 'Daftar & Masuk' : 'Log Masuk';
    document.getElementById('authErrorBox').classList.add('hidden');
  }

  document.querySelectorAll('[data-auth-mode]').forEach(btn => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.authMode));
  });

  function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
  }

  function showAppShell(loadedState) {
    if (loadedState && typeof loadedState === 'object') {
      state = loadedState;
      if (!Array.isArray(state.products)) state.products = [];
      if (!Array.isArray(state.transactions)) state.transactions = [];
      if (!Array.isArray(state.receipts)) state.receipts = [];
      if (!Array.isArray(state.accounts) || !state.accounts.length) {
        state.accounts = createDefaultState().accounts;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    setLayoutMode(state.layoutMode || 'desktop');
    renderAll();
  }

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('authErrorBox');
    errBox.classList.add('hidden');

    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName').value.trim();

    if (FIREBASE_DB_URL) {
      if (!email || !password || password.length < 4) {
        errBox.textContent = 'Sila masukkan emel/nama pengguna dan kata laluan (min 4 aksara).';
        errBox.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('authSubmitBtn');
      const prevBtnText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Menyambung...';

      try {
        const userKey = emailToFirebaseKey(email);
        const pwHash = await hashPasswordClient(password);
        const existing = await fbRequest(`users/${userKey}`, 'GET');

        if (authMode === 'register') {
          if (existing) {
            throw new Error('Akaun dengan emel/nama pengguna ini sudah wujud.');
          }
          const newState = createDefaultState();
          newState.profile.ownerName = name || email.split('@')[0];
          newState.profile.email = email;
          await fbRequest(`users/${userKey}`, 'PUT', {
            email,
            name: newState.profile.ownerName,
            passwordHash: pwHash,
            createdAt: new Date().toISOString(),
            state: newState
          });
          localStorage.setItem(TOKEN_KEY, `fb:${email}`);
          document.getElementById('authForm').reset();
          showAppShell(newState);
          showToast('Akaun berjaya didaftarkan & disegerak ke awan!');
        } else {
          if (!existing || existing.passwordHash !== pwHash) {
            throw new Error('Emel/nama pengguna atau kata laluan tidak tepat.');
          }
          localStorage.setItem(TOKEN_KEY, `fb:${email}`);
          document.getElementById('authForm').reset();
          showAppShell(existing.state || createDefaultState());
          showToast('Selamat kembali! Data berjaya dimuat turun.');
        }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = prevBtnText;
      }
      return;
    }

    if (IS_STATIC_HOST) {
      if (!email || !password || password.length < 4) {
        errBox.textContent = 'Sila masukkan emel/nama pengguna dan kata laluan (min 4 aksara).';
        errBox.classList.remove('hidden');
        return;
      }
      const users = loadLocalUsers();
      if (authMode === 'register') {
        if (users[email]) {
          errBox.textContent = 'Akaun dengan emel/nama pengguna ini sudah wujud.';
          errBox.classList.remove('hidden');
          return;
        }
        const newState = createDefaultState();
        newState.profile.ownerName = name || email.split('@')[0];
        newState.profile.email = email;
        users[email] = { email, name: newState.profile.ownerName, password, state: newState };
        saveLocalUsers(users);
        localStorage.setItem(TOKEN_KEY, `local:${email}`);
        document.getElementById('authForm').reset();
        showAppShell(newState);
        showToast('Akaun berjaya didaftarkan!');
      } else {
        const u = users[email];
        if (!u || u.password !== password) {
          errBox.textContent = 'Emel/nama pengguna atau kata laluan tidak tepat.';
          errBox.classList.remove('hidden');
          return;
        }
        localStorage.setItem(TOKEN_KEY, `local:${email}`);
        document.getElementById('authForm').reset();
        showAppShell(u.state);
        showToast('Selamat kembali!');
      }
      return;
    }

    const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
    try {
      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password, name })
      });
      localStorage.setItem(TOKEN_KEY, res.token);
      document.getElementById('authForm').reset();
      showAppShell(res.state);
      showToast(authMode === 'register' ? 'Akaun berjaya didaftarkan!' : 'Selamat kembali!');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    if (!IS_STATIC_HOST && getAuthToken()) {
      await apiRequest('/api/logout', { method: 'POST' }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STORAGE_KEY);
    state = createDefaultState();
    showAuthScreen();
    showToast('Anda telah log keluar.');
  });

  // Backup & Restore (.json)
  document.getElementById('btnExportBackup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `niagix-sandaran-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Fail sandaran (.json) berjaya dimuat turun!');
  });

  document.getElementById('btnImportBackup').addEventListener('click', () => {
    document.getElementById('importBackupFile').click();
  });

  document.getElementById('importBackupFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported || typeof imported !== 'object' || !imported.profile) {
          throw new Error('Format fail sandaran tidak sah.');
        }
        state = imported;
        saveState();
        renderAll();
        showToast('Data sandaran berjaya dipulihkan!');
      } catch (err) {
        showToast('Gagal mengimport fail: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  async function initApp() {
    const statusEl = document.getElementById('cloudStatusIndicator');
    if (statusEl) {
      statusEl.textContent = FIREBASE_DB_URL ? '☁️ Cloud Sync Aktif (v3)' : 'Storan Tempatan';
    }
    const token = getAuthToken();
    if (!token) {
      showAuthScreen();
      return;
    }
    if (token.startsWith('fb:') && FIREBASE_DB_URL) {
      const email = token.slice(3);
      const userKey = emailToFirebaseKey(email);
      try {
        const remoteState = await fbRequest(`users/${userKey}/state`, 'GET');
        if (remoteState) {
          showAppShell(remoteState);
          return;
        }
      } catch (err) {
        console.warn('Gagal muat turun dari Firebase, guna cache tempatan:', err.message);
        const cached = loadState();
        if (cached) {
          showAppShell(cached);
          return;
        }
      }
      localStorage.removeItem(TOKEN_KEY);
      showAuthScreen();
      return;
    }
    if (IS_STATIC_HOST || token.startsWith('local:')) {
      const email = token.startsWith('local:') ? token.slice(6) : '';
      const users = loadLocalUsers();
      if (email && users[email]) {
        showAppShell(users[email].state);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        showAuthScreen();
      }
      return;
    }
    try {
      const res = await apiRequest('/api/me');
      showAppShell(res.state);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      showAuthScreen();
    }
  }

  initApp();
})();

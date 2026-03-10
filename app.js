/* ============================================================
   PATIL FARMS — Layer Poultry Management SPA
   app.js — Client-Side State, Routing & Rendering Engine
   ============================================================

   DATA MODEL:
   - farmConfig:     { arrivalDate, initialBirdCount }
   - productionData: [{ date, goodEggs, damagedEggs, liveBirds, medicine }]
   - eggSales:       [{ id, date, qty, pricePerDozen, buyer, total }]
   - otherSales:     [{ id, date, description, amount, total }]
   - expenses:       [{ id, date, category, description, amount, total }]

   PER-BIRD COST FORMULA:
   - Numerator:   Sum of ALL expense.total from arrivalDate to today
   - Denominator: Current liveBirds (most recent productionData entry)
   - Result:      "Real-time cost incurred per surviving bird since arrival"
   ============================================================ */

// ─── Storage Helpers ─────────────────────────────────────────
const DB = {
  get: (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
};

// ─── State ────────────────────────────────────────────────────
let farmConfig    = DB.get('farmConfig', { arrivalDate: '', initialBirdCount: 0 });
let productionData = DB.get('productionData', []);
let eggSales      = DB.get('eggSales', []);
let otherSales    = DB.get('otherSales', []);
let expenses      = DB.get('expenses', []);

function save() {
  DB.set('farmConfig', farmConfig);
  DB.set('productionData', productionData);
  DB.set('eggSales', eggSales);
  DB.set('otherSales', otherSales);
  DB.set('expenses', expenses);
}

// ─── Utilities ────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatINR(num) {
  const n = parseFloat(num) || 0;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const start = new Date(dateStr + 'T00:00:00');
  const now   = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now - start) / 86400000));
}

// ─── Toast Notification ───────────────────────────────────────
function toast(message, type = 'success') {
  const container = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || '✓'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ─── Metrics Engine ──────────────────────────────────────────
function getMetrics() {
  // Current egg inventory (sum of good eggs minus sold)
  const totalGoodEggs = productionData.reduce((s, d) => s + (parseInt(d.goodEggs) || 0), 0);
  const totalEggsSold = eggSales.reduce((s, e) => s + (parseInt(e.qty) || 0), 0);
  const currentEggInventory = Math.max(0, totalGoodEggs - totalEggsSold);

  // Total Sales (egg sales + other sales)
  const totalEggSalesRevenue  = eggSales.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const totalOtherSalesRevenue = otherSales.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const totalSalesRevenue = totalEggSalesRevenue + totalOtherSalesRevenue;

  // Total Expenses
  const totalExpenses = expenses.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);

  // Cash In Hand = Total Revenue - Total Expenses
  const cashInHand = totalSalesRevenue - totalExpenses;

  /* -----------------------------------------------------------
     PER-BIRD MAINTENANCE COST CALCULATION
     -----------------------------------------------------------
     Formula: Total ALL Expenses (₹) / Current Live Birds

     Rationale: We aggregate EVERY recorded expense since arrival.
     This gives a running average of how much money has been spent
     maintaining each bird that is currently alive.

     - Numerator: Sum of all expense records (no date filter needed
       since expenses are only logged after arrivalDate is set)
     - Denominator: The most recent liveBirds count from production logs
     ----------------------------------------------------------- */
  const currentLiveBirds = (() => {
    if (productionData.length === 0) return parseInt(farmConfig.initialBirdCount) || 0;
    const sorted = [...productionData].sort((a, b) => b.date.localeCompare(a.date));
    return parseInt(sorted[0].liveBirds) || parseInt(farmConfig.initialBirdCount) || 0;
  })();

  const costPerBird = currentLiveBirds > 0
    ? totalExpenses / currentLiveBirds
    : 0;

  return {
    currentEggInventory,
    totalSalesRevenue,
    cashInHand,
    costPerBird,
    currentLiveBirds,
    totalExpenses
  };
}

// ─── Hash Router ─────────────────────────────────────────────
function navigate(hash) {
  window.location.hash = hash;
}

function getCurrentRoute() {
  return window.location.hash || '#/home';
}

window.onhashchange = () => render();

// ─── Header & Nav Updater ────────────────────────────────────
function updateHeaderAndNav() {
  // Update day badge
  const badge = document.getElementById('day-badge');
  if (farmConfig.arrivalDate) {
    const d = daysSince(farmConfig.arrivalDate);
    badge.textContent = `Day ${d}`;
  } else {
    badge.textContent = 'Day —';
  }

  // Update subtitle with bird count
  const sub = document.getElementById('header-subtitle');
  const metrics = getMetrics();
  sub.textContent = farmConfig.arrivalDate
    ? `${metrics.currentLiveBirds.toLocaleString()} Birds`
    : 'Layer Poultry';

  // Active nav button
  const route = getCurrentRoute();
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}

// ─── Main Render Dispatcher ──────────────────────────────────
function render() {
  const route = getCurrentRoute();
  updateHeaderAndNav();
  const content = document.getElementById('app-content');

  const views = {
    '#/home':       renderHome,
    '#/production': renderProduction,
    '#/sales':      renderSales,
    '#/expenses':   renderExpenses,
    '#/settings':   renderSettings,
  };

  const view = views[route] || views['#/home'];
  content.innerHTML = `<div class="page-enter">${view()}</div>`;
  afterRender(route);
}

function afterRender(route) {
  if (route === '#/home') drawProductionChart();
}

// ═══════════════════════════════════════════════════════════════
// VIEW: DASHBOARD / HOME
// ═══════════════════════════════════════════════════════════════
function renderHome() {
  const m = getMetrics();
  const noConfig = !farmConfig.arrivalDate;

  const configNotice = noConfig ? `
    <div class="config-notice">
      ⚙️ <strong>Setup Required:</strong> Please set your Bird Arrival Date in
      <a href="#" onclick="navigate('#/settings')" style="color:var(--rust);font-weight:600;">Settings</a>
      to enable full reporting.
    </div>` : '';

  const days = farmConfig.arrivalDate ? daysSince(farmConfig.arrivalDate) : 0;

  return `
    ${configNotice}

    <h2 class="section-title">Farm Overview</h2>
    <p class="section-subtitle">
      ${farmConfig.arrivalDate
        ? `Batch started ${formatDate(farmConfig.arrivalDate)} · ${days} days running`
        : 'Configure your farm to begin tracking'}
    </p>

    <!-- Metrics Grid -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="metric-card green">
        <div class="metric-icon">🥚</div>
        <div class="metric-label">Egg Inventory</div>
        <div class="metric-value">${m.currentEggInventory.toLocaleString()}</div>
        <div class="metric-sub">eggs in stock</div>
      </div>

      <div class="metric-card yolk">
        <div class="metric-icon">💰</div>
        <div class="metric-label">Total Sales</div>
        <div class="metric-value" style="font-size:20px;">${formatINR(m.totalSalesRevenue)}</div>
        <div class="metric-sub">all time revenue</div>
      </div>

      <div class="metric-card rust">
        <div class="metric-icon">🏦</div>
        <div class="metric-label">Cash in Hand</div>
        <div class="metric-value" style="font-size:20px;color:${m.cashInHand >= 0 ? 'var(--grove)' : 'var(--rust)'}">
          ${formatINR(m.cashInHand)}
        </div>
        <div class="metric-sub">revenue – expenses</div>
      </div>

      <div class="metric-card earth">
        <div class="metric-icon">🐔</div>
        <div class="metric-label">Cost / Bird</div>
        <div class="metric-value" style="font-size:20px;">${formatINR(m.costPerBird)}</div>
        <div class="metric-sub">maintenance avg</div>
      </div>
    </div>

    <!-- Cost Per Bird Explainer -->
    <div class="card mb-4" style="padding:14px 16px; background: linear-gradient(135deg, rgba(45,106,79,0.05), rgba(64,145,108,0.03));">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--grove);margin-bottom:6px;">
        📊 Cost-Per-Bird Breakdown
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink);margin-bottom:3px;">
        <span>Total Expenses</span>
        <span style="font-family:'DM Mono',monospace;color:var(--rust);">${formatINR(m.totalExpenses)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink);margin-bottom:3px;">
        <span>Current Live Birds</span>
        <span style="font-family:'DM Mono',monospace;">${m.currentLiveBirds.toLocaleString()}</span>
      </div>
      <div style="height:1px;background:var(--parchment);margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:var(--bark);">
        <span>= Cost Per Bird</span>
        <span style="font-family:'DM Mono',monospace;color:var(--grove);">${formatINR(m.costPerBird)}</span>
      </div>
    </div>

    <!-- 7-Day Chart -->
    <div class="chart-container mb-4">
      <div class="chart-title">📈 7-Day Production Trend</div>
      <canvas id="productionChart"></canvas>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:var(--earth);">
        <span style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:3px;background:var(--grove);border-radius:2px;display:inline-block;"></span> Good Eggs
        </span>
        <span style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:3px;background:var(--rust);border-radius:2px;display:inline-block;"></span> Damaged
        </span>
      </div>
    </div>

    <!-- Recent Production -->
    <h3 class="section-title" style="font-size:16px;">Recent Entries</h3>
    <div class="card">
      ${productionData.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">🌱</div><div class="empty-state-text">No production data yet. Start logging!</div></div>`
        : [...productionData].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5).map(d => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${formatDate(d.date)}</div>
              <div class="data-row-sub">🐔 ${parseInt(d.liveBirds)||0} birds · 💊 ${d.medicine || 'none'}</div>
            </div>
            <div style="text-align:right;">
              <div class="data-row-amount">${parseInt(d.goodEggs)||0} good</div>
              <div style="font-size:11px;color:var(--rust);font-family:'DM Mono',monospace;">${parseInt(d.damagedEggs)||0} dmg</div>
            </div>
          </div>`).join('')
      }
    </div>
  `;
}

// ─── Canvas 2D Production Chart ───────────────────────────────
function drawProductionChart() {
  const canvas = document.getElementById('productionChart');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = 160;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Get last 7 days of data
  const sorted = [...productionData].sort((a, b) => a.date.localeCompare(b.date));
  const last7  = sorted.slice(-7);

  if (last7.length === 0) {
    ctx.fillStyle = '#8B6340';
    ctx.font = '13px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No production data to display', w / 2, h / 2);
    return;
  }

  const good    = last7.map(d => parseInt(d.goodEggs) || 0);
  const damaged = last7.map(d => parseInt(d.damagedEggs) || 0);
  const labels  = last7.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });

  const maxVal = Math.max(...good, ...damaged, 1);
  const padTop = 20, padBot = 30, padLeft = 10, padRight = 10;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBot;
  const step   = chartW / Math.max(last7.length - 1, 1);

  // Draw grid lines
  ctx.strokeStyle = 'rgba(237,228,211,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - padRight, y);
    ctx.stroke();
  }

  // Draw area + line helper
  function drawLine(data, color, fillColor) {
    if (data.length < 2) {
      // single point dot
      const x = padLeft;
      const y = padTop + chartH - (data[0] / maxVal) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }

    const pts = data.map((v, i) => ({
      x: padLeft + i * step,
      y: padTop + chartH - (v / maxVal) * chartH
    }));

    // Filled area
    ctx.beginPath();
    ctx.moveTo(pts[0].x, padTop + chartH);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx  = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Dots
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });
  }

  drawLine(good,    '#40916C', 'rgba(64,145,108,0.10)');
  drawLine(damaged, '#C85B2E', 'rgba(200,91,46,0.08)');

  // X-axis labels
  ctx.fillStyle = '#8B6340';
  ctx.font      = '10px DM Mono, monospace';
  ctx.textAlign = 'center';
  const pts = last7.map((_, i) => padLeft + i * step);
  pts.forEach((x, i) => {
    ctx.fillText(labels[i], x, h - 6);
  });
}

// ═══════════════════════════════════════════════════════════════
// VIEW: PRODUCTION LOG
// ═══════════════════════════════════════════════════════════════
function renderProduction() {
  const sorted = [...productionData].sort((a, b) => b.date.localeCompare(a.date));
  const todayStr = today();
  const todayEntry = productionData.find(d => d.date === todayStr);

  return `
    <h2 class="section-title">Production Log</h2>
    <p class="section-subtitle">Log daily egg count, bird count, and medicine.</p>

    <!-- Entry Form -->
    <div class="form-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-weight:700;color:var(--bark);font-size:14px;">
          ${todayEntry ? '✏️ Override Today\'s Entry' : '➕ New Entry'}
        </div>
        ${todayEntry ? '<span class="override-badge">OVERRIDE</span>' : ''}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="field-group">
          <label class="field-label">Date</label>
          <input type="date" id="prod-date" class="field-input" value="${todayStr}" max="${todayStr}" />
        </div>
        <div class="field-group">
          <label class="field-label">Live Birds</label>
          <input type="number" id="prod-birds" class="field-input" placeholder="${farmConfig.initialBirdCount || 0}" min="0" />
        </div>
        <div class="field-group">
          <label class="field-label">Good Eggs</label>
          <input type="number" id="prod-good" class="field-input" placeholder="0" min="0" />
        </div>
        <div class="field-group">
          <label class="field-label">Damaged Eggs</label>
          <input type="number" id="prod-damaged" class="field-input" placeholder="0" min="0" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Medicine / Notes</label>
        <input type="text" id="prod-medicine" class="field-input" placeholder="e.g. Vitamin supplement, vaccine..." />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveProduction()">
        💾 Save Production Entry
      </button>
    </div>

    <!-- Records -->
    <h3 class="section-title" style="font-size:16px;">All Records (${productionData.length})</h3>
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No entries yet.</div></div>`
        : sorted.map(d => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${formatDate(d.date)}</div>
              <div class="data-row-sub">🐔 ${parseInt(d.liveBirds)||0} live · ${d.medicine ? '💊 ' + d.medicine : 'no meds'}</div>
            </div>
            <div style="text-align:right;display:flex;align-items:center;gap:10px;">
              <div>
                <div class="data-row-amount">${parseInt(d.goodEggs)||0} 🥚</div>
                <div style="font-size:11px;color:var(--rust);font-family:'DM Mono',monospace;">${parseInt(d.damagedEggs)||0} dmg</div>
              </div>
              <button class="btn btn-danger" onclick="deleteProduction('${d.date}')">✕</button>
            </div>
          </div>`).join('')
      }
    </div>
  `;
}

function saveProduction() {
  const date     = document.getElementById('prod-date')?.value?.trim();
  const birds    = document.getElementById('prod-birds')?.value?.trim();
  const good     = document.getElementById('prod-good')?.value?.trim();
  const damaged  = document.getElementById('prod-damaged')?.value?.trim();
  const medicine = document.getElementById('prod-medicine')?.value?.trim();

  if (!date || !birds || !good) {
    toast('Please fill in Date, Live Birds, and Good Eggs.', 'error');
    return;
  }

  const existing = productionData.findIndex(d => d.date === date);
  const entry = { date, goodEggs: parseInt(good)||0, damagedEggs: parseInt(damaged)||0, liveBirds: parseInt(birds)||0, medicine: medicine || '' };

  if (existing >= 0) {
    productionData[existing] = entry;
    toast('Production entry updated (override).', 'info');
  } else {
    productionData.push(entry);
    toast('Production entry saved!', 'success');
  }

  save();
  render();
}

function deleteProduction(date) {
  productionData = productionData.filter(d => d.date !== date);
  save();
  toast('Entry deleted.', 'error');
  render();
}

// ═══════════════════════════════════════════════════════════════
// VIEW: SALES
// ═══════════════════════════════════════════════════════════════
function renderSales() {
  const activeTab = window._salesTab || 'egg';

  const totalEgg   = eggSales.reduce((s, e) => s + (parseFloat(e.total)||0), 0);
  const totalOther = otherSales.reduce((s, e) => s + (parseFloat(e.total)||0), 0);

  return `
    <h2 class="section-title">Sales</h2>
    <div class="stats-row">
      <div class="stat-chip">
        <div class="stat-chip-label">Egg Revenue</div>
        <div class="stat-chip-value" style="font-size:15px;color:var(--grove);">${formatINR(totalEgg)}</div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-label">Other Revenue</div>
        <div class="stat-chip-value" style="font-size:15px;color:var(--earth);">${formatINR(totalOther)}</div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-label">Total</div>
        <div class="stat-chip-value" style="font-size:15px;color:var(--bark);">${formatINR(totalEgg + totalOther)}</div>
      </div>
    </div>

    <div class="tab-group">
      <button class="tab-btn ${activeTab==='egg'?'active':''}" onclick="setSalesTab('egg')">🥚 Egg Sales</button>
      <button class="tab-btn ${activeTab==='other'?'active':''}" onclick="setSalesTab('other')">📦 Other Sales</button>
    </div>

    ${activeTab === 'egg' ? renderEggSalesForm() + renderEggSalesList() : renderOtherSalesForm() + renderOtherSalesList()}
  `;
}

function setSalesTab(tab) {
  window._salesTab = tab;
  render();
}

function renderEggSalesForm() {
  return `
    <div class="form-card">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">➕ New Egg Sale</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field-group">
          <label class="field-label">Date</label>
          <input type="date" id="es-date" class="field-input" value="${today()}" />
        </div>
        <div class="field-group">
          <label class="field-label">Qty (Eggs)</label>
          <input type="number" id="es-qty" class="field-input" placeholder="0" min="0" oninput="calcEggTotal()" />
        </div>
        <div class="field-group">
          <label class="field-label">Price / Dozen (₹)</label>
          <input type="number" id="es-price" class="field-input" placeholder="0.00" min="0" step="0.01" oninput="calcEggTotal()" />
        </div>
        <div class="field-group">
          <label class="field-label">Total (₹)</label>
          <input type="number" id="es-total" class="field-input" placeholder="Auto-calc" readonly style="background:var(--parchment);" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Buyer Name</label>
        <input type="text" id="es-buyer" class="field-input" placeholder="e.g. Ravi Traders..." />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveEggSale()">💾 Save Egg Sale</button>
    </div>
  `;
}

function calcEggTotal() {
  const qty   = parseFloat(document.getElementById('es-qty')?.value) || 0;
  const price = parseFloat(document.getElementById('es-price')?.value) || 0;
  const total = (qty / 12) * price;
  const el    = document.getElementById('es-total');
  if (el) el.value = total.toFixed(2);
}

function saveEggSale() {
  const date  = document.getElementById('es-date')?.value;
  const qty   = document.getElementById('es-qty')?.value;
  const price = document.getElementById('es-price')?.value;
  const buyer = document.getElementById('es-buyer')?.value?.trim();
  const total = parseFloat(document.getElementById('es-total')?.value) || 0;

  if (!date || !qty || !price) { toast('Fill in Date, Qty, and Price.', 'error'); return; }

  eggSales.push({ id: uid(), date, qty: parseInt(qty)||0, pricePerDozen: parseFloat(price)||0, buyer: buyer||'', total });
  save();
  toast('Egg sale recorded!', 'success');
  render();
}

function deleteEggSale(id) {
  eggSales = eggSales.filter(e => e.id !== id);
  save();
  toast('Egg sale deleted.', 'error');
  render();
}

function renderEggSalesList() {
  const sorted = [...eggSales].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <h3 class="section-title" style="font-size:16px;">Egg Sale Records (${eggSales.length})</h3>
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">🥚</div><div class="empty-state-text">No egg sales recorded.</div></div>`
        : sorted.map(e => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${e.buyer || 'Unknown Buyer'}</div>
              <div class="data-row-sub">${formatDate(e.date)} · ${e.qty} eggs · ₹${e.pricePerDozen}/dz</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="data-row-amount">${formatINR(e.total)}</div>
              <button class="btn btn-danger" onclick="deleteEggSale('${e.id}')">✕</button>
            </div>
          </div>`).join('')
      }
    </div>
  `;
}

function renderOtherSalesForm() {
  return `
    <div class="form-card">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">➕ New Other Sale</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field-group">
          <label class="field-label">Date</label>
          <input type="date" id="os-date" class="field-input" value="${today()}" />
        </div>
        <div class="field-group">
          <label class="field-label">Amount (₹)</label>
          <input type="number" id="os-amount" class="field-input" placeholder="0.00" min="0" step="0.01" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <input type="text" id="os-desc" class="field-input" placeholder="e.g. Manure sale, spent hen sale..." />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveOtherSale()">💾 Save Other Sale</button>
    </div>
  `;
}

function saveOtherSale() {
  const date   = document.getElementById('os-date')?.value;
  const amount = document.getElementById('os-amount')?.value;
  const desc   = document.getElementById('os-desc')?.value?.trim();

  if (!date || !amount || !desc) { toast('All fields are required.', 'error'); return; }

  otherSales.push({ id: uid(), date, description: desc, amount: parseFloat(amount)||0, total: parseFloat(amount)||0 });
  save();
  toast('Other sale recorded!', 'success');
  render();
}

function deleteOtherSale(id) {
  otherSales = otherSales.filter(e => e.id !== id);
  save();
  toast('Sale deleted.', 'error');
  render();
}

function renderOtherSalesList() {
  const sorted = [...otherSales].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <h3 class="section-title" style="font-size:16px;">Other Sale Records (${otherSales.length})</h3>
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No other sales recorded.</div></div>`
        : sorted.map(e => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${e.description}</div>
              <div class="data-row-sub">${formatDate(e.date)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="data-row-amount">${formatINR(e.total)}</div>
              <button class="btn btn-danger" onclick="deleteOtherSale('${e.id}')">✕</button>
            </div>
          </div>`).join('')
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// VIEW: EXPENSES
// ═══════════════════════════════════════════════════════════════
const EXPENSE_CATEGORIES = ['Feed', 'Medicine', 'Labour', 'Electricity', 'Transport', 'Equipment', 'Veterinary', 'Other'];

function renderExpenses() {
  const totalExpenses = expenses.reduce((s, e) => s + (parseFloat(e.total)||0), 0);
  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));

  // Category breakdown
  const byCategory = {};
  EXPENSE_CATEGORIES.forEach(c => byCategory[c] = 0);
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + (parseFloat(e.total)||0); });

  const topCats = Object.entries(byCategory).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0,3);

  return `
    <h2 class="section-title">Expenses</h2>

    <div class="stats-row">
      <div class="stat-chip" style="flex:2;">
        <div class="stat-chip-label">Total Spent</div>
        <div class="stat-chip-value" style="color:var(--rust);">${formatINR(totalExpenses)}</div>
      </div>
      ${topCats.map(([cat, amt]) => `
        <div class="stat-chip" style="flex:1;">
          <div class="stat-chip-label">${cat}</div>
          <div class="stat-chip-value" style="font-size:13px;color:var(--bark);">${formatINR(amt)}</div>
        </div>`).join('')}
    </div>

    <!-- Add Expense Form -->
    <div class="form-card">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">➕ Add Expense</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field-group">
          <label class="field-label">Date</label>
          <input type="date" id="exp-date" class="field-input" value="${today()}" />
        </div>
        <div class="field-group">
          <label class="field-label">Amount (₹)</label>
          <input type="number" id="exp-amount" class="field-input" placeholder="0.00" min="0" step="0.01" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Category</label>
        <select id="exp-category" class="field-input">
          ${EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <input type="text" id="exp-desc" class="field-input" placeholder="e.g. 50kg Layer Mash feed..." />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveExpense()">💾 Save Expense</button>
    </div>

    <!-- Expense List -->
    <h3 class="section-title" style="font-size:16px;">All Expenses (${expenses.length})</h3>
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No expenses recorded yet.</div></div>`
        : sorted.map(e => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${e.description || e.category}</div>
              <div class="data-row-sub">${formatDate(e.date)} · <span style="background:rgba(139,99,64,0.1);padding:1px 7px;border-radius:20px;">${e.category}</span></div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="data-row-amount expense">${formatINR(e.total)}</div>
              <button class="btn btn-danger" onclick="deleteExpense('${e.id}')">✕</button>
            </div>
          </div>`).join('')
      }
    </div>
  `;
}

function saveExpense() {
  const date     = document.getElementById('exp-date')?.value;
  const amount   = document.getElementById('exp-amount')?.value;
  const category = document.getElementById('exp-category')?.value;
  const desc     = document.getElementById('exp-desc')?.value?.trim();

  if (!date || !amount) { toast('Date and Amount are required.', 'error'); return; }

  expenses.push({ id: uid(), date, category: category||'Other', description: desc||'', amount: parseFloat(amount)||0, total: parseFloat(amount)||0 });
  save();
  toast('Expense recorded!', 'success');
  render();
}

function deleteExpense(id) {
  expenses = expenses.filter(e => e.id !== id);
  save();
  toast('Expense deleted.', 'error');
  render();
}

// ═══════════════════════════════════════════════════════════════
// VIEW: SETTINGS
// ═══════════════════════════════════════════════════════════════
function renderSettings() {
  return `
    <h2 class="section-title">Settings</h2>
    <p class="section-subtitle">Configure your farm batch and manage data.</p>

    <!-- Farm Configuration -->
    <div class="form-card">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">🐔 Batch Configuration</div>
      <div class="field-group">
        <label class="field-label">Bird Arrival Date</label>
        <input type="date" id="cfg-arrival" class="field-input" value="${farmConfig.arrivalDate || ''}" max="${today()}" />
        <div style="font-size:11px;color:var(--earth);margin-top:5px;">
          This date anchors your Per-Bird Cost and day count calculations.
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Initial Bird Count</label>
        <input type="number" id="cfg-birds" class="field-input" value="${farmConfig.initialBirdCount || ''}" placeholder="e.g. 5000" min="0" />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveFarmConfig()">💾 Save Configuration</button>
    </div>

    <!-- Current Stats Summary -->
    <div class="form-card" style="background:linear-gradient(135deg,rgba(45,106,79,0.04),rgba(64,145,108,0.02));">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">📊 Data Summary</div>
      ${[
        ['Arrival Date', farmConfig.arrivalDate ? formatDate(farmConfig.arrivalDate) : 'Not set'],
        ['Days Running', farmConfig.arrivalDate ? daysSince(farmConfig.arrivalDate) + ' days' : '—'],
        ['Production Records', productionData.length],
        ['Egg Sale Records', eggSales.length],
        ['Other Sale Records', otherSales.length],
        ['Expense Records', expenses.length],
      ].map(([label, val]) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--parchment);font-size:13px;">
          <span style="color:var(--earth);">${label}</span>
          <span style="font-family:'DM Mono',monospace;font-weight:500;color:var(--ink);">${val}</span>
        </div>`).join('')}
    </div>

    <!-- Data Management -->
    <div class="form-card">
      <div style="font-weight:700;color:var(--bark);font-size:14px;margin-bottom:14px;">💾 Data Management</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-export btn-full" onclick="exportData()">
          📥 Export / Backup Data (JSON)
        </button>
        <button class="btn btn-secondary btn-full" onclick="importData()">
          📤 Import Data from JSON
        </button>
        <div class="divider"></div>
        <button class="btn btn-full" style="background:rgba(200,91,46,0.1);color:var(--rust);border:1.5px solid rgba(200,91,46,0.3);" onclick="confirmClearData()">
          🗑️ Clear All Data
        </button>
      </div>
    </div>
  `;
}

function saveFarmConfig() {
  const arrival = document.getElementById('cfg-arrival')?.value;
  const birds   = document.getElementById('cfg-birds')?.value;

  if (!arrival) { toast('Please set an arrival date.', 'error'); return; }

  farmConfig = { arrivalDate: arrival, initialBirdCount: parseInt(birds)||0 };
  save();
  toast('Farm configuration saved!', 'success');
  render();
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    farmConfig,
    productionData,
    eggSales,
    otherSales,
    expenses
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `patil-farms-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Data exported successfully!', 'success');
}

function importData() {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = '.json,application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.farmConfig)     farmConfig     = data.farmConfig;
        if (data.productionData) productionData = data.productionData;
        if (data.eggSales)       eggSales       = data.eggSales;
        if (data.otherSales)     otherSales     = data.otherSales;
        if (data.expenses)       expenses       = data.expenses;
        save();
        toast('Data imported successfully!', 'success');
        render();
      } catch {
        toast('Invalid JSON file. Import failed.', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function confirmClearData() {
  if (confirm('⚠️ This will permanently delete ALL farm data. This cannot be undone.\n\nAre you absolutely sure?')) {
    farmConfig     = { arrivalDate: '', initialBirdCount: 0 };
    productionData = [];
    eggSales       = [];
    otherSales     = [];
    expenses       = [];
    save();
    toast('All data cleared.', 'error');
    render();
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) window.location.hash = '#/home';
  render();
});

window.onresize = () => {
  if (getCurrentRoute() === '#/home') drawProductionChart();
};

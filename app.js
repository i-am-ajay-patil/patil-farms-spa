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

// ─── Authentication ───────────────────────────────────────────
/*
  Password is stored as a SHA-256 hex digest — never in plain text.
  To change the password:
    1. Run: echo -n "YourNewPassword" | sha256sum
    2. Replace the PASSWORD_HASH value below with the output.
  Default password: Patil@1234
*/
const PASSWORD_HASH = 'de89a40fe333f906b3d7f2b4c8cd837e8fe166523a11fed5ac83d7ccfa0e9642';
const AUTH_KEY      = 'pf_authed'; // sessionStorage key — clears on tab/browser close

async function hashPassword(plain) {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === 'true';
}

function lockApp() {
  sessionStorage.removeItem(AUTH_KEY);
  renderAuthGate();
}

function renderAuthGate() {
  document.getElementById('app-content').innerHTML = '';
  // Hide bottom nav while locked
  document.querySelector('.bottom-nav').style.display = 'none';

  const gate = document.getElementById('auth-gate');
  if (gate) { gate.style.display = 'flex'; return; }

  const el = document.createElement('div');
  el.id = 'auth-gate';
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">🥚</div>
      <h1 class="auth-title">Patil Farms</h1>
      <p class="auth-subtitle">Layer Poultry Management</p>
      <div class="field-group" style="margin-bottom:16px;">
        <label class="field-label">Password</label>
        <input
          type="password"
          id="auth-password"
          class="field-input"
          placeholder="Enter password..."
          onkeydown="if(event.key==='Enter') submitPassword()"
          autocomplete="current-password"
        />
        <div id="auth-error" class="auth-error" style="display:none;">
          ✕ Incorrect password. Please try again.
        </div>
      </div>
      <button class="btn btn-primary btn-full" onclick="submitPassword()">
        🔓 Unlock
      </button>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => document.getElementById('auth-password')?.focus(), 100);
}

async function submitPassword() {
  const input = document.getElementById('auth-password');
  const error = document.getElementById('auth-error');
  const btn   = document.querySelector('#auth-gate .btn-primary');
  if (!input) return;

  const val = input.value;
  if (!val) { input.focus(); return; }

  // Disable button during hashing to prevent double-submit
  btn.disabled = true;
  btn.textContent = 'Checking…';

  const hash = await hashPassword(val);

  if (hash === PASSWORD_HASH) {
    sessionStorage.setItem(AUTH_KEY, 'true');
    const gate = document.getElementById('auth-gate');
    if (gate) gate.style.display = 'none';
    document.querySelector('.bottom-nav').style.display = '';
    await initApp();
  } else {
    error.style.display = 'block';
    input.value = '';
    input.focus();
    btn.disabled = false;
    btn.textContent = '🔓 Unlock';
  }
}


// Loaded initially from localStorage; re-seeded from data.json on version mismatch.
let farmConfig     = DB.get('farmConfig',     { arrivalDate: '', initialBirdCount: 0 });
let productionData = DB.get('productionData', []);
let eggSales       = DB.get('eggSales',       []);
let otherSales     = DB.get('otherSales',     []);
let expenses       = DB.get('expenses',       []);

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
  // Current egg inventory (good + damaged eggs minus sold)
  const totalGoodEggs    = productionData.reduce((s, d) => s + (parseInt(d.goodEggs)    || 0), 0);
  const totalDamagedEggs = productionData.reduce((s, d) => s + (parseInt(d.damagedEggs) || 0), 0);
  const totalAllEggs     = totalGoodEggs + totalDamagedEggs;
  const totalEggsSold    = eggSales.reduce((s, e) => s + (parseInt(e.qty) || 0), 0);
  const currentEggInventory = Math.max(0, totalAllEggs - totalEggsSold);

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
     Formula: Total Expenses (₹) / (Current Live Birds × Days Since Arrival)

     This gives a daily per-bird maintenance cost — i.e. how much
     it costs to maintain one bird for one day, averaged across the
     entire batch lifetime so far.

     - Numerator:   Sum of all recorded expenses
     - Denominator: currentLiveBirds × daysSince(arrivalDate)
     ----------------------------------------------------------- */
  const currentLiveBirds = (() => {
    if (productionData.length === 0) return parseInt(farmConfig.initialBirdCount) || 0;
    const sorted = [...productionData].sort((a, b) => b.date.localeCompare(a.date));
    return parseInt(sorted[0].liveBirds) || parseInt(farmConfig.initialBirdCount) || 0;
  })();

  const daysElapsed = farmConfig.arrivalDate ? daysSince(farmConfig.arrivalDate) : 0;
  const costPerBird = (currentLiveBirds > 0 && daysElapsed > 0)
    ? totalExpenses / (currentLiveBirds * daysElapsed)
    : 0;

  return {
    currentEggInventory,
    totalSalesRevenue,
    cashInHand,
    costPerBird,
    currentLiveBirds,
    totalExpenses,
    daysElapsed
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
        <div class="metric-sub">eggs · ${(m.currentEggInventory / 30).toFixed(1)} trays</div>
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
        <div class="metric-sub">per bird per day</div>
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
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink);margin-bottom:3px;">
        <span>Days Since Arrival</span>
        <span style="font-family:'DM Mono',monospace;">${m.daysElapsed} days</span>
      </div>
      <div style="height:1px;background:var(--parchment);margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--earth);margin-bottom:6px;">
        <span>Expenses ÷ (Birds × Days)</span>
        <span style="font-family:'DM Mono',monospace;">${formatINR(m.totalExpenses)} ÷ (${m.currentLiveBirds} × ${m.daysElapsed})</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:var(--bark);">
        <span>= Cost / Bird / Day</span>
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
// MONTHLY AGGREGATION ENGINE
// ═══════════════════════════════════════════════════════════════
/*
  getMonthlyProductionSummary()
  ─────────────────────────────
  Groups productionData by YYYY-MM, then for each month computes:
  - totalGoodEggs:    Sum of all goodEggs in that month
  - totalDamagedEggs: Sum of all damagedEggs in that month
  - totalEggs:        goodEggs + damagedEggs
  - trays:            totalGoodEggs / 30  (standard tray = 30 eggs)
  - daysLogged:       Number of daily entries recorded in that month
  - avgDailyOutput:   totalGoodEggs / daysLogged
                      (average of daily production values actually recorded,
                       NOT divided by calendar days — reflects real output days)
  - avgLiveBirds:     Average live bird count across logged days
  Returns array sorted newest month first.
*/
function getMonthlyProductionSummary() {
  if (productionData.length === 0) return [];

  const monthMap = {};

  productionData.forEach(d => {
    const monthKey = d.date.slice(0, 7); // 'YYYY-MM'
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        monthKey,
        entries: []
      };
    }
    monthMap[monthKey].entries.push(d);
  });

  return Object.values(monthMap)
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map(({ monthKey, entries }) => {
      const totalGoodEggs    = entries.reduce((s, e) => s + (parseInt(e.goodEggs)    || 0), 0);
      const totalDamagedEggs = entries.reduce((s, e) => s + (parseInt(e.damagedEggs) || 0), 0);
      const totalEggs        = totalGoodEggs + totalDamagedEggs;
      const daysLogged       = entries.length;
      const trays            = totalEggs / 30;
      // Average daily output = mean of each day's goodEggs (only days with data)
      const avgDailyOutput   = daysLogged > 0 ? totalEggs / daysLogged : 0;
      const avgLiveBirds     = daysLogged > 0
        ? entries.reduce((s, e) => s + (parseInt(e.liveBirds) || 0), 0) / daysLogged
        : 0;

      // Human-readable month label e.g. "Jun 2025"
      const [year, month] = monthKey.split('-');
      const label = new Date(parseInt(year), parseInt(month) - 1, 1)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

      return { monthKey, label, totalGoodEggs, totalDamagedEggs, totalEggs, trays, daysLogged, avgDailyOutput, avgLiveBirds };
    });
}

// Render the monthly summary table HTML
function renderMonthlyTable() {
  const rows = getMonthlyProductionSummary();

  if (rows.length === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">No production data yet. Start logging daily entries.</div></div>`;
  }

  // Totals row
  const grandGood    = rows.reduce((s, r) => s + r.totalGoodEggs, 0);
  const grandDamaged = rows.reduce((s, r) => s + r.totalDamagedEggs, 0);
  const grandTotal   = rows.reduce((s, r) => s + r.totalEggs, 0);
  const grandTrays   = grandTotal / 30;

  return `
    <div class="monthly-table-wrapper">
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num-col">Good 🥚</th>
            <th class="num-col">Dmg 🩹</th>
            <th class="num-col">Trays</th>
            <th class="num-col">Avg/Day</th>
            <th class="num-col">Days</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
              <td class="month-label-cell">${r.label}</td>
              <td class="num-col good-col">${r.totalGoodEggs.toLocaleString('en-IN')}</td>
              <td class="num-col damaged-col">${r.totalDamagedEggs.toLocaleString('en-IN')}</td>
              <td class="num-col tray-col">${r.trays.toFixed(1)}</td>
              <td class="num-col avg-col">${r.avgDailyOutput.toFixed(0)}</td>
              <td class="num-col days-col">${r.daysLogged}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="month-label-cell">Grand Total</td>
            <td class="num-col good-col">${grandGood.toLocaleString('en-IN')}</td>
            <td class="num-col damaged-col">${grandDamaged.toLocaleString('en-IN')}</td>
            <td class="num-col tray-col">${grandTrays.toFixed(1)}</td>
            <td class="num-col avg-col">—</td>
            <td class="num-col days-col">${rows.reduce((s,r) => s + r.daysLogged, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="monthly-table-legend">
      <span>Trays = Total Eggs (Good + Damaged) ÷ 30</span>
      <span>·</span>
      <span>Avg/Day = Total Eggs (Good + Damaged) ÷ Days Logged</span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// VIEW: PRODUCTION LOG
// ═══════════════════════════════════════════════════════════════
function renderProduction() {
  const sorted = [...productionData].sort((a, b) => b.date.localeCompare(a.date));
  const todayStr = today();
  const todayEntry = productionData.find(d => d.date === todayStr);
  const activeTab = window._prodTab || 'monthly';

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

    <!-- View Toggle Tabs -->
    <div class="tab-group">
      <button class="tab-btn ${activeTab === 'monthly' ? 'active' : ''}" onclick="setProdTab('monthly')">📅 Monthly Summary</button>
      <button class="tab-btn ${activeTab === 'daily' ? 'active' : ''}" onclick="setProdTab('daily')">📋 Daily Records</button>
    </div>

    <!-- Daily Records Tab -->
    ${activeTab === 'daily' ? `
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
      </div>` : ''}

    <!-- Monthly Summary Tab -->
    ${activeTab === 'monthly' ? `
      <h3 class="section-title" style="font-size:16px;">Monthly Summary</h3>
      <div class="card" style="overflow:hidden;">
        ${renderMonthlyTable()}
      </div>` : ''}
  `;
}

function setProdTab(tab) {
  window._prodTab = tab;
  render();
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

// ── Aggregation helpers ──────────────────────────────────────

/*
  getEggMonthlySummary(): groups eggSales by YYYY-MM.
  Per month: totalSales (₹), totalQty (eggs), totalTrays (qty/30),
  avgPricePerEgg (weighted), txCount.
*/
function getEggMonthlySummary() {
  if (eggSales.length === 0) return [];
  const map = {};
  eggSales.forEach(e => {
    const k = e.date.slice(0, 7);
    if (!map[k]) map[k] = { k, entries: [] };
    map[k].entries.push(e);
  });
  return Object.values(map)
    .sort((a, b) => b.k.localeCompare(a.k))
    .map(({ k, entries }) => {
      const totalSales     = entries.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
      const totalQty       = entries.reduce((s, e) => s + (parseInt(e.qty)     || 0), 0);
      const avgPricePerEgg = totalQty > 0 ? totalSales / totalQty : 0;
      const [yr, mo]       = k.split('-');
      const label          = new Date(parseInt(yr), parseInt(mo) - 1, 1)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return { k, label, totalSales, totalQty, totalTrays: totalQty / 30, avgPricePerEgg };
    });
}

/*
  getOtherMonthlySummary(): groups otherSales by YYYY-MM.
  Per month: totalSales (₹), totalQty (units), txCount.
*/
function getOtherMonthlySummary() {
  if (otherSales.length === 0) return [];
  const map = {};
  otherSales.forEach(e => {
    const k = e.date.slice(0, 7);
    if (!map[k]) map[k] = { k, entries: [] };
    map[k].entries.push(e);
  });
  return Object.values(map)
    .sort((a, b) => b.k.localeCompare(a.k))
    .map(({ k, entries }) => {
      const totalSales = entries.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
      const totalQty   = entries.reduce((s, e) => s + (parseFloat(e.qty)   || 0), 0);
      const txCount    = entries.length;
      const [yr, mo]   = k.split('-');
      const label      = new Date(parseInt(yr), parseInt(mo) - 1, 1)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return { k, label, totalSales, totalQty, txCount };
    });
}

// ── Combined monthly summary (egg + other) for top-level tab ──
function renderCombinedMonthlySummary() {
  const totalEgg   = eggSales.reduce((s, e)  => s + (parseFloat(e.total) || 0), 0);
  const totalOther = otherSales.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const grandTotal = totalEgg + totalOther;

  // Merge all months from both sources
  const monthSet = new Set([
    ...eggSales.map(e => e.date.slice(0, 7)),
    ...otherSales.map(e => e.date.slice(0, 7))
  ]);

  if (monthSet.size === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">No sales recorded yet.</div></div>`;
  }

  const eggMap   = {};
  eggSales.forEach(e   => { const k = e.date.slice(0,7);   eggMap[k]   = (eggMap[k]   || 0) + (parseFloat(e.total) || 0); });
  const otherMap = {};
  otherSales.forEach(e => { const k = e.date.slice(0,7); otherMap[k] = (otherMap[k] || 0) + (parseFloat(e.total) || 0); });

  const rows = [...monthSet].sort((a, b) => b.localeCompare(a)).map(k => {
    const [yr, mo] = k.split('-');
    const label    = new Date(parseInt(yr), parseInt(mo) - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const egg   = eggMap[k]   || 0;
    const other = otherMap[k] || 0;
    return { label, egg, other, total: egg + other };
  });

  const grandEgg   = rows.reduce((s, r) => s + r.egg,   0);
  const grandOther = rows.reduce((s, r) => s + r.other, 0);

  return `
    <div class="monthly-table-wrapper">
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num-col">Egg Sales</th>
            <th class="num-col">Other Sales</th>
            <th class="num-col">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
              <td class="month-label-cell">${r.label}</td>
              <td class="num-col good-col">${formatINR(r.egg)}</td>
              <td class="num-col tray-col">${formatINR(r.other)}</td>
              <td class="num-col" style="color:var(--bark);font-weight:700;">${formatINR(r.total)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="month-label-cell">Grand Total</td>
            <td class="num-col good-col">${formatINR(grandEgg)}</td>
            <td class="num-col tray-col">${formatINR(grandOther)}</td>
            <td class="num-col" style="color:var(--grove);font-weight:700;">${formatINR(grandEgg + grandOther)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="monthly-table-legend">
      <span>Egg Sales + Other Sales = Monthly Total</span>
    </div>
  `;
}

// ── Egg sales monthly summary table ──
function renderEggMonthlySummaryTable() {
  const rows = getEggMonthlySummary();
  if (rows.length === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">🥚</div><div class="empty-state-text">No egg sales recorded yet.</div></div>`;
  }
  const grandSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const grandQty   = rows.reduce((s, r) => s + r.totalQty,   0);
  const grandAvg   = grandQty > 0 ? grandSales / grandQty : 0;
  return `
    <div class="monthly-table-wrapper">
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num-col">Qty 🥚</th>
            <th class="num-col">Trays</th>
            <th class="num-col">Revenue</th>
            <th class="num-col">Avg ₹/Egg</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
              <td class="month-label-cell">${r.label}</td>
              <td class="num-col good-col">${r.totalQty.toLocaleString('en-IN')}</td>
              <td class="num-col tray-col">${r.totalTrays.toFixed(1)}</td>
              <td class="num-col" style="color:var(--grove);font-weight:600;">${formatINR(r.totalSales)}</td>
              <td class="num-col avg-col">₹${r.avgPricePerEgg.toFixed(2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="month-label-cell">Grand Total</td>
            <td class="num-col good-col">${grandQty.toLocaleString('en-IN')}</td>
            <td class="num-col tray-col">${(grandQty / 30).toFixed(1)}</td>
            <td class="num-col" style="color:var(--grove);font-weight:700;">${formatINR(grandSales)}</td>
            <td class="num-col avg-col">₹${grandAvg.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="monthly-table-legend">
      <span>Trays = Qty ÷ 30</span><span>·</span>
      <span>Avg ₹/Egg = Revenue ÷ Qty (weighted)</span>
    </div>
  `;
}

// ── Other sales monthly summary table ──
function renderOtherMonthlySummaryTable() {
  const rows = getOtherMonthlySummary();
  if (rows.length === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No other sales recorded yet.</div></div>`;
  }
  const grandSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const grandTx    = rows.reduce((s, r) => s + r.txCount,    0);
  return `
    <div class="monthly-table-wrapper">
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num-col">Transactions</th>
            <th class="num-col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
              <td class="month-label-cell">${r.label}</td>
              <td class="num-col days-col">${r.txCount}</td>
              <td class="num-col" style="color:var(--grove);font-weight:600;">${formatINR(r.totalSales)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="month-label-cell">Grand Total</td>
            <td class="num-col days-col">${grandTx}</td>
            <td class="num-col" style="color:var(--grove);font-weight:700;">${formatINR(grandSales)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// ── Top-level renderSales ────────────────────────────────────
function renderSales() {
  const activeTab  = window._salesTab  || 'monthly';
  const activeEgg  = window._eggTab    || 'summary';
  const activeOther = window._otherTab || 'summary';

  const totalEgg   = eggSales.reduce((s, e)  => s + (parseFloat(e.total)||0), 0);
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

    <!-- Top-level tabs -->
    <div class="tab-group">
      <button class="tab-btn compact ${activeTab==='monthly'?'active':''}" onclick="setSalesTab('monthly')">📅 Monthly Summary</button>
      <button class="tab-btn compact ${activeTab==='egg'    ?'active':''}" onclick="setSalesTab('egg')">🥚 Egg Sales</button>
      <button class="tab-btn compact ${activeTab==='other'  ?'active':''}" onclick="setSalesTab('other')">📦 Other Sales</button>
    </div>

    <!-- MONTHLY SUMMARY (combined) -->
    ${activeTab === 'monthly' ? `
      <h3 class="section-title" style="font-size:16px;">Monthly Sales Summary</h3>
      <div class="card" style="overflow:hidden;">${renderCombinedMonthlySummary()}</div>
    ` : ''}

    <!-- EGG SALES: add form + nested sub-tabs -->
    ${activeTab === 'egg' ? `
      ${renderEggSalesForm()}
      <div class="tab-group" style="margin-top:4px;">
        <button class="tab-btn ${activeEgg==='summary'?'active':''}" onclick="setEggTab('summary')">📅 Monthly Summary</button>
        <button class="tab-btn ${activeEgg==='records'?'active':''}" onclick="setEggTab('records')">📋 Sales Records</button>
      </div>
      ${activeEgg === 'summary' ? `
        <div class="card" style="overflow:hidden;">${renderEggMonthlySummaryTable()}</div>
      ` : renderEggSalesRecordsList()}
    ` : ''}

    <!-- OTHER SALES: add form + nested sub-tabs -->
    ${activeTab === 'other' ? `
      ${renderOtherSalesForm()}
      <div class="tab-group" style="margin-top:4px;">
        <button class="tab-btn ${activeOther==='summary'?'active':''}" onclick="setOtherTab('summary')">📅 Monthly Summary</button>
        <button class="tab-btn ${activeOther==='records'?'active':''}" onclick="setOtherTab('records')">📋 Sales Records</button>
      </div>
      ${activeOther === 'summary' ? `
        <div class="card" style="overflow:hidden;">${renderOtherMonthlySummaryTable()}</div>
      ` : renderOtherSalesRecordsList()}
    ` : ''}
  `;
}

function setSalesTab(tab) { window._salesTab  = tab; render(); }
function setEggTab(tab)   { window._eggTab    = tab; render(); }
function setOtherTab(tab) { window._otherTab  = tab; render(); }

// ── Egg Sales form / save / delete ──────────────────────────
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
          <label class="field-label">Price / Egg (₹)</label>
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
  const qty   = parseFloat(document.getElementById('es-qty')?.value)   || 0;
  const price = parseFloat(document.getElementById('es-price')?.value) || 0;
  const el    = document.getElementById('es-total');
  if (el) el.value = (qty * price).toFixed(2);
}

function saveEggSale() {
  const date  = document.getElementById('es-date')?.value;
  const qty   = document.getElementById('es-qty')?.value;
  const price = document.getElementById('es-price')?.value;
  const buyer = document.getElementById('es-buyer')?.value?.trim();
  const total = parseFloat(document.getElementById('es-total')?.value) || 0;
  if (!date || !qty || !price) { toast('Fill in Date, Qty, and Price.', 'error'); return; }
  eggSales.push({ id: uid(), date, qty: parseInt(qty)||0, pricePerEgg: parseFloat(price)||0, buyer: buyer||'', total });
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

function renderEggSalesRecordsList() {
  const sorted = [...eggSales].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">🥚</div><div class="empty-state-text">No egg sales recorded.</div></div>`
        : sorted.map(e => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${e.buyer || 'Unknown Buyer'}</div>
              <div class="data-row-sub">${formatDate(e.date)} · ${e.qty} eggs · ₹${e.pricePerEgg}/egg</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="data-row-amount">${formatINR(e.total)}</div>
              <button class="btn btn-danger" onclick="deleteEggSale('${e.id}')">✕</button>
            </div>
          </div>`).join('')}
    </div>
  `;
}

// ── Other Sales form / save / delete ────────────────────────
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
          <label class="field-label">Description</label>
          <input type="text" id="os-desc" class="field-input" placeholder="e.g. Manure, spent hen..." />
        </div>
        <div class="field-group">
          <label class="field-label">Quantity</label>
          <input type="number" id="os-qty" class="field-input" placeholder="0" min="0" oninput="calcOtherTotal()" />
        </div>
        <div class="field-group">
          <label class="field-label">Price / Unit (₹)</label>
          <input type="number" id="os-unitprice" class="field-input" placeholder="0.00" min="0" step="0.01" oninput="calcOtherTotal()" />
        </div>
        <div class="field-group">
          <label class="field-label">Amount (₹)</label>
          <input type="number" id="os-amount" class="field-input" placeholder="Auto-calc" readonly style="background:var(--parchment);" />
        </div>
        <div class="field-group">
          <label class="field-label">Remarks</label>
          <input type="text" id="os-remarks" class="field-input" placeholder="Optional notes..." />
        </div>
      </div>
      <button class="btn btn-primary btn-full" onclick="saveOtherSale()">💾 Save Other Sale</button>
    </div>
  `;
}

function calcOtherTotal() {
  const qty       = parseFloat(document.getElementById('os-qty')?.value)       || 0;
  const unitPrice = parseFloat(document.getElementById('os-unitprice')?.value) || 0;
  const el        = document.getElementById('os-amount');
  if (el) el.value = (qty * unitPrice).toFixed(2);
}

function saveOtherSale() {
  const date      = document.getElementById('os-date')?.value;
  const desc      = document.getElementById('os-desc')?.value?.trim();
  const qty       = document.getElementById('os-qty')?.value;
  const unitPrice = document.getElementById('os-unitprice')?.value;
  const remarks   = document.getElementById('os-remarks')?.value?.trim();
  const amount    = parseFloat(document.getElementById('os-amount')?.value) || 0;
  if (!date || !desc || !qty || !unitPrice) { toast('Date, Description, Qty and Price are required.', 'error'); return; }
  otherSales.push({ id: uid(), date, description: desc, qty: parseFloat(qty)||0, unitPrice: parseFloat(unitPrice)||0, remarks: remarks||'', amount, total: amount });
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

function renderOtherSalesRecordsList() {
  const sorted = [...otherSales].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <div class="card">
      ${sorted.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No other sales recorded.</div></div>`
        : sorted.map(e => `
          <div class="data-row">
            <div>
              <div class="data-row-label">${e.description}</div>
              <div class="data-row-sub">
                ${formatDate(e.date)} · ${e.qty || '—'} units · ₹${e.unitPrice || '—'}/unit
                ${e.remarks ? `· <em>${e.remarks}</em>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="data-row-amount">${formatINR(e.total)}</div>
              <button class="btn btn-danger" onclick="deleteOtherSale('${e.id}')">✕</button>
            </div>
          </div>`).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// VIEW: EXPENSES
// ═══════════════════════════════════════════════════════════════
const EXPENSE_CATEGORIES = ['Feed', 'Medicine', 'Labour', 'Electricity', 'Transport', 'Equipment', 'Veterinary', 'Other'];
const EXPENSE_PAYERS     = ['Sales', 'Ajay', 'Shivu'];

function renderExpenses() {
  const totalExpenses = expenses.reduce((s, e) => s + (parseFloat(e.total)||0), 0);
  const activeTab = window._expTab || 'payer';

  // Payer summary: total paid per payer
  const byPayer = {};
  EXPENSE_PAYERS.forEach(p => byPayer[p] = 0);
  expenses.forEach(e => {
    const p = e.paidBy || 'Sales';
    byPayer[p] = (byPayer[p] || 0) + (parseFloat(e.total) || 0);
  });

  // Top category chips for header summary
  const byCategory = {};
  EXPENSE_CATEGORIES.forEach(c => byCategory[c] = 0);
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + (parseFloat(e.total)||0); });
  const topCats = Object.entries(byCategory).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0,2);

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
      <div class="grid grid-cols-2 gap-3">
        <div class="field-group">
          <label class="field-label">Category</label>
          <select id="exp-category" class="field-input">
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Paid By</label>
          <select id="exp-paidby" class="field-input">
            ${EXPENSE_PAYERS.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <input type="text" id="exp-desc" class="field-input" placeholder="e.g. 50kg Layer Mash feed..." />
      </div>
      <button class="btn btn-primary btn-full" onclick="saveExpense()">💾 Save Expense</button>
    </div>

    <!-- View Tabs -->
    <div class="tab-group">
      <button class="tab-btn ${activeTab === 'payer' ? 'active' : ''}" onclick="setExpTab('payer')">👤 Payer Summary</button>
      <button class="tab-btn ${activeTab === 'records' ? 'active' : ''}" onclick="setExpTab('records')">📋 Expense Records</button>
    </div>

    <!-- Payer Summary Tab -->
    ${activeTab === 'payer' ? `
      <h3 class="section-title" style="font-size:16px;">Payer Summary</h3>
      <div class="card" style="overflow:hidden;">
        ${renderPayerSummaryTable(byPayer, totalExpenses)}
      </div>` : ''}

    <!-- Expense Records Tab -->
    ${activeTab === 'records' ? `
      <h3 class="section-title" style="font-size:16px;">All Expenses (${expenses.length})</h3>
      <div class="card">
        ${renderExpenseRecordsList()}
      </div>` : ''}
  `;
}

// Payer summary table — who paid how much, count of transactions, % share
function renderPayerSummaryTable(byPayer, totalExpenses) {
  if (expenses.length === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-text">No expenses recorded yet.</div></div>`;
  }

  // Count transactions per payer
  const countByPayer = {};
  EXPENSE_PAYERS.forEach(p => countByPayer[p] = 0);
  expenses.forEach(e => { const p = e.paidBy || 'Sales'; countByPayer[p] = (countByPayer[p]||0) + 1; });

  const rows = EXPENSE_PAYERS.map(p => ({
    payer: p,
    total: byPayer[p] || 0,
    count: countByPayer[p] || 0,
    pct:   totalExpenses > 0 ? ((byPayer[p] || 0) / totalExpenses * 100) : 0
  }));

  return `
    <div class="monthly-table-wrapper">
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Paid By</th>
            <th class="num-col">Transactions</th>
            <th class="num-col">Amount (₹)</th>
            <th class="num-col">Share %</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
              <td class="month-label-cell">
                <span class="payer-badge payer-${r.payer.toLowerCase()}">${r.payer}</span>
              </td>
              <td class="num-col days-col">${r.count}</td>
              <td class="num-col good-col">${formatINR(r.total)}</td>
              <td class="num-col avg-col">
                <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                  <div class="pct-bar-wrap">
                    <div class="pct-bar" style="width:${r.pct.toFixed(1)}%;"></div>
                  </div>
                  <span>${r.pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="month-label-cell">Grand Total</td>
            <td class="num-col days-col">${expenses.length}</td>
            <td class="num-col good-col">${formatINR(totalExpenses)}</td>
            <td class="num-col avg-col">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="monthly-table-legend">
      <span>Share % = Payer Amount ÷ Total Expenses × 100</span>
    </div>
  `;
}

function renderExpenseRecordsList() {
  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) {
    return `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No expenses recorded yet.</div></div>`;
  }
  return sorted.map(e => `
    <div class="data-row">
      <div>
        <div class="data-row-label">${e.description || e.category}</div>
        <div class="data-row-sub">
          ${formatDate(e.date)} ·
          <span style="background:rgba(139,99,64,0.1);padding:1px 7px;border-radius:20px;">${e.category}</span> ·
          <span class="payer-badge payer-${(e.paidBy||'sales').toLowerCase()}">${e.paidBy || 'Sales'}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="data-row-amount expense">${formatINR(e.total)}</div>
        <button class="btn btn-danger" onclick="deleteExpense('${e.id}')">✕</button>
      </div>
    </div>`).join('');
}

function setExpTab(tab) {
  window._expTab = tab;
  render();
}

function saveExpense() {
  const date     = document.getElementById('exp-date')?.value;
  const amount   = document.getElementById('exp-amount')?.value;
  const category = document.getElementById('exp-category')?.value;
  const paidBy   = document.getElementById('exp-paidby')?.value;
  const desc     = document.getElementById('exp-desc')?.value?.trim();

  if (!date || !amount) { toast('Date and Amount are required.', 'error'); return; }

  expenses.push({ id: uid(), date, category: category||'Other', paidBy: paidBy||'Sales', description: desc||'', amount: parseFloat(amount)||0, total: parseFloat(amount)||0 });
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
        <button class="btn btn-full" style="background:rgba(92,61,30,0.08);color:var(--bark);border:1.5px solid rgba(92,61,30,0.2);" onclick="lockApp()">
          🔒 Lock App
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
    dataVersion:   DB.get('dataVersion', ''),
    exportedAt:    new Date().toISOString(),
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
    DB.set('dataVersion', '');
    toast('All data cleared.', 'error');
    render();
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT — Versioned seed from data.json
// ═══════════════════════════════════════════════════════════════

/*
  Seeding strategy:
  - data.json must contain a top-level "dataVersion" string (e.g. "2025-06-01.1").
  - localStorage stores the last-seeded version under key 'dataVersion'.
  - On every page load we fetch data.json and compare versions.
  - If versions match  → use existing localStorage (user's local edits preserved).
  - If versions differ → wipe localStorage and re-seed from data.json, then render.
  - On fetch failure   → fall back to whatever is already in localStorage and render.
*/
async function initApp() {
  if (!window.location.hash) window.location.hash = '#/home';

  try {
    // Cache-busting via timestamp so GitHub Pages CDN doesn't serve stale JSON
    const res  = await fetch(`./data.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const remoteVersion = data.dataVersion || '';
    const localVersion  = DB.get('dataVersion', '');

    if (remoteVersion && remoteVersion !== localVersion) {
      // ── Version mismatch: wipe and re-seed ──────────────────
      console.info(`[Patil Farms] Data version changed (${localVersion || 'none'} → ${remoteVersion}). Re-seeding.`);

      farmConfig     = data.farmConfig     || { arrivalDate: '', initialBirdCount: 0 };
      productionData = data.productionData || [];
      eggSales       = data.eggSales       || [];
      otherSales     = data.otherSales     || [];
      expenses       = data.expenses       || [];

      // Persist seeded data and record the version we just loaded
      save();
      DB.set('dataVersion', remoteVersion);

      toast(`Data updated to version ${remoteVersion}`, 'info');
    }
    // ── Version matches: nothing to do, localStorage is current ─
  } catch (err) {
    // Network offline, file missing, or parse error — use existing localStorage silently
    console.warn('[Patil Farms] Could not fetch data.json, using local data.', err.message);
  }

  render();
}

window.addEventListener('DOMContentLoaded', () => {
  if (isAuthed()) {
    initApp();
  } else {
    renderAuthGate();
  }
});

window.onresize = () => {
  if (getCurrentRoute() === '#/home') drawProductionChart();
};

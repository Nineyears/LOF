/**
 * FundScope PRO — LOF溢价监控 & QDII额度追踪
 */

// ==================== State ====================
const S = {
  page: 'lof',
  lof:  { raw: [], filtered: [], filter: 'all', search: '', sort: 'premium_desc', loading: false },
  qdii: { raw: [], filtered: [], filter: 'all', search: '', sort: 'purchaseLimit_desc', loading: false },
  enhance: { groups: [], flatList: [], filtered: [], filter: 'all', search: '', sort: 'ytd_desc', loading: false, view: 'group' },
  futures: { raw: [], filtered: [], filter: 'all', sort: 'annualizedReturn_desc', loading: false },
  compare: { active: false, selected: [], period: 'month3', chart: null },
  lastUpdate: null,
  yield: {},          // code -> { ytd, month1, month3, month6, year1, ... }
  yieldLoaded: false,
  // 当前选中的收益率列（多选）
  activeCols: { lof: new Set(), qdii: new Set(), enhance: new Set() },
};

// 收益率列配置
const YIELD_COLS = [
  { key: 'ytd',    label: '今年来' },
  { key: 'month1', label: '近1月' },
  { key: 'month3', label: '近3月' },
  { key: 'month6', label: '近半年' },
  { key: 'year1',  label: '近1年' },
];

// ==================== Helpers ====================
const fmt = (n, d = 4) => (n == null || isNaN(n)) ? '--' : Number(n).toFixed(d);
const fmtPct = n => {
  if (n == null || isNaN(n)) return '--';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
};
const fmtMoney = a => {
  if (!a || isNaN(a)) return '--';
  a = Number(a);
  if (a >= 1e8) return `${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(a / 1e4).toFixed(2)}万`;
  return `${a.toFixed(0)}元`;
};
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// 格式化净值日期（短格式 MM-DD）
function fmtNavDate(dateStr) {
  if (!dateStr) return '--';
  // 2026-03-20 → 03-20
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[1]}-${parts[2]}`;
  return dateStr;
}

// 判断日期是否为最新（今天或上一个交易日）
function isLatestDate(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  today.setHours(0, 0, 0, 0);
  const diff = (today - d) / (1000 * 60 * 60 * 24);
  // 允许3天差距（周末等情况）
  return diff <= 3;
}

// ==================== 收益率数据 ====================
async function loadYieldData(forceRefresh = false) {
  if (S.yieldLoaded && !forceRefresh) return;
  try {
    const url = `/api/yield?_=${Date.now()}${forceRefresh ? '&refresh=1' : ''}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.success && json.data) {
      S.yield = json.data;
      S.yieldLoaded = true;
      console.log(`[收益率] 加载完成, ${Object.keys(json.data).length} 只`);
    }
  } catch (err) {
    console.error('收益率加载失败:', err);
  }
}

// ==================== 动态表头更新 ====================
function updateTableHead(page) {
  const headId = page === 'lof' ? 'lofTableHead' : 'qdiiTableHead';
  const headRow = document.getElementById(headId);
  if (!headRow) return;

  // 移除旧的收益率列
  headRow.querySelectorAll('.th-yield').forEach(th => th.remove());

  const activeCols = S.activeCols[page];
  if (activeCols.size === 0) return;

  // 在倒数第二列（状态列）前面插入收益率列
  const insertBefore = page === 'lof'
    ? headRow.querySelector('.th-status')
    : headRow.querySelector('.th-status');

  YIELD_COLS.forEach(col => {
    if (!activeCols.has(col.key)) return;
    const th = document.createElement('th');
    th.className = 'th-yield th-sortable';
    th.dataset.sortKey = col.key;
    th.textContent = col.label;
    headRow.insertBefore(th, insertBefore);
  });
}

// ==================== Excel 导出 ====================
function exportToExcel(page) {
  const data = page === 'lof' ? S.lof.filtered : page === 'qdii' ? S.qdii.filtered : S.enhance.filtered;
  if (!data || data.length === 0) return alert('暂无数据可导出');

  const activeCols = S.activeCols[page] || new Set();

  // 构建表头
  const headers = [];
  if (page === 'enhance') {
    headers.push('#', '基金代码', '基金名称', '分组', '跟踪指数', '最新净值', '日涨幅');
    YIELD_COLS.forEach(col => headers.push(col.label));
    headers.push('备注');
  } else if (page === 'lof') {
    headers.push('#', '基金代码', '基金名称', '二级市场价格', '基金净值', '溢价率');
    YIELD_COLS.forEach(col => { if (activeCols.has(col.key)) headers.push(col.label); });
    headers.push('可申购', '申购限额');
  } else {
    headers.push('#', '基金代码', '基金名称', '最新净值', '净值日期', '日涨幅');
    YIELD_COLS.forEach(col => { if (activeCols.has(col.key)) headers.push(col.label); });
    headers.push('申购状态', '可购买额度');
  }

  // 构建数据行
  const rows = data.map((f, i) => {
    const yld = S.yield[f.code] || {};
    const row = [];
    if (page === 'enhance') {
      row.push(i + 1, f.code, f.name, f.groupName || '', f.trackIndex || '');
      row.push(f.nav != null ? f.nav.toFixed(4) : '');
      row.push(f.dailyChange != null ? (f.dailyChange > 0 ? '+' : '') + f.dailyChange.toFixed(2) + '%' : '');
      YIELD_COLS.forEach(col => {
        const v = f[col.key];
        row.push(v != null ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '');
      });
      row.push(f.note || '');
    } else if (page === 'lof') {
      row.push(i + 1, f.code, f.name);
      row.push(f.price != null ? f.price.toFixed(4) : '');
      row.push(f.nav != null ? f.nav.toFixed(4) : '');
      row.push(f.premium != null ? (f.premium > 0 ? '+' : '') + f.premium.toFixed(2) + '%' : '');
      YIELD_COLS.forEach(col => {
        if (!activeCols.has(col.key)) return;
        const v = yld[col.key];
        row.push(v != null ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '');
      });
      row.push(f.purchaseStatus || '未知');
      row.push(f.purchaseLimit ? fmtMoney(f.purchaseLimit) : (f.purchasable === true ? '无限额' : (f.purchasable === false ? '暂停申购' : '--')));
    } else {
      row.push(i + 1, f.code, f.name);
      row.push(f.nav != null ? f.nav.toFixed(4) : '');
      row.push(f.navDate || '');
      row.push(f.dailyChange != null ? (f.dailyChange > 0 ? '+' : '') + f.dailyChange.toFixed(2) + '%' : '');
      YIELD_COLS.forEach(col => {
        if (!activeCols.has(col.key)) return;
        const v = yld[col.key];
        row.push(v != null ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '');
      });
      row.push(f.purchaseStatus || '未知');
      row.push(f.purchaseLimit ? fmtMoney(f.purchaseLimit) : (f.purchasable === true && f.purchaseStatus !== '限大额' ? '无限额' : (f.purchasable === false ? '暂停申购' : '--')));
    }
    return row;
  });

  // 生成 CSV (带 BOM 以兼容 Excel 中文)
  const BOM = '\uFEFF';
  const escCell = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = BOM + [headers.map(escCell).join(','), ...rows.map(r => r.map(escCell).join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  link.download = `FundScope_${page.toUpperCase()}_${dateStr}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function isMarketOpen() {
  const d = new Date(), day = d.getDay(), t = d.getHours() * 60 + d.getMinutes();
  return day > 0 && day < 6 && ((t >= 570 && t <= 690) || (t >= 780 && t <= 900));
}

function updateMarketStatus() {
  const el = document.getElementById('marketStatus');
  const txt = el.querySelector('.status-text');
  if (isMarketOpen()) { el.className = 'market-status open'; txt.textContent = '交易中'; }
  else { el.className = 'market-status closed'; txt.textContent = new Date().getDay() % 6 === 0 ? '休市（周末）' : '已收盘'; }
}

// ==================== Theme ====================
function initTheme() {
  const saved = localStorage.getItem('fundscope-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  
  document.getElementById('themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';

    // 1) 先加上过渡类，让所有元素准备好 transition
    html.classList.add('theme-transitioning');

    // 2) 用 rAF 确保浏览器已经应用了过渡类，再切换主题
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html.setAttribute('data-theme', next);
        localStorage.setItem('fundscope-theme', next);

        // 3) 过渡结束后移除类，恢复正常交互性能
        const cleanup = () => {
          html.classList.remove('theme-transitioning');
          html.removeEventListener('transitionend', cleanup);
        };
        // 超时兜底（防止 transitionend 不触发）
        setTimeout(cleanup, 500);
        html.addEventListener('transitionend', cleanup, { once: true });
      });
    });
  });
}

// ==================== Navigation ====================
function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const p = link.dataset.page;
      if (p === S.page) return;
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
      const pageMap = { lof: 'pageLof', qdii: 'pageQdii', enhance: 'pageEnhance', futures: 'pageFutures' };
      document.getElementById(pageMap[p]).classList.add('active');
      S.page = p;
      if (p === 'lof' && S.lof.raw.length === 0) loadLof();
      if (p === 'qdii' && S.qdii.raw.length === 0) loadQdii();
      if (p === 'enhance' && S.enhance.groups.length === 0) loadEnhance();
      if (p === 'futures' && S.futures.raw.length === 0) loadFutures();
    });
  });
}

// ==================== LOF ====================
async function loadLof(forceRefresh = false) {
  if (S.lof.loading) return;
  S.lof.loading = true;
  showLoading('lof', true);
  setRefreshBtnState(true);

  try {
    const url = `/api/lof/full?_=${Date.now()}${forceRefresh ? '&refresh=1' : ''}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json.success || !json.data?.length) throw new Error(json.error || 'LOF数据为空');

    S.lof.raw = json.data;
    S.lastUpdate = new Date();

    applyLofFilters();
    updateLofStats();
    showLoading('lof', false);
    updateCacheHint('lof', json.cached, json.fetchDateLocal);

  } catch (err) {
    console.error('LOF加载失败:', err);
    document.getElementById('lofLoading').innerHTML = errorHtml(err.message);
  } finally {
    S.lof.loading = false;
    setRefreshBtnState(false);
  }
}

function applyLofFilters() {
  let d = [...S.lof.raw];
  if (S.lof.search) {
    const q = S.lof.search.toLowerCase();
    d = d.filter(f => f.code.includes(q) || (f.name && f.name.toLowerCase().includes(q)));
  }
  if (S.lof.filter === 'premium') d = d.filter(f => f.premium > 0);
  else if (S.lof.filter === 'discount') d = d.filter(f => f.premium !== null && f.premium < 0);
  else if (S.lof.filter === 'purchasable') d = d.filter(f => f.purchasable === true);

  // 通用排序
  const sortKey = S.lof.sort || 'premium_desc';

  // 特殊排序（|溢价率|）
  if (sortKey === 'abs_premium_desc') {
    d.sort((a, b) => Math.abs(b.premium || 0) - Math.abs(a.premium || 0));
  } else {
    const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
    const isAsc = dir === 'asc';
    const strFields = new Set(['code', 'name']);

    // 收益率字段需从 S.yield 中取值
    const yieldFields = new Set(['ytd', 'month1', 'month3', 'month6', 'year1']);

    d.sort((a, b) => {
      let va, vb;
      if (yieldFields.has(field)) {
        va = (S.yield[a.code] || {})[field] ?? (isAsc ? Infinity : -Infinity);
        vb = (S.yield[b.code] || {})[field] ?? (isAsc ? Infinity : -Infinity);
      } else {
        va = a[field] ?? (isAsc ? Infinity : -Infinity);
        vb = b[field] ?? (isAsc ? Infinity : -Infinity);
      }
      let cmp;
      if (strFields.has(field)) {
        cmp = String(va).localeCompare(String(vb));
      } else {
        cmp = va - vb;
      }
      return isAsc ? cmp : -cmp;
    });
  }

  S.lof.filtered = d;
  renderLof();
  updateSortIndicators('lofTableHead', S.lof.sort);
}

function renderLof() {
  const tbody = document.getElementById('lofTableBody');
  const d = S.lof.filtered;
  const activeCols = S.activeCols.lof;
  const colCount = 8 + activeCols.size;

  updateTableHead('lof');

  if (!d.length) { tbody.innerHTML = emptyRow(colCount, '暂无数据', '没有找到匹配的LOF基金'); return; }

  tbody.innerHTML = d.map((f, i) => {
    const chgCls = f.change > 0 ? 'positive' : f.change < 0 ? 'negative' : 'zero';
    const pCls = (f.premium || 0) > 0 ? 'premium-positive' : 'premium-negative';
    
    // 净值日期处理
    let navHtml;
    if (f.nav != null) {
      const navStr = fmt(f.nav);
      if (f.navIsLatest === false) {
        navHtml = `<span class="nav-stale" title="净值日期: ${f.navDate || '未知'}">${navStr}</span><span class="warn-icon" title="非最新净值(${f.navDate || '未知'})">!</span>`;
      } else {
        navHtml = navStr;
      }
    } else {
      navHtml = '--';
    }

    // 收益率列
    const yld = S.yield[f.code] || {};
    let yieldCells = '';
    YIELD_COLS.forEach(col => {
      if (!activeCols.has(col.key)) return;
      const v = yld[col.key];
      const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
      yieldCells += `<td class="cell-yield ${v != null ? cls : ''}">${v != null ? fmtPct(v) : '--'}</td>`;
    });
    
    let statusBadge, limitHtml;
    if (f.purchasable === true) {
      if (f.purchaseStatus === '限大额') {
        statusBadge = badge('限额', 'limited');
        limitHtml = f.purchaseLimit ? `<span class="limit-amount">${fmtMoney(f.purchaseLimit)}</span>` : '<span class="limit-amount" style="color:var(--text-muted)">限大额</span>';
      } else {
        statusBadge = badge('是', 'yes');
        limitHtml = '<span class="limit-unlimited">无限额</span>';
      }
    } else if (f.purchasable === false) {
      statusBadge = badge('否', 'no');
      limitHtml = '<span style="color:var(--red-soft)">暂停申购</span>';
    } else {
      statusBadge = '<span class="status-badge" style="color:var(--text-muted);border-color:var(--border-primary)">未知</span>';
      limitHtml = '<span class="limit-unlimited">--</span>';
    }
    return `<tr>
      <td class="cell-index">${i + 1}</td>
      <td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${f.code}.html','_blank')">${f.code}</td>
      <td class="cell-name" title="${f.name}">${f.name}</td>
      <td class="cell-price ${chgCls}">${f.price != null ? fmt(f.price) : '--'}</td>
      <td class="cell-nav">${navHtml}</td>
      <td class="cell-premium ${pCls}">${f.premium != null ? fmtPct(f.premium) : '--'}</td>
      ${yieldCells}
      <td class="cell-status">${statusBadge}</td>
      <td class="cell-limit">${limitHtml}</td>
    </tr>`;
  }).join('');
}

function updateLofStats() {
  const d = S.lof.raw;
  setText('statTotal', d.length);
  setText('statPremium', d.filter(f => f.premium > 0).length);
  setText('statDiscount', d.filter(f => f.premium !== null && f.premium < 0).length);
  setText('statOpen', d.filter(f => f.purchasable === true).length);
  if (S.lastUpdate) {
    const t = S.lastUpdate;
    setText('statTime', `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`);
  }
}

// ==================== QDII ====================
async function loadQdii(forceRefresh = false) {
  if (S.qdii.loading) return;
  S.qdii.loading = true;
  showLoading('qdii', true);
  setRefreshBtnState(true);

  try {
    const url = `/api/qdii/full?_=${Date.now()}${forceRefresh ? '&refresh=1' : ''}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json.success || !json.data?.length) throw new Error(json.error || 'QDII数据为空');

    S.qdii.raw = json.data;

    applyQdiiFilters();
    updateQdiiStats();
    showLoading('qdii', false);
    updateCacheHint('qdii', json.cached, json.fetchDateLocal);

  } catch (err) {
    console.error('QDII加载失败:', err);
    document.getElementById('qdiiLoading').innerHTML = errorHtml(err.message);
  } finally {
    S.qdii.loading = false;
    setRefreshBtnState(false);
  }
}

function applyQdiiFilters() {
  let d = [...S.qdii.raw];
  if (S.qdii.search) {
    const q = S.qdii.search.toLowerCase();
    d = d.filter(f => f.code.includes(q) || (f.name && f.name.toLowerCase().includes(q)));
  }
  // 申购状态筛选
  if (S.qdii.filter === 'open') d = d.filter(f => f.purchasable === true && f.purchaseStatus !== '限大额');
  else if (S.qdii.filter === 'limited') d = d.filter(f => f.purchaseStatus === '限大额');
  else if (S.qdii.filter === 'closed') d = d.filter(f => f.purchasable === false);
  // 指数筛选：纳斯达克
  else if (S.qdii.filter === 'nasdaq') d = d.filter(f => {
    const n = (f.name || '').toLowerCase();
    return n.includes('纳斯达克') || n.includes('纳指') || n.includes('nasdaq') || n.includes('纳100') || n.includes('纳斯');
  });
  // 指数筛选：标普
  else if (S.qdii.filter === 'sp500') d = d.filter(f => {
    const n = (f.name || '').toLowerCase();
    return n.includes('标普');
  });

  // 通用排序
  const sortKey = S.qdii.sort || 'purchaseLimit_desc';
  const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
  const isAsc = dir === 'asc';
  const strFields = new Set(['code', 'name', 'navDate']);
  const yieldFields = new Set(['ytd', 'month1', 'month3', 'month6', 'year1']);

  d.sort((a, b) => {
    let va, vb;
    if (yieldFields.has(field)) {
      va = (S.yield[a.code] || {})[field] ?? (isAsc ? Infinity : -Infinity);
      vb = (S.yield[b.code] || {})[field] ?? (isAsc ? Infinity : -Infinity);
    } else {
      va = a[field] ?? (isAsc ? Infinity : -Infinity);
      vb = b[field] ?? (isAsc ? Infinity : -Infinity);
    }
    let cmp;
    if (strFields.has(field)) {
      cmp = String(va).localeCompare(String(vb));
    } else {
      cmp = va - vb;
    }
    return isAsc ? cmp : -cmp;
  });

  S.qdii.filtered = d;
  renderQdii();
  updateSortIndicators('qdiiTableHead', S.qdii.sort);
}

function renderQdii() {
  const tbody = document.getElementById('qdiiTableBody');
  const d = S.qdii.filtered;
  const activeCols = S.activeCols.qdii;
  const colCount = 8 + activeCols.size;

  updateTableHead('qdii');

  if (!d.length) { tbody.innerHTML = emptyRow(colCount, '暂无数据', '没有找到匹配的QDII基金'); return; }

  tbody.innerHTML = d.map((f, i) => {
    const chgCls = (f.dailyChange || 0) > 0 ? 'positive' : (f.dailyChange || 0) < 0 ? 'negative' : 'zero';
    
    // 净值 + 日期处理
    let navHtml, navDateHtml;
    if (f.nav != null) {
      const navStr = fmt(f.nav);
      if (f.navIsLatest === false) {
        navHtml = `<span class="nav-stale">${navStr}</span><span class="warn-icon" title="非最新净值(${f.navDate || '未知'})">!</span>`;
        navDateHtml = `<span class="nav-date-warn">${fmtNavDate(f.navDate)}<span class="warn-icon">!</span></span>`;
      } else {
        navHtml = navStr;
        navDateHtml = fmtNavDate(f.navDate);
      }
    } else {
      navHtml = '--';
      navDateHtml = '--';
    }

    // 收益率列
    const yld = S.yield[f.code] || {};
    let yieldCells = '';
    YIELD_COLS.forEach(col => {
      if (!activeCols.has(col.key)) return;
      const v = yld[col.key];
      const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
      yieldCells += `<td class="cell-yield ${v != null ? cls : ''}">${v != null ? fmtPct(v) : '--'}</td>`;
    });
    
    let statusHtml, limitHtml;
    if (f.purchasable === false) {
      statusHtml = badge('暂停', 'no');
      limitHtml = '<span class="qdii-limit-closed">暂停申购</span>';
    } else if (f.purchaseStatus === '限大额') {
      statusHtml = badge('限额', 'limited');
      limitHtml = f.purchaseLimit ? `<span class="qdii-limit-amount">${fmtMoney(f.purchaseLimit)}</span>` : '<span class="qdii-limit-amount" style="color:var(--text-muted)">限大额</span>';
    } else if (f.purchasable === true) {
      statusHtml = badge('开放', 'yes');
      limitHtml = '<span class="qdii-limit-open">无限额</span>';
    } else {
      statusHtml = '<span class="status-badge" style="color:var(--text-muted);border-color:var(--border-primary)">未知</span>';
      limitHtml = '<span style="color:var(--text-muted)">--</span>';
    }
    return `<tr>
      <td class="cell-index">${i + 1}</td>
      <td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${f.code}.html','_blank')">${f.code}</td>
      <td class="cell-name" title="${f.name}">${f.name}</td>
      <td class="cell-nav">${navHtml}</td>
      <td class="cell-nav-date">${navDateHtml}</td>
      <td class="cell-change ${chgCls}">${f.dailyChange != null ? fmtPct(f.dailyChange) : '--'}</td>
      ${yieldCells}
      <td class="cell-status">${statusHtml}</td>
      <td class="cell-limit">${limitHtml}</td>
    </tr>`;
  }).join('');
}

function updateQdiiStats() {
  const d = S.qdii.raw;
  setText('qdiiStatTotal', d.length);
  setText('qdiiStatOpen', d.filter(f => f.purchasable === true && f.purchaseStatus !== '限大额').length);
  setText('qdiiStatLimited', d.filter(f => f.purchaseStatus === '限大额').length);
  setText('qdiiStatClosed', d.filter(f => f.purchasable === false).length);
  const t = new Date();
  setText('qdiiStatTime', `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`);
}

// ==================== DOM helpers ====================
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
const pad = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const badge = (text, type) => `<span class="status-badge status-${type}">${text}</span>`;
const emptyRow = (cols, icon, msg) => `<tr><td colspan="${cols}"><div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-text">${msg}</div></div></td></tr>`;
const errorHtml = msg => `<div class="error-banner"><span class="error-icon">⚠</span>数据加载失败: ${msg}，请稍后重试</div>`;

function showLoading(page, show) {
  const idMap = {
    lof: { loading: 'lofLoading', table: 'lofTableContainer', hint: 'lofCacheHint' },
    qdii: { loading: 'qdiiLoading', table: 'qdiiTableContainer', hint: 'qdiiCacheHint' },
    enhance: { loading: 'enhanceLoading', table: 'enhanceTableContainer', hint: 'enhanceCacheHint' },
    futures: { loading: 'futuresLoading', table: 'futuresTableContainer', hint: 'futuresCacheHint' },
  };
  const ids = idMap[page];
  if (!ids) return;
  if (ids.loading) document.getElementById(ids.loading).style.display = show ? 'flex' : 'none';
  if (ids.table) document.getElementById(ids.table).style.display = show ? 'none' : 'block';
  if (ids.hint) {
    const hintEl = document.getElementById(ids.hint);
    if (hintEl) hintEl.style.display = show ? 'none' : 'flex';
  }
}

function setRefreshBtnState(loading) {
  const btn = document.getElementById('refreshBtn');
  if (loading) {
    btn.classList.add('spinning');
    btn.disabled = true;
  } else {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function updateCacheHint(page, cached, fetchDateLocal) {
  const hintMap = { lof: 'lofCacheHint', qdii: 'qdiiCacheHint', enhance: 'enhanceCacheHint' };
  const el = document.getElementById(hintMap[page]);
  if (!el) return;

  if (cached) {
    el.innerHTML = `<span class="cache-dot cached"></span>缓存数据 · 获取于 ${fetchDateLocal || '未知'} · 点击「刷新」获取最新数据`;
    el.className = 'cache-hint cached';
  } else {
    el.innerHTML = `<span class="cache-dot fresh"></span>最新数据 · 获取于 ${fetchDateLocal || '未知'}`;
    el.className = 'cache-hint fresh';
  }
  el.style.display = 'flex';
}

// ==================== Events ====================
function initEvents() {
  // LOF
  document.getElementById('searchLof').addEventListener('input', debounce(e => { S.lof.search = e.target.value; applyLofFilters(); }));
  document.getElementById('sortLof').addEventListener('change', e => { S.lof.sort = e.target.value; applyLofFilters(); });
  // LOF 表头点击排序（含动态收益率列，需事件委托）
  document.getElementById('lofTableHead').addEventListener('click', e => {
    const th = e.target.closest('.th-sortable');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (!key) return;
    handleHeaderSortClick('lof', key, 'sortLof');
  });
  document.querySelectorAll('.filter-btn:not([data-page="qdii"])').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn:not([data-page="qdii"])').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.lof.filter = btn.dataset.filter;
      applyLofFilters();
    });
  });
  // QDII
  document.getElementById('searchQdii').addEventListener('input', debounce(e => { S.qdii.search = e.target.value; applyQdiiFilters(); }));
  document.getElementById('sortQdii').addEventListener('change', e => { S.qdii.sort = e.target.value; applyQdiiFilters(); });
  // QDII 表头点击排序（含动态收益率列，需事件委托）
  document.getElementById('qdiiTableHead').addEventListener('click', e => {
    const th = e.target.closest('.th-sortable');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (!key) return;
    handleHeaderSortClick('qdii', key, 'sortQdii');
  });
  document.querySelectorAll('.filter-btn[data-page="qdii"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-page="qdii"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.qdii.filter = btn.dataset.filter;
      applyQdiiFilters();
    });
  });
  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', () => {
    if (S.page === 'lof') { S.lof.raw = []; loadLof(true); loadYieldData(true); }
    else if (S.page === 'qdii') { S.qdii.raw = []; loadQdii(true); loadYieldData(true); }
    else if (S.page === 'enhance') { S.enhance.groups = []; loadEnhance(true); }
    else if (S.page === 'futures') { S.futures.raw = []; loadFutures(true); }
  });

  // ===== 列选择器（LOF + QDII + Enhance）=====
  initColumnSelector('lof', 'lofColumnSelector');
  initColumnSelector('qdii', 'qdiiColumnSelector');
  initEnhanceColumnSelector();

  // ===== 导出按钮 =====
  document.getElementById('exportLofBtn').addEventListener('click', () => exportToExcel('lof'));
  document.getElementById('exportQdiiBtn').addEventListener('click', () => exportToExcel('qdii'));
  document.getElementById('exportEnhanceBtn').addEventListener('click', () => exportToExcel('enhance'));

  // ===== 增强基金页面事件 =====
  document.getElementById('searchEnhance').addEventListener('input', debounce(e => { S.enhance.search = e.target.value; applyEnhanceFilters(); }));
  document.getElementById('sortEnhance').addEventListener('change', e => { S.enhance.sort = e.target.value; applyEnhanceFilters(); });
  // 增强基金表头点击排序（含动态收益率列，需事件委托）
  document.getElementById('enhanceTableHead').addEventListener('click', e => {
    const th = e.target.closest('.th-sortable');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (!key) return;
    handleHeaderSortClick('enhance', key, 'sortEnhance');
  });

  // 视图切换
  document.getElementById('viewGroupBtn').addEventListener('click', () => {
    S.enhance.view = 'group';
    document.getElementById('viewGroupBtn').classList.add('active');
    document.getElementById('viewFlatBtn').classList.remove('active');
    applyEnhanceFilters();
  });
  document.getElementById('viewFlatBtn').addEventListener('click', () => {
    S.enhance.view = 'flat';
    document.getElementById('viewFlatBtn').classList.add('active');
    document.getElementById('viewGroupBtn').classList.remove('active');
    applyEnhanceFilters();
  });

  // ===== 收益率对比模式事件 =====
  document.getElementById('compareToggleBtn').addEventListener('click', toggleCompareMode);
  document.getElementById('compareClearBtn').addEventListener('click', () => { S.compare.selected = []; updateCompareBar(); renderEnhance(); });
  document.getElementById('compareDrawBtn').addEventListener('click', openCompareModal);
  document.getElementById('compareCloseBtn').addEventListener('click', () => toggleCompareMode());
  document.getElementById('compareModalClose').addEventListener('click', closeCompareModal);
  document.getElementById('compareModalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeCompareModal(); });
  document.querySelectorAll('#comparePeriodBtns .col-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#comparePeriodBtns .col-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.compare.period = btn.dataset.period;
      if (S.compare.selected.length > 0) fetchAndDrawCompare();
    });
  });
}

function initColumnSelector(page, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.col-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const col = btn.dataset.col;
      const set = S.activeCols[page];

      // 如果收益率数据还没加载，先加载
      if (!S.yieldLoaded) {
        btn.textContent = '加载中...';
        await loadYieldData();
        btn.textContent = YIELD_COLS.find(c => c.key === col)?.label || col;
      }

      // 切换选中状态
      if (set.has(col)) {
        set.delete(col);
        btn.classList.remove('active');
      } else {
        set.add(col);
        btn.classList.add('active');
      }

      // 重新渲染表格
      if (page === 'lof') renderLof();
      else renderQdii();
    });
  });
}

function initEnhanceColumnSelector() {
  const container = document.getElementById('enhanceColumnSelector');
  if (!container) return;
  container.querySelectorAll('.col-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.col;
      const set = S.activeCols.enhance;
      if (set.has(col)) {
        set.delete(col);
        btn.classList.remove('active');
      } else {
        set.add(col);
        btn.classList.add('active');
      }
      updateEnhanceTableHead();
      renderEnhance();
    });
  });
}

function updateEnhanceTableHead() {
  const headRow = document.getElementById('enhanceTableHead');
  if (!headRow) return;
  // 移除旧的动态收益率列
  headRow.querySelectorAll('.th-yield-dynamic').forEach(th => th.remove());
  const activeCols = S.activeCols.enhance;
  if (activeCols.size === 0) return;
  // 在备注列前面插入
  const insertBefore = headRow.querySelector('.th-enhance-note');
  YIELD_COLS.forEach(col => {
    if (!activeCols.has(col.key)) return;
    const th = document.createElement('th');
    th.className = 'th-yield th-yield-dynamic th-sortable';
    th.dataset.sortKey = col.key;
    th.textContent = col.label;
    headRow.insertBefore(th, insertBefore);
  });
}

// ==================== 增强基金 ====================
async function loadEnhance(forceRefresh = false) {
  if (S.enhance.loading) return;
  S.enhance.loading = true;
  showLoading('enhance', true);
  setRefreshBtnState(true);

  try {
    const url = `/api/enhance?_=${Date.now()}${forceRefresh ? '&refresh=1' : ''}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json.success || !json.groups) throw new Error(json.error || '增强基金数据为空');

    S.enhance.groups = json.groups;

    // 构建平铺列表
    S.enhance.flatList = [];
    json.groups.forEach(g => {
      g.funds.forEach(f => {
        S.enhance.flatList.push({ ...f, groupId: g.id, groupName: g.name, trackIndex: g.trackIndex });
      });
    });

    // 动态创建分组筛选按钮
    buildEnhanceGroupFilter(json.groups);

    updateEnhanceTableHead();
    applyEnhanceFilters();
    updateEnhanceStats();
    showLoading('enhance', false);
    updateCacheHint('enhance', json.cached, json.yieldDate);

  } catch (err) {
    console.error('增强基金加载失败:', err);
    document.getElementById('enhanceLoading').innerHTML = errorHtml(err.message);
  } finally {
    S.enhance.loading = false;
    setRefreshBtnState(false);
  }
}

function buildEnhanceGroupFilter(groups) {
  const container = document.getElementById('enhanceGroupFilter');
  if (!container) return;
  const allBtn = container.querySelector('[data-filter="all"]');
  container.innerHTML = '';
  container.appendChild(allBtn);

  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn filter-index';
    btn.dataset.filter = g.id;
    btn.dataset.page = 'enhance';
    btn.textContent = g.name;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.enhance.filter = g.id;
      applyEnhanceFilters();
    });
    container.appendChild(btn);
  });

  allBtn.addEventListener('click', () => {
    container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    S.enhance.filter = 'all';
    applyEnhanceFilters();
  });
}

function applyEnhanceFilters() {
  let d = [...S.enhance.flatList];

  if (S.enhance.search) {
    const q = S.enhance.search.toLowerCase();
    d = d.filter(f => f.code.includes(q) || (f.name && f.name.toLowerCase().includes(q)));
  }

  if (S.enhance.filter !== 'all') {
    d = d.filter(f => f.groupId === S.enhance.filter);
  }

  // 通用排序函数
  const enhanceSortFn = () => {
    const sortKey = S.enhance.sort || 'ytd_desc';
    const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
    const isAsc = dir === 'asc';
    const strFields = new Set(['code', 'name']);

    return (a, b) => {
      const va = a[field] ?? (isAsc ? Infinity : -Infinity);
      const vb = b[field] ?? (isAsc ? Infinity : -Infinity);
      let cmp;
      if (strFields.has(field)) {
        cmp = String(va).localeCompare(String(vb));
      } else {
        cmp = va - vb;
      }
      return isAsc ? cmp : -cmp;
    };
  };

  if (S.enhance.view === 'flat' || S.enhance.filter !== 'all') {
    d.sort(enhanceSortFn());
  }

  S.enhance.filtered = d;
  renderEnhance();
  updateSortIndicators('enhanceTableHead', S.enhance.sort);
}

function renderEnhance() {
  const tbody = document.getElementById('enhanceTableBody');
  const d = S.enhance.filtered;
  const activeCols = S.activeCols.enhance;
  const compareActive = S.compare.active;
  const colCount = (compareActive ? 1 : 0) + 5 + activeCols.size + 1; // [check], #, code, name, nav, change, [dynamic cols], note

  // 同步表头勾选列的显隐
  const checkHeader = document.querySelector('.th-compare-check');
  if (checkHeader) checkHeader.style.display = compareActive ? '' : 'none';

  if (!d.length) {
    tbody.innerHTML = emptyRow(colCount, '暂无数据', '没有找到匹配的增强基金');
    return;
  }

  // 分组视图
  if (S.enhance.view === 'group' && S.enhance.filter === 'all') {
    let html = '';
    let idx = 0;
    const groupMap = {};
    d.forEach(f => {
      if (!groupMap[f.groupId]) groupMap[f.groupId] = [];
      groupMap[f.groupId].push(f);
    });

    const sortFn = () => {
      const sortKey = S.enhance.sort || 'ytd_desc';
      const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
      const isAsc = dir === 'asc';
      const strFields = new Set(['code', 'name']);
      return (a, b) => {
        const va = a[field] ?? (isAsc ? Infinity : -Infinity);
        const vb = b[field] ?? (isAsc ? Infinity : -Infinity);
        let cmp;
        if (strFields.has(field)) {
          cmp = String(va).localeCompare(String(vb));
        } else {
          cmp = va - vb;
        }
        return isAsc ? cmp : -cmp;
      };
    };

    for (const group of S.enhance.groups) {
      const funds = groupMap[group.id];
      if (!funds || funds.length === 0) continue;

      funds.sort(sortFn());

      // 分组标题行
      html += `<tr class="enhance-group-header">
        <td colspan="${colCount}">
          <span class="group-badge">${group.name}</span>
          <span class="group-index">跟踪: ${group.trackIndex}</span>
          <span class="group-count">${funds.length} 只基金</span>
        </td>
      </tr>`;

      // 跟踪指数基金行（第一行）
      if (group.trackFund) {
        html += enhanceTrackRow(group.trackFund, activeCols);
      }

      // 基金行
      funds.forEach(f => {
        idx++;
        html += enhanceFundRow(f, idx, activeCols);
      });
    }
    tbody.innerHTML = html;
  } else {
    // 平铺视图
    tbody.innerHTML = d.map((f, i) => enhanceFundRow(f, i + 1, activeCols)).join('');
  }
}

function enhanceTrackRow(tf, activeCols) {
  const chgCls = (tf.dailyChange || 0) > 0 ? 'positive' : (tf.dailyChange || 0) < 0 ? 'negative' : 'zero';
  let yieldCells = '';
  YIELD_COLS.forEach(col => {
    if (!activeCols.has(col.key)) return;
    const v = tf[col.key];
    const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
    yieldCells += `<td class="cell-yield ${v != null ? cls : ''}">${v != null ? fmtPct(v) : '--'}</td>`;
  });

  // 对比模式勾选列
  let checkCell = '';
  if (S.compare.active) {
    const isSelected = S.compare.selected.some(f => f.code === tf.code);
    const maxReached = S.compare.selected.length >= 5 && !isSelected;
    const cls = `compare-checkbox${isSelected ? ' checked' : ''}${maxReached ? ' disabled' : ''}`;
    checkCell = `<td class="cell-compare-check"><span class="${cls}" data-code="${tf.code}" onclick="toggleCompareSelect('${tf.code}')">${isSelected ? '✓' : ''}</span></td>`;
  }

  return `<tr class="enhance-track-row">
    ${checkCell}
    <td class="cell-index"><span class="track-label">指数</span></td>
    <td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${tf.code}.html','_blank')">${tf.code}</td>
    <td class="cell-name" title="${tf.name}">${tf.name}</td>
    <td class="cell-nav">${tf.nav != null ? fmt(tf.nav) : '--'}</td>
    <td class="cell-change ${chgCls}">${tf.dailyChange != null ? fmtPct(tf.dailyChange) : '--'}</td>
    ${yieldCells}
    <td class="cell-enhance-note">被动指数基金</td>
  </tr>`;
}

function enhanceFundRow(f, idx, activeCols) {
  const chgCls = (f.dailyChange || 0) > 0 ? 'positive' : (f.dailyChange || 0) < 0 ? 'negative' : 'zero';

  let yieldCells = '';
  YIELD_COLS.forEach(col => {
    if (!activeCols.has(col.key)) return;
    const v = f[col.key];
    const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
    yieldCells += `<td class="cell-yield ${v != null ? cls : ''}">${v != null ? fmtPct(v) : '--'}</td>`;
  });

  // 对比模式勾选列
  let checkCell = '';
  if (S.compare.active) {
    const isSelected = S.compare.selected.some(s => s.code === f.code);
    const maxReached = S.compare.selected.length >= 5 && !isSelected;
    const cls = `compare-checkbox${isSelected ? ' checked' : ''}${maxReached ? ' disabled' : ''}`;
    checkCell = `<td class="cell-compare-check"><span class="${cls}" data-code="${f.code}" onclick="toggleCompareSelect('${f.code}')">${isSelected ? '✓' : ''}</span></td>`;
  }

  return `<tr>
    ${checkCell}
    <td class="cell-index">${idx}</td>
    <td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${f.code}.html','_blank')">${f.code}</td>
    <td class="cell-name" title="${f.name}">${f.name}</td>
    <td class="cell-nav">${f.nav != null ? fmt(f.nav) : '--'}</td>
    <td class="cell-change ${chgCls}">${f.dailyChange != null ? fmtPct(f.dailyChange) : '--'}</td>
    ${yieldCells}
    <td class="cell-enhance-note" title="${f.note || ''}">${f.note || ''}</td>
  </tr>`;
}

function updateEnhanceStats() {
  const d = S.enhance.flatList;
  setText('enhanceStatTotal', d.length);
  setText('enhanceStatUp', d.filter(f => (f.dailyChange || 0) > 0).length);
  setText('enhanceStatDown', d.filter(f => (f.dailyChange || 0) < 0).length);
  setText('enhanceStatGroups', S.enhance.groups.length);
  if (d.length > 0 && d[0].yieldDate) {
    setText('enhanceStatTime', fmtNavDate(d[0].yieldDate));
  }
}

// ==================== 收益率对比（弹窗模式） ====================
const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7'];

function toggleCompareMode() {
  S.compare.active = !S.compare.active;
  const btn = document.getElementById('compareToggleBtn');
  const bar = document.getElementById('enhanceCompareBar');
  const checkHeader = document.querySelector('.th-compare-check');

  if (S.compare.active) {
    btn.classList.add('active');
    bar.style.display = 'flex';
    if (checkHeader) checkHeader.style.display = '';
  } else {
    btn.classList.remove('active');
    bar.style.display = 'none';
    if (checkHeader) checkHeader.style.display = 'none';
    S.compare.selected = [];
    updateCompareBar();
  }
  renderEnhance(); // 重新渲染以添加/移除勾选列
}

function toggleCompareSelect(code) {
  const idx = S.compare.selected.findIndex(f => f.code === code);
  if (idx >= 0) {
    S.compare.selected.splice(idx, 1);
  } else if (S.compare.selected.length < 5) {
    // 从 flatList 或 trackFund 中查找
    let fundData = S.enhance.flatList.find(f => f.code === code);
    if (!fundData) {
      for (const g of S.enhance.groups) {
        if (g.trackFund && g.trackFund.code === code) {
          fundData = { ...g.trackFund, groupName: g.name, isTrack: true };
          break;
        }
      }
    }
    if (fundData) S.compare.selected.push(fundData);
  }
  updateCompareBar();
  renderEnhance();
}

function updateCompareBar() {
  const chipsEl = document.getElementById('compareBarChips');
  const drawBtn = document.getElementById('compareDrawBtn');

  if (S.compare.selected.length === 0) {
    chipsEl.innerHTML = '<span class="compare-hint">请在下方列表中勾选基金（最多5只）</span>';
    drawBtn.disabled = true;
  } else {
    chipsEl.innerHTML = S.compare.selected.map((f, i) =>
      `<span class="compare-chip" style="border-color:${CHART_COLORS[i]}33;background:${CHART_COLORS[i]}0d;color:${CHART_COLORS[i]}">
        <span>${f.code}</span>
        <span>${(f.name || '').length > 8 ? f.name.slice(0, 8) + '…' : f.name}</span>
        <span class="compare-chip-remove" data-code="${f.code}">✕</span>
      </span>`
    ).join('');
    drawBtn.disabled = false;

    // 绑定移除
    chipsEl.querySelectorAll('.compare-chip-remove').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        toggleCompareSelect(el.dataset.code);
      });
    });
  }
}

function openCompareModal() {
  if (S.compare.selected.length === 0) return;
  document.getElementById('compareModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  fetchAndDrawCompare();
}

function closeCompareModal() {
  document.getElementById('compareModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  if (S.compare.chart) {
    S.compare.chart.destroy();
    S.compare.chart = null;
  }
}

async function fetchAndDrawCompare() {
  const codes = S.compare.selected.map(f => f.code);
  const period = S.compare.period;

  // 显示加载状态
  document.getElementById('compareLoading').style.display = 'flex';
  document.getElementById('compareChartWrap').style.opacity = '0.3';

  try {
    const url = `/api/fund/history?codes=${codes.join(',')}&period=${period}&_=${Date.now()}`;
    const resp = await fetch(url);
    const json = await resp.json();

    if (!json.success) throw new Error(json.error || '获取历史数据失败');

    drawTrendChart(json.series, json.period);
    renderCompareSummaryTable(json.series);
  } catch (err) {
    console.error('对比数据获取失败:', err);
    document.getElementById('compareChartWrap').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">数据加载失败: ${err.message}</div>`;
  } finally {
    document.getElementById('compareLoading').style.display = 'none';
    document.getElementById('compareChartWrap').style.opacity = '1';
  }
}

function drawTrendChart(seriesMap, period) {
  const periodLabel = { month1: '近1月', month3: '近3月', month6: '近半年', year1: '近1年', ytd: '今年来', year3: '近3年' }[period] || period;

  if (S.compare.chart) S.compare.chart.destroy();

  // 收集所有日期（X轴）
  const allDates = new Set();
  for (const code in seriesMap) {
    seriesMap[code].forEach(p => allDates.add(p.date));
  }
  const dates = [...allDates].sort();

  // 构建 datasets
  const datasets = S.compare.selected.map((fund, i) => {
    const series = seriesMap[fund.code] || [];
    const dataMap = {};
    series.forEach(p => { dataMap[p.date] = p.returnRate; });

    return {
      label: fund.name.length > 12 ? fund.name.slice(0, 12) + '…' : fund.name,
      data: dates.map(d => dataMap[d] ?? null),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      tension: 0.3,
      fill: false,
      spanGaps: true,
    };
  });

  // 格式化日期标签
  const labels = dates.map(d => {
    const parts = d.split('-');
    return `${parts[1]}-${parts[2]}`;
  });

  const canvas = document.getElementById('compareChart');
  // 重新创建canvas（防止Chart.js残留问题）
  const parent = canvas.parentNode;
  parent.innerHTML = '<canvas id="compareChart"></canvas>';
  const newCanvas = document.getElementById('compareChart');
  const ctx = newCanvas.getContext('2d');

  S.compare.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
            font: { family: "'Noto Sans SC', sans-serif", size: 12 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleFont: { family: "'Noto Sans SC', sans-serif", size: 12 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: ctx => ctx[0]?.label || '',
            label: ctx => {
              const v = ctx.raw;
              if (v == null) return '';
              return ` ${ctx.dataset.label}: ${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
            }
          }
        },
        title: {
          display: true,
          text: `${periodLabel}累计收益率趋势`,
          font: { family: "'Noto Sans SC', sans-serif", size: 14, weight: '600' },
          padding: { bottom: 16 },
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => (v > 0 ? '+' : '') + v.toFixed(1) + '%',
            font: { family: "'JetBrains Mono', monospace", size: 11 },
          },
          grid: { color: 'rgba(148,163,184,0.1)' },
        },
        x: {
          ticks: {
            maxTicksLimit: 12,
            font: { family: "'JetBrains Mono', monospace", size: 10 },
          },
          grid: { display: false },
        }
      }
    }
  });
}

function renderCompareSummaryTable(seriesMap) {
  const tbody = document.getElementById('compareTableBody');
  tbody.innerHTML = S.compare.selected.map((f, i) => {
    const series = seriesMap[f.code] || [];
    const returnRate = series.length > 0 ? series[series.length - 1].returnRate : null;
    const chgCls = (f.dailyChange || 0) > 0 ? 'positive' : (f.dailyChange || 0) < 0 ? 'negative' : 'zero';
    const retCls = returnRate != null ? (returnRate > 0 ? 'positive' : returnRate < 0 ? 'negative' : 'zero') : '';
    return `<tr>
      <td><span class="compare-color-dot" style="background:${CHART_COLORS[i]}"></span></td>
      <td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${f.code}.html','_blank')">${f.code}</td>
      <td class="cell-name">${f.name}</td>
      <td class="cell-nav">${f.nav != null ? fmt(f.nav) : '--'}</td>
      <td class="cell-change ${chgCls}">${f.dailyChange != null ? fmtPct(f.dailyChange) : '--'}</td>
      <td class="cell-yield ${retCls}">${returnRate != null ? fmtPct(returnRate) : '--'}</td>
    </tr>`;
  }).join('');
}

// ==================== 期货贴水监控 ====================

const RISK_LEVEL_MAP = {
  low:     { label: '低风险', cls: 'risk-low',     icon: '●' },
  medium:  { label: '中风险', cls: 'risk-medium',   icon: '▲' },
  high:    { label: '高风险', cls: 'risk-high',     icon: '◆' },
  extreme: { label: '极高',   cls: 'risk-extreme',  icon: '⬤' },
  unknown: { label: '--',     cls: 'risk-unknown',  icon: '○' },
};

async function loadFutures(forceRefresh = false) {
  if (S.futures.loading) return;
  S.futures.loading = true;
  showLoading('futures', true);
  setRefreshBtnState(true);

  try {
    const url = `/api/futures/discount?_=${Date.now()}${forceRefresh ? '&refresh=1' : ''}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json.success || !json.data) throw new Error(json.error || '期货数据为空');

    // 展平数据：每个合约一行，附上品种信息
    const flat = [];
    json.data.forEach(group => {
      group.contracts.forEach(c => {
        flat.push({
          ...c,
          varietyName: group.name,
          indexName: group.indexName,
          indexPrice: group.indexPrice,
          indexChange: group.indexChange,
          multiplier: group.multiplier,
          marginRatio: group.marginRatio,
        });
      });
    });

    S.futures.raw = flat;
    applyFuturesFilters();
    updateFuturesStats(flat);
    showLoading('futures', false);
    updateCacheHint('futures', json.cached, json.fetchDateLocal);

    // 显示知识引导（仅非缓存时）
    const guide = document.getElementById('futuresGuide');
    if (guide) guide.style.display = '';

  } catch (err) {
    console.error('期货数据加载失败:', err);
    document.getElementById('futuresLoading').innerHTML = errorHtml(err.message);
  } finally {
    S.futures.loading = false;
    setRefreshBtnState(false);
  }
}

function applyFuturesFilters() {
  let d = [...S.futures.raw];

  // 品种筛选
  if (S.futures.filter !== 'all') {
    d = d.filter(c => c.variety === S.futures.filter);
  }

  // 通用排序: sortKey 格式为 "field_dir"，如 "annualizedReturn_desc"
  const sortKey = S.futures.sort || 'annualizedReturn_desc';
  const [field, dir] = sortKey.split(/_(?=[^_]+$)/); // 最后一个下划线拆分
  const isAsc = dir === 'asc';

  // 字符串字段用 localeCompare
  const strFields = new Set(['expiryDate', 'contractCode']);

  d.sort((a, b) => {
    const va = a[field] ?? (isAsc ? Infinity : -Infinity);
    const vb = b[field] ?? (isAsc ? Infinity : -Infinity);
    let cmp;
    if (strFields.has(field)) {
      cmp = String(va).localeCompare(String(vb));
    } else {
      cmp = va - vb;
    }
    return isAsc ? cmp : -cmp;
  });

  S.futures.filtered = d;
  renderFutures();
  updateFuturesSortIndicators();
}

function renderFutures() {
  const tbody = document.getElementById('futuresTableBody');
  const d = S.futures.filtered;
  const colCount = 13;

  if (!d.length) {
    tbody.innerHTML = emptyRow(colCount, '暂无数据', '没有获取到期货行情数据');
    return;
  }

  tbody.innerHTML = d.map((c, i) => {
    // 贴水/升水颜色
    const discountCls = c.discountRate !== null
      ? (c.discountRate < 0 ? 'futures-discount' : c.discountRate > 0 ? 'futures-premium' : '')
      : '';
    const annCls = c.annualizedReturn !== null
      ? (c.annualizedReturn > 0 ? 'positive' : c.annualizedReturn < 0 ? 'negative' : 'zero')
      : '';

    // 风险标记
    const riskInfo = RISK_LEVEL_MAP[c.risk?.riskLevel] || RISK_LEVEL_MAP.unknown;
    const hasWarnings = c.risk?.warnings?.length > 0;

    // 品种颜色标签
    const varietyColors = { IC: '#3b82f6', IF: '#22c55e', IH: '#f59e0b', IM: '#a855f7' };
    const vColor = varietyColors[c.variety] || '#64748b';

    // 到期日格式化
    const expiryShort = c.expiryDate ? c.expiryDate.slice(5) : '--';

    // 贴水点数显示
    let discountPointsHtml = '--';
    if (c.discountPoints !== null) {
      const sign = c.discountPoints > 0 ? '+' : '';
      discountPointsHtml = `<span class="${discountCls}">${sign}${c.discountPoints.toFixed(1)}</span>`;
    }

    // 贴水率显示
    let discountRateHtml = '--';
    if (c.discountRate !== null) {
      discountRateHtml = `<span class="${discountCls}">${fmtPct(c.discountRate)}</span>`;
    }

    // 年化贴水显示
    let annualizedHtml = '--';
    if (c.annualizedReturn !== null) {
      annualizedHtml = `<span class="cell-yield ${annCls}" style="font-weight:700">${fmtPct(c.annualizedReturn)}</span>`;
    }

    // 已到期合约特殊处理
    const isExpired = c.expired || c.daysToExpiry <= 0;
    const rowCls = isExpired ? 'futures-expired-row' : (c.daysToExpiry <= 3 ? 'futures-expiring-row' : '');
    const expiredTag = isExpired ? '<span class="futures-expired-tag">已到期</span>' : '';

    // 升水/贴水/平水标签
    const statusMap = {
      discount: { label: '贴水', cls: 'futures-status-discount' },
      premium:  { label: '升水', cls: 'futures-status-premium' },
      flat:     { label: '平水', cls: 'futures-status-flat' },
    };
    const st = statusMap[c.discountStatus] || statusMap.flat;
    const statusTag = (!isExpired && c.discountStatus) ? `<span class="futures-status-tag ${st.cls}">${st.label}</span>` : '';

    // OLD 数据过期标识
    const staleTag = c.isStale
      ? `<span class="futures-stale-tag" title="数据日期: ${c.quoteDate || '未知'}${c.staleReason ? ' (' + c.staleReason + ')' : ''}">OLD</span>`
      : '';

    // 期货价格列：过期时使用收盘价，并标注
    const priceDisplay = c.lastPrice ? c.lastPrice.toFixed(1) : '--';

    // 外部行情链接
    const eastmoneyUrl = `https://quote.eastmoney.com/unify/r/220.${c.contractCode}`;
    const sinaUrl = `https://finance.sina.com.cn/futures/quotes/${c.contractCode}.shtml`;

    return `<tr class="${rowCls}">
      <td class="cell-index">${i + 1}</td>
      <td class="cell-futures-code">
        <span class="futures-variety-tag" style="background:${vColor}15;color:${vColor};border-color:${vColor}33">${c.variety}</span>
        <span class="futures-month-link-wrap">
          <span class="futures-month">${c.contractMonth}</span>
          <span class="futures-ext-links">
            <a href="${eastmoneyUrl}" target="_blank" rel="noopener" class="futures-ext-link" title="东方财富 - ${c.contractCode} 行情">东财</a>
            <a href="${sinaUrl}" target="_blank" rel="noopener" class="futures-ext-link" title="新浪财经 - ${c.contractCode} 行情">新浪</a>
          </span>
        </span>
        ${statusTag}
        ${expiredTag}
      </td>
      <td class="cell-name" title="${c.name}">${c.indexName}</td>
      <td class="cell-price">${priceDisplay} ${staleTag}</td>
      <td class="cell-price">${c.indexPrice ? c.indexPrice.toFixed(2) : '--'}</td>
      <td class="cell-discount">${isExpired ? '<span style="opacity:0.4">--</span>' : discountPointsHtml}</td>
      <td class="cell-discount">${isExpired ? '<span style="opacity:0.4">--</span>' : discountRateHtml}</td>
      <td class="cell-annualized">${isExpired ? '<span style="opacity:0.4">--</span>' : annualizedHtml}</td>
      <td class="cell-expiry">${expiryShort}</td>
      <td class="cell-days ${!isExpired && c.daysToExpiry <= 7 ? 'days-warning' : ''}">${isExpired ? '已到期' : c.daysToExpiry + '天'}</td>
      <td class="cell-margin">${isExpired ? '<span style="opacity:0.4">--</span>' : (c.marginPerLot ? fmtMoney(c.marginPerLot) : '--')}</td>
      <td class="cell-profit ${!isExpired && c.profitPerLot > 0 ? 'positive' : !isExpired && c.profitPerLot < 0 ? 'negative' : ''}">${isExpired ? '<span style="opacity:0.4">--</span>' : (c.profitPerLot != null ? (c.profitPerLot > 0 ? '+' : '') + fmtMoney(Math.abs(c.profitPerLot)) : '--')}</td>
      <td class="cell-risk">
        ${isExpired ? '<span class="risk-badge risk-unknown">○ 已到期</span>' : `<span class="risk-badge ${riskInfo.cls}" ${hasWarnings ? `onclick="showFuturesRiskDetail('${c.contractCode}')" style="cursor:pointer"` : ''}>${riskInfo.icon} ${riskInfo.label}</span>`}
      </td>
    </tr>`;
  }).join('');
}

function updateFuturesStats(flat) {
  const activeCts = flat.filter(c => !c.expired && c.daysToExpiry > 0);
  setText('futuresStatContracts', activeCts.length);
  setText('futuresStatDiscount', activeCts.filter(c => c.discountStatus === 'discount').length);
  setText('futuresStatPremium', activeCts.filter(c => c.discountStatus === 'premium').length);

  // 最优年化贴水
  const withReturn = activeCts.filter(c => c.annualizedReturn !== null && c.annualizedReturn > 0 && c.daysToExpiry > 7);
  if (withReturn.length > 0) {
    withReturn.sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    const best = withReturn[0];
    setText('futuresStatBest', `${best.annualizedReturn.toFixed(1)}%`);
    setText('futuresStatBestSub', `${best.contractCode} (${best.daysToExpiry}天)`);
  } else {
    setText('futuresStatBest', '--%');
    setText('futuresStatBestSub', '无贴水合约');
  }

  const t = new Date();
  setText('futuresStatTime', `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`);

  // 全局数据过期提示
  const staleBanner = document.getElementById('futuresStaleNotice');
  if (staleBanner) {
    const staleContracts = activeCts.filter(c => c.isStale);
    if (staleContracts.length > 0) {
      const sample = staleContracts[0];
      const dateStr = sample.quoteDate || '未知';
      const reason = sample.staleReason || '';
      staleBanner.innerHTML = `<span class="stale-notice-icon">◔</span> 当前显示为 <strong>${dateStr}</strong> ${reason ? '(' + reason + ')' : ''} 的收盘数据，非实时行情。交易时段（工作日 9:15-15:00）将自动更新。`;
      staleBanner.style.display = '';
    } else {
      staleBanner.style.display = 'none';
    }
  }
}

function showFuturesRiskDetail(contractCode) {
  const contract = S.futures.raw.find(c => c.contractCode === contractCode);
  if (!contract || !contract.risk) return;

  const overlay = document.getElementById('futuresRiskModalOverlay');
  const title = document.getElementById('futuresRiskModalTitle');
  const body = document.getElementById('futuresRiskModalBody');
  const riskInfo = RISK_LEVEL_MAP[contract.risk.riskLevel] || RISK_LEVEL_MAP.unknown;

  title.textContent = `${contract.contractCode} 风险评估`;

  let html = `
    <div class="risk-detail-header">
      <span class="risk-badge ${riskInfo.cls}" style="font-size:14px;padding:6px 16px;">
        ${riskInfo.icon} ${riskInfo.label}
      </span>
      <div class="risk-detail-meta">
        <span>合约: ${contract.contractCode}</span>
        <span>到期: ${contract.expiryDate} (${contract.daysToExpiry}天)</span>
        <span>年化贴水: ${contract.annualizedReturn != null ? fmtPct(contract.annualizedReturn) : '--'}</span>
      </div>
    </div>
    <div class="risk-detail-warnings">`;

  if (contract.risk.warnings.length === 0) {
    html += '<div class="risk-warning-item risk-ok">✓ 暂未发现明显风险点</div>';
  } else {
    contract.risk.warnings.forEach(w => {
      const iconMap = {
        high_annualized: '🔴', elevated_annualized: '🟡', near_expiry: '🔴',
        expiry_warning: '🟡', premium: '🟠', leverage_reminder: '🔵', low_return: '⚪',
      };
      html += `<div class="risk-warning-item">${iconMap[w.type] || '⚠'} ${w.msg}</div>`;
    });
  }

  html += `</div>
    <div class="risk-detail-tips">
      <h4>💡 操作建议</h4>
      <ul>
        ${contract.daysToExpiry <= 7 ? '<li><strong>临近到期</strong>：建议立即考虑平仓或换仓到远月合约</li>' : ''}
        ${contract.discountRate > 0 ? '<li><strong>升水状态</strong>：滚动持有将产生负收益，不建议此时开仓</li>' : ''}
        ${contract.annualizedReturn > 20 ? '<li><strong>年化偏高</strong>：可能反映市场恐慌，建议观察而非追高</li>' : ''}
        <li>始终确保账户保证金充足（建议至少为最低保证金的 <strong>2倍</strong>）</li>
        <li>新手建议仅用<strong>不超过总资金30%</strong>的保证金参与</li>
      </ul>
    </div>`;

  body.innerHTML = html;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeFuturesRiskModal() {
  document.getElementById('futuresRiskModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

function initFuturesEvents() {
  // 品种筛选
  document.querySelectorAll('.filter-btn[data-page="futures"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-page="futures"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.futures.filter = btn.dataset.filter;
      applyFuturesFilters();
    });
  });

  // 下拉排序
  document.getElementById('sortFutures').addEventListener('change', e => {
    S.futures.sort = e.target.value;
    applyFuturesFilters();
  });

  // 表头点击排序
  document.querySelectorAll('#futuresTableHead .th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (!key) return;
      handleHeaderSortClick('futures', key, 'sortFutures');
    });
  });

  // 外部链接开关
  const extSwitch = document.getElementById('extLinksSwitch');
  if (extSwitch) {
    extSwitch.addEventListener('change', () => {
      const table = document.getElementById('futuresTableBody')?.closest('table');
      if (table) {
        table.classList.toggle('show-ext-links', extSwitch.checked);
      }
    });
  }

  // 风险弹窗关闭
  document.getElementById('futuresRiskModalClose').addEventListener('click', closeFuturesRiskModal);
  document.getElementById('futuresRiskModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFuturesRiskModal();
  });
}

// 更新表头排序指示器（高亮 + 箭头）
function updateFuturesSortIndicators() {
  updateSortIndicators('futuresTableHead', S.futures.sort || 'annualizedReturn_desc');
}

// ==================== 通用表头排序工具函数 ====================

// 通用排序指示器更新：遍历表头 th，当前排序列高亮 + 箭头
function updateSortIndicators(headRowId, sortKey) {
  if (!sortKey) return;
  // abs_premium_desc 等特殊键不拆分
  if (sortKey === 'abs_premium_desc') {
    // 清除所有指示器
    document.querySelectorAll(`#${headRowId} .th-sortable`).forEach(th => {
      th.classList.remove('th-sorted');
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.remove();
    });
    return;
  }
  const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
  document.querySelectorAll(`#${headRowId} .th-sortable`).forEach(th => {
    const key = th.dataset.sortKey;
    const arrow = th.querySelector('.sort-arrow');
    if (key === field) {
      th.classList.add('th-sorted');
      if (arrow) {
        arrow.textContent = dir === 'asc' ? ' ▲' : ' ▼';
      } else {
        const span = document.createElement('span');
        span.className = 'sort-arrow';
        span.textContent = dir === 'asc' ? ' ▲' : ' ▼';
        th.appendChild(span);
      }
    } else {
      th.classList.remove('th-sorted');
      if (arrow) arrow.remove();
    }
  });
}

// 通用表头排序点击处理
function handleHeaderSortClick(page, key, selectId) {
  const stateMap = { lof: S.lof, qdii: S.qdii, enhance: S.enhance, futures: S.futures };
  const state = stateMap[page];
  if (!state) return;

  const current = state.sort || '';
  const [curField, curDir] = current.split(/_(?=[^_]+$)/);
  let newDir;
  if (curField === key) {
    newDir = curDir === 'desc' ? 'asc' : 'desc';
  } else {
    // 代码默认升序，其他默认降序
    const ascDefaults = new Set(['code', 'daysToExpiry', 'expiryDate', 'navDate']);
    newDir = ascDefaults.has(key) ? 'asc' : 'desc';
  }
  state.sort = `${key}_${newDir}`;

  // 同步下拉框
  const sel = document.getElementById(selectId);
  if (sel) {
    const opt = sel.querySelector(`option[value="${state.sort}"]`);
    if (opt) sel.value = state.sort;
  }

  // 触发各页面的 apply 函数
  const applyMap = { lof: applyLofFilters, qdii: applyQdiiFilters, enhance: applyEnhanceFilters, futures: applyFuturesFilters };
  if (applyMap[page]) applyMap[page]();
}

// 全局暴露
window.showFuturesRiskDetail = showFuturesRiskDetail;

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNav();
  initEvents();
  initFuturesEvents();
  updateMarketStatus();
  setInterval(updateMarketStatus, 60000);
  loadLof();
  // 后台预加载收益率数据（不阻塞主流程）
  loadYieldData();
});

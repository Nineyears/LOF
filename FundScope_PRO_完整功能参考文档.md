# FundScope PRO — 完整功能参考文档

> **项目**: LOF溢价监控 & QDII额度追踪 & 增强基金 & 期货贴水  
> **技术栈**: Node.js (Express) + 原生 HTML/CSS/JS + Chart.js  
> **编写日期**: 2026-03-21  
> **用途**: 新项目开发参考指南，覆盖全部展示和交互细节

---

## 目录

1. [项目架构总览](#1-项目架构总览)
2. [全局 UI 框架与导航系统](#2-全局-ui-框架与导航系统)
3. [双主题系统（阳光/深夜模式）](#3-双主题系统阳光深夜模式)
4. [通用交互模式](#4-通用交互模式)
5. [Page 1 — LOF 溢价监控](#5-page-1--lof-溢价监控)
6. [Page 2 — QDII 额度追踪](#6-page-2--qdii-额度追踪)
7. [Page 3 — 增强基金监控](#7-page-3--增强基金监控)
8. [Page 4 — 期货贴水监控](#8-page-4--期货贴水监控)
9. [收益率对比系统（Chart.js 折线图弹窗）](#9-收益率对比系统chartjs-折线图弹窗)
10. [后端 API 设计与数据流](#10-后端-api-设计与数据流)
11. [数据缓存策略](#11-数据缓存策略)
12. [CSV 导出功能](#12-csv-导出功能)
13. [通用排序系统](#13-通用排序系统)
14. [动态收益率列系统](#14-动态收益率列系统)
15. [响应式布局与动画系统](#15-响应式布局与动画系统)
16. [文件结构与依赖清单](#16-文件结构与依赖清单)

---

## 1. 项目架构总览

### 1.1 整体架构

```
┌──────────────────────────────────────────────────────┐
│                    浏览器端 (前端)                      │
│  index.html (608行) + app.js (1715行) + style.css (2209行) │
│  ┌─────────┬──────────┬───────────┬────────────┐      │
│  │ LOF页   │ QDII页   │ 增强基金页  │ 期货贴水页   │      │
│  └────┬────┴────┬─────┴─────┬─────┴─────┬──────┘      │
└───────│─────────│───────────│───────────│─────────────┘
        │ fetch   │ fetch     │ fetch     │ fetch
┌───────▼─────────▼───────────▼───────────▼─────────────┐
│                    服务端 (后端)                        │
│              server.js (1198行, Express)                │
│  ┌───────────┬──────────┬────────────┬──────────────┐ │
│  │/api/lof   │/api/qdii │/api/enhance│/api/futures  │ │
│  │/full      │/full     │            │/discount     │ │
│  ├───────────┼──────────┼────────────┼──────────────┤ │
│  │/api/yield │/api/fund │/api/proxy  │              │ │
│  │           │/history  │            │              │ │
│  └─────┬─────┴────┬─────┴──────┬─────┴──────┬───────┘ │
└────────│──────────│────────────│────────────│──────────┘
         ▼          ▼            ▼            ▼
   ┌──────────┐┌──────────┐┌──────────┐┌──────────┐
   │ 东方财富  ││ 腾讯财经  ││ 新浪财经  ││ 本地缓存  │
   │ 天天基金  ││ qt.gtimg  ││ hq.sinajs││ data/*.json│
   └──────────┘└──────────┘└──────────┘└──────────┘
```

### 1.2 设计原则

| 原则 | 实现 |
|------|------|
| **单页应用** | 4 个 `<main class="page">` 容器，通过 `.active` 类切换显隐 |
| **懒加载** | 每个页面首次切换到才触发数据请求 |
| **双层缓存** | 文件缓存 (`data/*.json`) + 内存加载状态追踪 |
| **A股颜色约定** | 涨/正值=红色，跌/负值=绿色（与美股相反） |
| **无框架** | 纯 vanilla JS，无 React/Vue，适合轻量级金融工具 |

### 1.3 技术依赖

```json
{
  "express": "^4.18.2",      // HTTP 服务器
  "node-fetch": "^2.7.0",    // 服务端 HTTP 请求
  "iconv-lite": "^0.6.3"     // GBK 编码解码（腾讯/新浪接口）
}
```

前端额外依赖:
- **Chart.js v4.4.6** — CDN 加载，用于收益率趋势折线图
- **Google Fonts** — JetBrains Mono (等宽数字) + Noto Sans SC (中文)

---

## 2. 全局 UI 框架与导航系统

### 2.1 页面骨架

```html
<body>
  <!-- 背景装饰层（仅深色模式可见） -->
  <div class="bg-grid"></div>          <!-- 60px网格线 -->
  <div class="bg-glow bg-glow-1"></div> <!-- 右上蓝色光晕 -->
  <div class="bg-glow bg-glow-2"></div> <!-- 左下紫色光晕 -->

  <!-- 顶部导航 -->
  <header class="header">...</header>

  <!-- 四个页面容器（同时只显示一个） -->
  <main class="page page-lof active" id="pageLof">...</main>
  <main class="page page-qdii" id="pageQdii">...</main>
  <main class="page page-enhance" id="pageEnhance">...</main>
  <main class="page page-futures" id="pageFutures">...</main>

  <!-- 弹窗（收益率对比 + 风险详情） -->
  <div class="compare-modal-overlay" id="compareModalOverlay">...</div>

  <!-- 页脚 -->
  <footer class="footer">...</footer>
</body>
```

### 2.2 顶部导航栏

**结构**: `header > header-inner > [logo, nav, header-right]`

| 元素 | 说明 |
|------|------|
| **Logo** | `◈ FundScope PRO` — logo-icon + logo-text (渐变) + logo-badge (蓝紫渐变) |
| **导航链接** | 4 个 `<a class="nav-link" data-page="xxx">` — LOF溢价/QDII额度/增强基金/期货贴水 |
| **市场状态** | `#marketStatus` — 绿色脉冲点(交易中) / 灰色点(已收盘/休市) |
| **主题切换** | `#themeToggle` — 太阳(☀)/月亮(☾) 图标切换 |
| **刷新按钮** | `#refreshBtn` — SVG 旋转箭头，加载时 spinning 动画 |

**导航交互行为**:
```javascript
// 点击导航链接 → 切换页面 + 触发懒加载
initNav() {
  link.addEventListener('click', e => {
    // 1. 切换 .active 类（链接 + 页面容器）
    // 2. 更新 S.page 状态
    // 3. 如果目标页面数据为空 → 自动触发加载
    if (p === 'lof' && S.lof.raw.length === 0) loadLof();
    if (p === 'qdii' && S.qdii.raw.length === 0) loadQdii();
    if (p === 'enhance' && S.enhance.groups.length === 0) loadEnhance();
    if (p === 'futures' && S.futures.raw.length === 0) loadFutures();
  });
}
```

**市场状态判断逻辑**:
```javascript
function isMarketOpen() {
  const d = new Date(), day = d.getDay();
  const t = d.getHours() * 60 + d.getMinutes();
  // 周一~周五, 上午 9:30-11:30 (570-690), 下午 13:00-15:00 (780-900)
  return day > 0 && day < 6 && ((t >= 570 && t <= 690) || (t >= 780 && t <= 900));
}
// 每60秒自动更新状态指示器
```

### 2.3 Header 样式特性

```css
.header {
  position: sticky; top: 0; z-index: 100;
  background: var(--bg-header);  /* 半透明 */
  backdrop-filter: blur(20px) saturate(1.2); /* 毛玻璃效果 */
  border-bottom: 1px solid var(--border-primary);
}
```

**导航链接激活态**: 蓝色文字 + 蓝色背景 + 底部 2px 蓝色下划线（伪元素实现）

### 2.4 通用页面布局模式

每个页面遵循统一的层级结构:

```
page
├── stats-bar          ← 统计概览卡片（5列grid）
├── toolbar            ← 搜索框 + 筛选按钮组 + 排序下拉
├── toolbar-extra      ← 列选择器 + 导出按钮（可选）
├── compare-bar        ← 对比工具条（仅增强基金，按需显示）
├── loading-container  ← 加载状态（spinner + 文案）
├── cache-hint         ← 缓存/新鲜数据提示条
├── special-content    ← 页面特有内容（如期货知识引导）
└── table-container    ← 数据表格
```

---

## 3. 双主题系统（阳光/深夜模式）

### 3.1 CSS Variables 体系

通过 `[data-theme="light"]` 和 `[data-theme="dark"]` 选择器定义 43+ 变量:

```css
/* 核心变量分类 */
--bg-primary / --bg-secondary / --bg-card / --bg-card-hover / --bg-input / --bg-header
--border-primary / --border-hover / --border-accent
--text-primary / --text-secondary / --text-muted / --text-accent
--red / --red-soft / --red-bg / --red-glow        /* 涨/正值 */
--green / --green-soft / --green-bg / --green-glow  /* 跌/负值 */
--blue / --blue-soft / --blue-bg                    /* 品牌色/强调色 */
--amber / --amber-soft / --amber-bg                 /* 警告/限额 */
--orange / --orange-bg                              /* 指数筛选高亮 */
--purple / --purple-bg                              /* 对比/增强模式 */
--shadow-sm / --shadow-md / --shadow-lg / --shadow-glow
--thead-bg / --row-hover-bg / --row-border
--scrollbar-thumb / --scrollbar-hover
```

**深色模式独有效果**:
```css
[data-theme="dark"] .bg-grid { opacity: 1; }    /* 网格线可见 */
[data-theme="dark"] .bg-glow { opacity: 0.4; }  /* 光晕可见 */
```

### 3.2 丝滑切换动画（双 rAF 技术）

```javascript
function initTheme() {
  document.getElementById('themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';

    // Step 1: 加过渡类（让所有元素准备 transition）
    html.classList.add('theme-transitioning');

    // Step 2: 双 rAF 确保浏览器已渲染过渡类
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html.setAttribute('data-theme', next);
        localStorage.setItem('fundscope-theme', next);

        // Step 3: 过渡完成后移除类（恢复正常性能）
        const cleanup = () => html.classList.remove('theme-transitioning');
        setTimeout(cleanup, 500);  // 兜底超时
        html.addEventListener('transitionend', cleanup, { once: true });
      });
    });
  });
}
```

```css
/* 过渡期间的全局样式 */
html.theme-transitioning,
html.theme-transitioning *,
html.theme-transitioning *::before,
html.theme-transitioning *::after {
  transition: background-color 0.4s ease,
              background 0.4s ease,
              color 0.4s ease,
              border-color 0.4s ease,
              box-shadow 0.4s ease,
              opacity 0.4s ease,
              fill 0.4s ease,
              stroke 0.4s ease !important;
}
```

**关键设计决策**:
- 不在所有元素上常驻 transition（影响 hover/交互性能）
- 仅在切换瞬间临时加类，切换完成立即移除
- `!important` 确保覆盖所有内联或特定 transition
- 双 rAF 避免 class 添加和 theme 切换在同一帧，确保 transition 生效

---

## 4. 通用交互模式

### 4.1 加载状态

```html
<div class="loading-container" id="xxxLoading">
  <div class="loading-spinner"></div>   <!-- 旋转圆环 -->
  <div class="loading-text">正在获取 XXX 数据<span class="loading-dots"></span></div>
  <div class="loading-sub">首次加载需要获取全部申购状态，请耐心等待约 30 秒</div>
</div>
```

**状态切换函数**:
```javascript
function showLoading(page, show) {
  // show=true: loading显示, table隐藏, cacheHint隐藏
  // show=false: loading隐藏, table显示, cacheHint显示
}
```

**刷新按钮状态**:
```javascript
function setRefreshBtnState(loading) {
  // loading=true: 添加 .spinning 类（SVG 旋转动画） + disabled
  // loading=false: 移除 .spinning + 启用
}
```

### 4.2 缓存提示条

```javascript
function updateCacheHint(page, cached, fetchDateLocal) {
  if (cached) {
    // 橙色: "缓存数据 · 获取于 xxx · 点击「刷新」获取最新数据"
    el.className = 'cache-hint cached';
  } else {
    // 绿色: "最新数据 · 获取于 xxx"
    el.className = 'cache-hint fresh';
  }
}
```

### 4.3 搜索（防抖）

所有搜索框统一使用 300ms 防抖:
```javascript
const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// 绑定方式
document.getElementById('searchLof').addEventListener('input', 
  debounce(e => { S.lof.search = e.target.value; applyLofFilters(); })
);
```

### 4.4 筛选按钮交互

```html
<div class="filter-group">
  <button class="filter-btn active" data-filter="all">全部</button>
  <button class="filter-btn" data-filter="premium">溢价 ↑</button>
  ...
</div>
```

**点击逻辑**: 同组按钮互斥 → 移除所有 `.active` → 给当前加 `.active` → 更新 state → 触发 apply

**指数筛选按钮** (QDII 页面): 用 `filter-index` 类区分样式（虚线边框，选中变橙色）

### 4.5 排序下拉框

```html
<select id="sortLof" class="sort-select">
  <option value="premium_desc">溢价率 高→低</option>
  <option value="code_asc">代码 升序</option>
  ...
</select>
```

**value 命名约定**: `field_dir` 格式，如 `premium_desc`, `code_asc`  
**拆分方法**: 用最后一个下划线分割（因为某些字段名含下划线）

```javascript
const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
```

### 4.6 基金代码点击跳转

所有页面的基金代码单元格均可点击跳转东方财富详情页:
```html
<td class="cell-code" onclick="window.open('https://fund.eastmoney.com/${f.code}.html','_blank')">
  ${f.code}
</td>
```

样式: 蓝色 accent 色 + hover 下划线 + pointer 光标

### 4.7 弹窗通用交互

两种弹窗（收益率对比 + 期货风险详情）共享相同交互模式:
- 点击遮罩层 → 关闭弹窗
- 点击关闭按钮(✕) → 关闭弹窗
- 打开弹窗时 `body.style.overflow = 'hidden'`（禁止背景滚动）
- 关闭弹窗时恢复 `body.style.overflow = ''`
- 打开动画: `modalSlideIn` — opacity 0→1, translateY 20px→0, scale 0.97→1
- 遮罩: 半透明黑色 + `backdrop-filter: blur(4px)`

---

## 5. Page 1 — LOF 溢价监控

### 5.1 功能概述

监控所有 LOF (Listed Open-ended Fund) 基金的场内价格与基金净值之间的溢价率，帮助发现套利机会。

### 5.2 统计概览卡片（5列）

| 卡片 | 数据源 | 顶部色带 |
|------|--------|---------|
| LOF 基金总数 | `S.lof.raw.length` | 无 |
| 溢价基金 | `premium > 0` 的数量 | 红色 |
| 折价基金 | `premium < 0` 的数量 | 绿色 |
| 可申购 | `purchasable === true` | 蓝色 |
| 最后更新 | 当前时间 HH:MM:SS | 无 |

### 5.3 筛选系统

| 按钮 | 逻辑 |
|------|------|
| 全部 | 不过滤 |
| 溢价 ↑ | `premium > 0` |
| 折价 ↓ | `premium !== null && premium < 0` |
| 可申购 | `purchasable === true` |

### 5.4 排序选项

```
premium_desc      溢价率 高→低（默认）
premium_asc       溢价率 低→高
abs_premium_desc  |溢价率| 高→低（特殊排序）
price_desc/asc    价格
nav_desc/asc      净值
purchaseLimit_desc/asc  限额
code_asc/desc     代码
```

**特殊排序 `abs_premium_desc`**: 按溢价率绝对值降序，不参与通用 `field_dir` 拆分逻辑

### 5.5 表格列

| 列名 | 字段 | 样式特性 |
|------|------|---------|
| # | 序号 | 居中, 等宽字体, 淡色 |
| 基金代码 | `code` | 蓝色, 可点击跳转, 等宽字体 |
| 基金名称 | `name` | 加粗, 最大280px溢出省略 |
| 二级市场价格 | `price` | 右对齐, 等宽, 红涨绿跌 |
| 基金净值 | `nav` | 右对齐, 非最新净值加感叹号(!)+灰化 |
| 溢价率 | `premium` | 右对齐, 加粗, 正红负绿, +/-符号 |
| [收益率列] | 动态 | 见第14章 |
| 可申购 | `purchasable` | 居中, 状态徽章(是/否/限额) |
| 申购限额 | `purchaseLimit` | 右对齐, 限额金额橙色/无限额灰色/暂停红色 |

### 5.6 净值日期处理

```javascript
// 非最新净值显示
if (f.navIsLatest === false) {
  navHtml = `<span class="nav-stale" title="净值日期: ${f.navDate}">${navStr}</span>
             <span class="warn-icon" title="非最新净值(${f.navDate})">!</span>`;
}
```

- `navIsLatest === false` → 净值数字灰化(opacity: 0.7) + 橙色感叹号(!) + hover tooltip
- 数据来源: 天天基金 `showday` 字段，区分今日净值和前日净值

### 5.7 申购状态三态展示

```javascript
// 三种状态
purchasable === true && purchaseStatus !== '限大额'  → badge('是', 'yes')    绿色
purchasable === true && purchaseStatus === '限大额'   → badge('限额', 'limited') 橙色
purchasable === false                                 → badge('否', 'no')     红色
```

限额金额格式化: `fmtMoney(a)` — 自动转换为"亿/万/元"单位

### 5.8 数据加载流程

```
loadLof(forceRefresh) →
  1. 设置 loading 状态
  2. fetch('/api/lof/full') → 后端一次性返回完整数据
  3. 存入 S.lof.raw
  4. applyLofFilters() → 筛选 → 排序 → renderLof()
  5. updateLofStats() → 更新统计卡片
  6. updateCacheHint() → 显示缓存状态
```

---

## 6. Page 2 — QDII 额度追踪

### 6.1 功能概述

追踪所有 QDII 基金的申购额度状态，帮助判断哪些 QDII 基金可以购买、限额多少。

### 6.2 统计概览卡片

| 卡片 | 说明 |
|------|------|
| QDII 基金总数 | 全部 QDII 数量 |
| 正常申购 | `purchasable && status !== '限大额'` |
| 限额申购 | `purchaseStatus === '限大额'` |
| 暂停申购 | `purchasable === false` |
| 最后更新 | HH:MM:SS |

### 6.3 筛选系统

**状态筛选** (互斥):
- 全部 / 正常申购 / 限额申购 / 暂停申购

**指数筛选** (用分隔线与状态筛选分开):
- 纳斯达克: 匹配名称含 `纳斯达克/纳指/nasdaq/纳100/纳斯`
- 标普: 匹配名称含 `标普`

```css
/* 指数筛选按钮样式差异 */
.filter-btn.filter-index { border-style: dashed; }
.filter-btn.filter-index.active {
  border-style: solid;
  border-color: var(--orange);
  background: var(--orange-bg);
  color: var(--orange);
}
/* 分隔线 */
.filter-divider { width: 1px; height: 22px; background: var(--border-primary); }
```

### 6.4 表格列

| 列名 | 字段 | 特殊处理 |
|------|------|---------|
| # | 序号 | |
| 基金代码 | `code` | 可点击跳转 |
| 基金名称 | `name` | |
| 最新净值 | `nav` | 非最新 → 灰化+感叹号 |
| 净值日期 | `navDate` | 非最新 → 橙色+感叹号 |
| 日涨幅 | `dailyChange` | 红涨绿跌, 非最新净值不显示涨幅 |
| [收益率列] | 动态 | |
| 申购状态 | `purchaseStatus` | 开放(绿)/限额(橙)/暂停(红) |
| 可购买额度 | `purchaseLimit` | 限额金额(橙色加粗)/无限额(绿)/暂停(红) |

### 6.5 净值日期列

QDII 页面独有的 `navDate` 列，以短格式 `MM-DD` 展示:
```javascript
function fmtNavDate(dateStr) {
  // "2026-03-20" → "03-20"
  const parts = dateStr.split('-');
  return `${parts[1]}-${parts[2]}`;
}
```

非最新净值时:
```html
<span class="nav-date-warn">03-20<span class="warn-icon">!</span></span>
```

---

## 7. Page 3 — 增强基金监控

### 7.1 功能概述

监控用户自选的指数增强基金收益表现，支持分组管理、指数基准对比、收益率趋势对比。

### 7.2 数据源

`data/enhance.json` — 手动维护的基金清单:

```json
{
  "groups": [
    {
      "id": "csi300",
      "name": "沪深300增强",
      "trackIndex": "沪深300",
      "trackFund": { "code": "110020", "name": "易方达沪深300ETF联接A" },
      "funds": [
        { "code": "004788", "name": "富荣沪深300增强A", "note": "" },
        ...
      ]
    },
    ...
  ]
}
```

分5组: 沪深300增强 / 中证500增强 / 中证1000增强 / 创业板增强 / 国证2000增强

### 7.3 统计概览卡片

| 卡片 | 说明 |
|------|------|
| 监控基金总数 | flatList.length |
| 今日上涨 | dailyChange > 0 |
| 今日下跌 | dailyChange < 0 |
| 跟踪指数 (X个分组) | groups.length |
| 数据日期 | yieldDate (MM-DD格式) |

### 7.4 筛选系统

**分组筛选**: 动态生成（`buildEnhanceGroupFilter()`）
- 全部 + 各分组按钮（沪深300增强 / 中证500增强 / ...）
- 使用 `filter-index` 类（虚线边框→选中橙色实线）

### 7.5 双视图模式

```html
<div class="enhance-view-toggle">
  <span class="column-selector-label">视图:</span>
  <button class="col-toggle-btn active" data-view="group">分组</button>
  <button class="col-toggle-btn" data-view="flat">平铺</button>
</div>
```

**分组视图** (`group`):
- 每组先渲染分组标题行 → 跟踪指数基金行 → 增强基金行
- 分组标题行: 蓝色背景, `group-badge`(名称) + `group-index`(跟踪指数) + `group-count`(基金数量)
- 跟踪指数基金行: 紫色背景 + `track-label`(◆ 指数) 标签

**平铺视图** (`flat`):
- 所有基金统一排列，不显示分组标题
- 当选择了某个分组筛选时，也自动切换为平铺模式

### 7.6 跟踪指数基金行

```javascript
function enhanceTrackRow(tf, activeCols) {
  // 紫色背景行，序号位显示"◆ 指数"标签
  // 备注列固定显示"被动指数基金"
  // 也参与对比模式的勾选
}
```

```css
.enhance-track-row {
  background: rgba(124, 58, 237, 0.03);
  border-bottom: 1px dashed rgba(124, 58, 237, 0.18);
}
.track-label {
  background: rgba(124, 58, 237, 0.06);
  border: 1px solid rgba(124, 58, 237, 0.12);
  color: var(--purple);
}
.track-label::before { content: '◆'; } /* 钻石图标前缀 */
```

### 7.7 表格列

| 列名 | 字段 | 说明 |
|------|------|------|
| [选择] | 对比模式 | 仅对比模式可见，勾选checkbox |
| # | 序号 | |
| 基金代码 | `code` | 可点击跳转 |
| 基金名称 | `name` | |
| 最新净值 | `nav` | |
| 日涨幅 | `dailyChange` | 红涨绿跌 |
| [收益率列] | 动态 | 今年来/近1月/近3月/近半年/近1年 |
| 备注 | `note` | 最大180px溢出省略 |

### 7.8 专属工具栏

增强基金的工具栏额外包含:
1. **列选择器** — 选择显示哪些收益率列
2. **视图切换** — 分组/平铺
3. **收益率对比按钮** — 开启对比模式（详见第9章）
4. **导出按钮** — 导出CSV

---

## 8. Page 4 — 期货贴水监控

### 8.1 功能概述

监控 IC/IF/IH/IM 四大股指期货品种的贴水/升水情况，计算年化贴水率，提供风险评估。

### 8.2 页面独有元素

#### 风险提醒横幅（始终可见）

```html
<div class="futures-risk-banner">
  <div class="risk-banner-icon">⚠</div>
  <div class="risk-banner-content">
    <strong>风险提示</strong>：股指期货为保证金交易，自带杠杆效应...
  </div>
</div>
```

红色边框 + 浅红背景，始终显示在页面顶部。

#### 数据过期通知

```html
<div class="futures-stale-notice" id="futuresStaleNotice" style="display:none;">
  <span class="stale-notice-icon">◔</span> 当前显示为 <strong>2026-03-20</strong> (非交易日) 的收盘数据...
</div>
```

橙色横幅，仅在数据非实时时显示。过期原因: `非交易日` / `盘前` / `盘后` / `数据延迟`

#### 知识引导（折叠面板）

```html
<details class="futures-guide">
  <summary>💡 什么是贴水？滚IC策略是什么？</summary>
  <div class="futures-guide-content">
    <!-- 3列网格: 基本概念 / 滚IC策略 / 核心风险 -->
  </div>
</details>
```

使用原生 `<details>` 标签，展开箭头(▶)有旋转动画。

### 8.3 统计概览卡片

| 卡片 | 说明 |
|------|------|
| 最优年化贴水 | 年化收益最高的活跃合约 (排除7天内到期) |
| 活跃合约 | 非到期合约数 |
| 贴水合约数 | `discountStatus === 'discount'` |
| 升水合约数 | `discountStatus === 'premium'` |
| 数据更新 | HH:MM:SS |

### 8.4 筛选系统

品种筛选: 全部 / IC 中证500 / IF 沪深300 / IH 上证50 / IM 中证1000

### 8.5 排序选项（18个）

```
annualizedReturn_desc/asc   年化贴水
discountRate_asc/desc       贴水率（注意：贴水率为负，所以 asc 实际是"高→低"）
discountPoints_asc/desc     贴水点数
daysToExpiry_asc/desc       到期日 近→远/远→近
lastPrice_desc/asc          期货价
indexPrice_desc/asc         现货指数
marginPerLot_desc/asc       保证金
profitPerLot_desc/asc       贴水收益
expiryDate_asc/desc         到期日期
```

### 8.6 外部链接开关

```html
<label class="futures-toggle" id="toggleExtLinks">
  <input type="checkbox" id="extLinksSwitch">
  <span class="toggle-slider"></span>
  <span class="toggle-label">查看外部链接</span>
</label>
```

开启后表格添加 `.show-ext-links` class，每个合约旁显示「东财」「新浪」外链标签:
- 东方财富: `https://quote.eastmoney.com/unify/r/220.{contractCode}`
- 新浪财经: `https://finance.sina.com.cn/futures/quotes/{contractCode}.shtml`

### 8.7 表格列（13列）

| 列名 | 字段 | 特殊处理 |
|------|------|---------|
| # | 序号 | |
| 合约 | `variety` + `contractMonth` | 品种色标签(IC蓝/IF绿/IH琥珀/IM紫) + 月份 + 贴水/升水/平水标签 + 到期标签 + 外链 |
| 品种 | `indexName` | 实际显示对应指数名 |
| 期货最新价 | `lastPrice` | + OLD标识(过期数据) |
| 现货指数 | `indexPrice` | |
| 贴水点数 | `discountPoints` | 红贴水/绿升水 |
| 贴水率 | `discountRate` | 红贴水/绿升水 |
| 年化贴水 | `annualizedReturn` | 加粗, 红正绿负 |
| 到期日 | `expiryDate` | MM-DD 格式 |
| 剩余天数 | `daysToExpiry` | ≤7天红色闪烁(pulse-text) |
| 1手保证金 | `marginPerLot` | fmtMoney 格式 |
| 1手贴水收益 | `profitPerLot` | 正绿负红 |
| 风险 | `risk.riskLevel` | 4色风险徽章(可点击查看详情) |

### 8.8 已到期合约处理

```css
.futures-expired-row {
  opacity: 0.45;           /* 整行灰化 */
  background: var(--bg-secondary) !important;
}
.futures-expired-tag {
  font-size: 10px; padding: 1px 5px;
  background: var(--text-hint); color: var(--bg-primary);
}
```

到期合约: 贴水点数/贴水率/年化/保证金/收益均显示 `--`(半透明)

### 8.9 品种颜色标签

```javascript
const varietyColors = { IC: '#3b82f6', IF: '#22c55e', IH: '#f59e0b', IM: '#a855f7' };
```

```html
<span class="futures-variety-tag" 
      style="background:${vColor}15;color:${vColor};border-color:${vColor}33">
  ${c.variety}
</span>
```

### 8.10 风险评估系统

**5维检查**:

| 检查维度 | 条件 | 风险等级 |
|---------|------|---------|
| 年化异常(高) | \|年化\| > 30% | high |
| 年化异常(中) | \|年化\| > 20% | medium |
| 临近到期(急) | ≤3天 | extreme |
| 临近到期(警) | ≤7天 | medium |
| 升水状态 | 贴水率 > +0.5% | medium |
| 杠杆提醒 | 无其他风险时 | low |
| 低收益 | 年化 < 3% 且贴水 | low (附提示) |

**4色风险徽章**:
```javascript
const RISK_LEVEL_MAP = {
  low:     { label: '低风险', cls: 'risk-low',     icon: '●' },
  medium:  { label: '中风险', cls: 'risk-medium',   icon: '▲' },
  high:    { label: '高风险', cls: 'risk-high',     icon: '◆' },
  extreme: { label: '极高',   cls: 'risk-extreme',  icon: '⬤' },
};
```

```css
.risk-low    { background: rgba(22,163,74,0.08); color: var(--green); }
.risk-medium { background: rgba(245,158,11,0.08); color: var(--amber); }
.risk-high   { background: rgba(239,68,68,0.08); color: var(--red); }
.risk-extreme {
  background: rgba(239,68,68,0.12); color: var(--red);
  animation: pulse-risk 1.5s infinite;  /* 脉冲阴影动画 */
}
```

### 8.11 风险详情弹窗

点击有警告的风险徽章 → 打开弹窗:

```javascript
function showFuturesRiskDetail(contractCode) {
  // 1. 显示风险等级大徽章
  // 2. 合约基本信息（代码/到期/年化）
  // 3. 逐条展示风险警告（带emoji图标）
  // 4. 操作建议（根据实际情况动态生成）
}
```

弹窗内容结构:
- **风险等级大徽章** + 合约元信息
- **风险警告列表**: 每条一个圆角卡片，带 emoji 前缀（🔴/🟡/🟠/🔵/⚪）
- **操作建议**: 蓝色背景区域，条目化建议（临近到期→换仓/升水→不建议/高年化→观察/通用→保证金充足+仓位控制）

---

## 9. 收益率对比系统（Chart.js 折线图弹窗）

### 9.1 交互流程

```
点击「收益率对比」按钮 → 进入对比模式
  → 表格出现勾选列(checkbox)
  → 勾选基金(最多5只) → chip展示在对比工具条
  → 点击「开始对比」 → 打开全屏弹窗
  → 选择时间维度 → 重新请求数据+重绘图表
  → 关闭弹窗 / 关闭对比模式
```

### 9.2 对比模式状态管理

```javascript
S.compare = {
  active: false,         // 是否开启对比模式
  selected: [],          // 已选基金数组（max 5）
  period: 'month3',      // 当前时间维度
  chart: null,           // Chart.js 实例（用于销毁重建）
};
```

### 9.3 对比工具条

```html
<section class="compare-bar" id="enhanceCompareBar">
  <div class="compare-bar-left">
    <span class="compare-bar-label">已选择对比基金：</span>
    <div class="compare-bar-chips" id="compareBarChips">
      <!-- 动态chip: 基金代码 + 名称(截断8字) + 移除按钮(✕) -->
    </div>
  </div>
  <div class="compare-bar-right">
    <button class="compare-clear-btn">清空</button>
    <button class="compare-draw-btn" disabled>开始对比</button>
    <button class="compare-close-btn">关闭对比</button>
  </div>
</section>
```

Chip 样式: 每只基金对应一个固定颜色（与图表线色一致）

```javascript
const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7'];
```

### 9.4 弹窗结构

```html
<div class="compare-modal">
  <!-- 头部: 标题 + 时间维度按钮 + 关闭按钮 -->
  <div class="compare-modal-header">
    <h3>收益率趋势对比</h3>
    <div class="compare-period-btns">
      <button data-period="month1">近1月</button>
      <button data-period="month3" class="active">近3月</button>
      <button data-period="ytd">今年来</button>
      <button data-period="month6">近半年</button>
      <button data-period="year1">近1年</button>
      <button data-period="year3">近3年</button>
    </div>
    <button class="compare-modal-close">✕</button>
  </div>
  <!-- 主体: 加载状态 + 图表 + 摘要表格 -->
  <div class="compare-modal-body">
    <div class="compare-loading">...</div>
    <div class="compare-chart-container">
      <canvas id="compareChart"></canvas>
    </div>
    <div class="compare-table-container">
      <table><!-- 颜色点 | 代码 | 名称 | 净值 | 日涨幅 | 区间收益率 --></table>
    </div>
  </div>
</div>
```

### 9.5 图表绘制

```javascript
function drawTrendChart(seriesMap, period) {
  // 1. 收集所有日期作为 X 轴
  // 2. 为每只基金构建 dataset
  // 3. 重建 Canvas (防止 Chart.js 残留)
  // 4. 创建 Chart 实例

  S.compare.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: { /* 深色背景, 等宽字体, ±百分比格式 */ },
        title: { text: `${periodLabel}累计收益率趋势` },
      },
      scales: {
        y: { ticks: { callback: v => v.toFixed(1) + '%' } },
        x: { ticks: { maxTicksLimit: 12 } },
      },
    },
  });
}
```

**Chart.js 配置要点**:
- 线条: 2px宽, 无点(pointRadius:0), hover显示5px点
- 张力: 0.3（轻微弧度）
- 颜色: 5色轮换（蓝/红/绿/琥珀/紫）
- tooltip: 暗色背景, Noto Sans SC标题 + JetBrains Mono数值
- Y轴: ±百分比格式
- X轴: 最多12个刻度标签
- 缺失数据: `spanGaps: true`

### 9.6 数据请求

```javascript
// 前端
fetch(`/api/fund/history?codes=xxx,yyy&period=month3`)

// 后端
// 1. 并行获取各基金历史净值（天天基金分页API, 每页20条）
// 2. 过滤到 startDate 之后
// 3. 以第一天净值为基准，计算累计收益率: (nav - base) / base * 100
```

**时间维度 → 交易日数映射**:
```javascript
const daysMap = {
  month1: 25, month3: 70, month6: 130,
  year1: 255, ytd: 255, year3: 760,
};
```

---

## 10. 后端 API 设计与数据流

### 10.1 API 清单

| 路由 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/lof/full` | GET | `?refresh=1` | LOF 完整数据（净值+价格+申购状态+限额） |
| `/api/qdii/full` | GET | `?refresh=1` | QDII 完整数据 |
| `/api/yield` | GET | `?refresh=1` | 全量收益率数据（10000+基金） |
| `/api/enhance` | GET | - | 增强基金监控数据 |
| `/api/fund/history` | GET | `?codes=x,y&period=month3` | 多基金历史净值（用于对比图表） |
| `/api/futures/discount` | GET | `?refresh=1` | 股指期货贴水数据 |
| `/api/proxy` | GET | `?url=xxx` | 通用代理（用于绕过跨域） |

### 10.2 LOF 数据构建流程 (`buildLofData`)

```
1. fetchFundNavList(lx=4)         ← 天天基金净值列表（LOF分类）
   → 429只, 含 code/name/nav/navDate/purchaseStatusText
2. 筛出 purchaseStatusText 含 "限大额" 的代码
3. Promise.all([
     fetchMarketPrices(codes),     ← 腾讯财经场内价格 (GBK编码)
     fetchPurchaseLimits(limitedCodes), ← 东方财富详情页限额
   ])
4. 合并计算:
   premium = (price - nav) / nav × 100
5. 写入 data/lof.json 缓存
```

### 10.3 QDII 数据构建流程 (`buildQdiiData`)

```
1. fetchFundNavList(lx=6)         ← 天天基金净值列表（QDII分类）
   → 340只
2. fetchPurchaseLimits(limitedCodes) ← 限额详情
3. 合并返回（无场内价格，QDII不计算溢价率）
```

### 10.4 收益率数据 (`fetchAllYieldData`)

```
请求: fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&pn=20000
返回: ~19000只基金的所有收益率数据
解析: 逗号分隔字段 → 提取 ytd/month1/month3/month6/year1/...
存储: code → { ytd, month1, month3, month6, year1, ... } Map
缓存: data/yield.json (~6.77MB)
```

### 10.5 期货贴水数据

```
1. getActiveContractMonths()       ← 计算当月/下月/两个季月
2. for each variety (IC/IF/IH/IM):
     fetchFuturesQuotes(variety, months) ← 新浪财经 (nf_ 前缀, GBK)
3. fetchIndexQuotes(indexCodes)    ← 腾讯财经现货指数
4. 计算: 贴水点数/贴水率/年化/保证金/收益/风险评估
5. 判断数据过期: quoteDate vs today + 时段判断
```

### 10.6 并发请求处理

LOF/QDII API 有防重复请求机制:
```javascript
// 正在加载中 → 返回缓存(如有)，或等待加载完成
if (dataCache.lof.loading) {
  const cached = readCacheFile(LOF_CACHE_FILE);
  if (cached) return res.json({ ...cached, refreshing: true });
  // 否则轮询等待，超时90秒
  while (dataCache.lof.loading && Date.now() - waitStart < 90000) {
    await sleep(1000);
  }
}
```

### 10.7 GBK 编码处理

腾讯财经和新浪财经接口返回 GBK 编码:
```javascript
const buf = await resp.buffer();
const text = iconv.decode(buf, 'gbk');
```

通用代理也支持 GBK:
```javascript
const text = (ct.includes('gbk') || ct.includes('gb2312'))
  ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
```

---

## 11. 数据缓存策略

### 11.1 缓存文件结构

```json
// data/lof.json, data/qdii.json
{
  "fetchDate": "2026-03-21T05:30:00.000Z",       // UTC 时间
  "fetchDateLocal": "2026/3/21 13:30:00",          // 本地时间
  "count": 429,
  "data": [ ... ]
}

// data/yield.json
{
  "fetchDate": "...",
  "fetchDateLocal": "...",
  "count": 19234,
  "data": { "000001": { "ytd": 5.23, ... }, ... }  // Map 结构
}
```

### 11.2 缓存读写

```javascript
function readCacheFile(filePath) {
  // 读取JSON → 检查有 data 和 fetchDate → 返回
  // 失败返回 null
}

function writeCacheFile(filePath, data) {
  // 生成 { fetchDate, fetchDateLocal, count, data }
  // JSON.stringify(content, null, 2) 写入文件
}
```

### 11.3 缓存策略

| 场景 | 行为 |
|------|------|
| 首次请求（无缓存文件） | 远程获取 → 写入缓存 → 返回 `cached: false` |
| 再次请求（有缓存文件） | 直接返回缓存 → `cached: true` |
| 点击刷新按钮 (`?refresh=1`) | 跳过缓存 → 远程获取 → 覆盖缓存 → 返回 `cached: false` |
| 远程获取失败（有缓存文件） | fallback 到缓存 → `cached: true` + `error: msg` |

---

## 12. CSV 导出功能

### 12.1 触发方式

每个页面（LOF/QDII/增强基金）各有一个导出按钮:
```html
<button class="export-btn" id="exportLofBtn">
  <svg>...</svg> <span>导出Excel</span>
</button>
```

### 12.2 导出内容

导出当前筛选后的数据（`S.xxx.filtered`），包含:
- 基础列（代码/名称/净值/...）
- 当前已选中的收益率列
- 增强基金额外包含：分组/跟踪指数/备注

### 12.3 CSV 生成

```javascript
function exportToExcel(page) {
  // 1. 构建表头数组
  // 2. 构建数据行数组
  // 3. 生成 CSV 字符串（带 BOM）
  const BOM = '\uFEFF';  // UTF-8 BOM，Excel 中文兼容
  const csv = BOM + [headers, ...rows].join('\n');
  // 4. 创建 Blob → 触发下载
  link.download = `FundScope_${page.toUpperCase()}_${dateStr}.csv`;
}
```

**单元格转义**:
```javascript
const escCell = v => {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
};
```

**文件名格式**: `FundScope_LOF_20260321_1630.csv`

---

## 13. 通用排序系统

### 13.1 排序键格式

统一使用 `field_dir` 格式:
- `premium_desc` → 溢价率降序
- `annualizedReturn_asc` → 年化升序
- `code_asc` → 代码升序

拆分使用最后一个下划线:
```javascript
const [field, dir] = sortKey.split(/_(?=[^_]+$)/);
```

### 13.2 通用排序指示器 (`updateSortIndicators`)

```javascript
function updateSortIndicators(headRowId, sortKey) {
  // 遍历 #headRowId 下所有 .th-sortable
  // 匹配 field → 加 .th-sorted + 插入 span.sort-arrow (▲/▼)
  // 不匹配 → 移除 .th-sorted + 移除 sort-arrow
}
```

**样式**:
```css
.th-sortable { cursor: pointer; }
.th-sortable:hover { color: var(--text-primary); background: rgba(59,130,246,0.06); }
.th-sortable::after { content: '⇅'; opacity: 0.3; }     /* 默认提示 */
.th-sorted { color: var(--blue) !important; }             /* 蓝色高亮 */
.th-sorted::after { content: none; }                       /* 隐藏默认图标 */
.sort-arrow { color: var(--blue); font-weight: 700; }     /* 蓝色粗箭头 */
```

### 13.3 通用表头点击处理 (`handleHeaderSortClick`)

```javascript
function handleHeaderSortClick(page, key, selectId) {
  // 1. 获取当前排序状态
  // 2. 同列 → 切换方向 (desc↔asc)
  // 3. 不同列 → 智能默认方向
  //    - 代码/天数/日期 默认升序
  //    - 其他字段 默认降序
  // 4. 同步下拉框选中值
  // 5. 触发对应页面的 applyXxxFilters()
}
```

### 13.4 事件委托

动态收益率列的 `<th>` 是 JS 创建的，用事件委托处理:
```javascript
document.getElementById('lofTableHead').addEventListener('click', e => {
  const th = e.target.closest('.th-sortable');
  if (!th) return;
  handleHeaderSortClick('lof', th.dataset.sortKey, 'sortLof');
});
```

### 13.5 收益率字段特殊处理

LOF/QDII 的收益率数据存在 `S.yield` Map 中，排序时需要特殊取值:
```javascript
const yieldFields = new Set(['ytd', 'month1', 'month3', 'month6', 'year1']);

if (yieldFields.has(field)) {
  va = (S.yield[a.code] || {})[field] ?? (isAsc ? Infinity : -Infinity);
} else {
  va = a[field] ?? (isAsc ? Infinity : -Infinity);
}
```

`null/undefined` 值处理: 升序时放到最后(Infinity)，降序时放到最后(-Infinity)

---

## 14. 动态收益率列系统

### 14.1 列配置

```javascript
const YIELD_COLS = [
  { key: 'ytd',    label: '今年来' },
  { key: 'month1', label: '近1月' },
  { key: 'month3', label: '近3月' },
  { key: 'month6', label: '近半年' },
  { key: 'year1',  label: '近1年' },
];
```

### 14.2 选中状态管理

```javascript
S.activeCols = {
  lof: new Set(),      // LOF 页面已选中的列 key
  qdii: new Set(),     // QDII 页面
  enhance: new Set(),  // 增强基金页面
};
```

### 14.3 列选择器交互

```javascript
function initColumnSelector(page, containerId) {
  btn.addEventListener('click', async () => {
    // 1. 如果收益率数据未加载 → 先异步加载（按钮显示"加载中..."）
    if (!S.yieldLoaded) {
      btn.textContent = '加载中...';
      await loadYieldData();
      btn.textContent = '今年来';  // 恢复
    }
    // 2. 切换 Set 中的 key + 切换 .active 类
    // 3. 重新渲染表格
  });
}
```

### 14.4 动态表头更新

**LOF/QDII** — `updateTableHead(page)`:
```javascript
// 1. 移除旧的 .th-yield 列
// 2. 在"可申购"列前面，按 YIELD_COLS 顺序插入选中的列
headRow.querySelectorAll('.th-yield').forEach(th => th.remove());
YIELD_COLS.forEach(col => {
  if (!activeCols.has(col.key)) return;
  const th = document.createElement('th');
  th.className = 'th-yield th-sortable';
  th.dataset.sortKey = col.key;
  th.textContent = col.label;
  headRow.insertBefore(th, insertBefore);
});
```

**增强基金** — `updateEnhanceTableHead()`:
- 使用 `.th-yield-dynamic` 类（区分静态 th 和动态 th）
- 在"备注"列前面插入

### 14.5 动态数据列渲染

在各 `render` 函数中:
```javascript
const yld = S.yield[f.code] || {};
let yieldCells = '';
YIELD_COLS.forEach(col => {
  if (!activeCols.has(col.key)) return;
  const v = yld[col.key];
  const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
  yieldCells += `<td class="cell-yield ${v != null ? cls : ''}">${fmtPct(v)}</td>`;
});
```

---

## 15. 响应式布局与动画系统

### 15.1 响应式断点

```css
@media (max-width: 1200px) {
  .stats-bar { grid-template-columns: repeat(3, 1fr); }  /* 5列→3列 */
}

@media (max-width: 768px) {
  html { font-size: 13px; }
  .logo-text { display: none; }                          /* 隐藏logo文字 */
  .stats-bar { grid-template-columns: repeat(2, 1fr); }  /* 3列→2列 */
  .toolbar { flex-direction: column; align-items: stretch; }
  .search-box { max-width: none; }
  .sort-group { margin-left: 0; }
  .table-container { overflow-x: auto; }                 /* 横向滚动 */
  .futures-guide-content { grid-template-columns: 1fr; }  /* 3列→1列 */
}
```

### 15.2 动画清单

| 动画名 | 用途 | 参数 |
|--------|------|------|
| `spin` | 加载spinner / 刷新按钮 | 0.8s linear infinite |
| `fadeIn` | 页面切换 / 弹窗出现 | 0.3s ease, opacity+translateY |
| `pulse-dot` | 市场状态交易中指示点 | 2s infinite, opacity |
| `dots` | 加载文字省略号 | 1.4s steps(4), content |
| `modalSlideIn` | 弹窗进入 | 0.3s ease, opacity+translateY+scale |
| `pulse-text` | 临到期天数闪烁 | 1.5s infinite, opacity |
| `pulse-risk` | 极高风险徽章 | 1.5s infinite, box-shadow |
| `stale-pulse` | OLD过期标识 | 2.5s ease-in-out, opacity |

### 15.3 字体系统

```css
--font-display: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
--font-body: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
```

| 使用场景 | 字体 |
|---------|------|
| 数字/代码/价格/收益率 | `--font-display` (等宽) |
| 正文/标签/按钮 | `--font-body` (无衬线) |
| Chart.js 标题 | `--font-body` |
| Chart.js 数值 | `--font-display` |

### 15.4 圆角系统

```css
--radius-sm: 6px;   /* 小按钮/小卡片 */
--radius-md: 10px;  /* 输入框/按钮/筛选器 */
--radius-lg: 14px;  /* 卡片/表格容器 */
--radius-xl: 20px;  /* 弹窗/大容器 */
```

---

## 16. 文件结构与依赖清单

### 16.1 目录结构

```
LOF/
├── server.js              (1198行) 后端 Express 服务
├── package.json           项目配置
├── public/
│   ├── index.html         (608行)  HTML 结构
│   ├── app.js             (1715行) 前端逻辑
│   └── style.css          (2209行) 样式
├── data/
│   ├── lof.json           (~148KB, ~429只LOF)
│   ├── qdii.json          (~114KB, ~340只QDII)
│   ├── yield.json         (~6.77MB, ~10000+只全量收益率)
│   ├── enhance.json       (~5.5KB, 5组/~50只增强基金清单)
│   └── futures.json       (~21KB, 4品种×4合约)
└── node_modules/
```

### 16.2 数据源汇总

| 数据源 | 接口 | 返回编码 | 用途 |
|--------|------|---------|------|
| 天天基金-净值列表 | `fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?lx=X` | UTF-8 | LOF(lx=4)/QDII(lx=6) 净值+申购状态 |
| 天天基金-排行 | `fund.eastmoney.com/data/rankhandler.aspx` | UTF-8 | 全量收益率数据 |
| 天天基金-历史净值 | `api.fund.eastmoney.com/f10/lsjz?fundCode=X` | JSONP | 单只基金历史净值(分页) |
| 东方财富-详情页 | `fund.eastmoney.com/{code}.html` | UTF-8 | 申购限额金额(HTML解析) |
| 腾讯财经 | `qt.gtimg.cn/q=szXXXXXX` | **GBK** | LOF场内价格 / 现货指数 |
| 新浪财经 | `hq.sinajs.cn/list=nf_XXX` | **GBK** | 股指期货合约行情 |

### 16.3 全局状态对象

```javascript
const S = {
  page: 'lof',                    // 当前激活页面
  lof:  { raw, filtered, filter, search, sort, loading },
  qdii: { raw, filtered, filter, search, sort, loading },
  enhance: { groups, flatList, filtered, filter, search, sort, loading, view },
  futures: { raw, filtered, filter, sort, loading },
  compare: { active, selected, period, chart },
  lastUpdate: null,
  yield: {},                       // code → 收益率数据 Map
  yieldLoaded: false,
  activeCols: { lof: Set, qdii: Set, enhance: Set },
};
```

### 16.4 辅助函数清单

| 函数 | 用途 |
|------|------|
| `fmt(n, d=4)` | 格式化数字为固定小数位 |
| `fmtPct(n)` | 格式化百分比 (+/- 前缀 + 2位小数 + %) |
| `fmtMoney(a)` | 格式化金额 (亿/万/元) |
| `fmtNavDate(dateStr)` | 日期短格式 MM-DD |
| `isLatestDate(dateStr)` | 判断是否为近3天（覆盖周末） |
| `isMarketOpen()` | A股市场是否交易中 |
| `debounce(fn, ms)` | 防抖包装 |
| `pad(n)` | 数字补零 (2位) |
| `sleep(ms)` | Promise 延时 |
| `badge(text, type)` | 状态徽章 HTML |
| `emptyRow(cols, icon, msg)` | 空数据提示行 |
| `errorHtml(msg)` | 错误提示 HTML |

---

## 附录: 关键设计决策记录

### A. 颜色约定（A股）
- **涨 / 正值 → 红色** (`--red`)
- **跌 / 负值 → 绿色** (`--green`)
- 这是中国股市惯例，与美股/欧股相反

### B. 为什么用 vanilla JS 而不是 React/Vue
- 项目体量适中（4页SPA），无需框架开销
- 数据流简单（全局状态对象 `S` + 直接 DOM 操作）
- 部署简单（express.static 直接伺服）

### C. 为什么收益率数据懒加载
- yield.json ~6.77MB，加载需要时间
- 大多数用户只关注溢价率/申购额度，不需要收益率列
- 点选列按钮时才加载，按钮显示"加载中..."给用户反馈

### D. 为什么用 CSV 而不是真正的 XLSX
- 无需额外依赖（如 xlsx、exceljs）
- CSV + UTF-8 BOM 可被 Excel 正确识别中文
- 对于纯数据导出场景足够用

### E. 为什么用事件委托处理表头排序
- 动态收益率列的 `<th>` 在渲染时才创建
- 如果直接 `addEventListener`，需要每次渲染后重新绑定
- 事件委托绑定在静态父元素 `<tr>` 上，一劳永逸

### F. 为什么期货数据用新浪而不是东方财富
- 东方财富的期货接口需要特殊认证
- 新浪 `hq.sinajs.cn` 是公开接口，免认证
- 注意：新版接口 (`nf_` 前缀) 字段布局与老版完全不同

### G. Chart.js Canvas 重建策略
```javascript
// 每次重绘前销毁旧 Canvas 并创建新的
const parent = canvas.parentNode;
parent.innerHTML = '<canvas id="compareChart"></canvas>';
const newCanvas = document.getElementById('compareChart');
```
- 防止 Chart.js 在同一 Canvas 上多次 `new Chart()` 导致残留/闪烁
- 比 `chart.destroy()` + 复用 Canvas 更可靠

---

*文档结束 — FundScope PRO v1.0 完整功能参考*

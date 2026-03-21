const express = require('express');
const fetch = require('node-fetch');
const iconv = require('iconv-lite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;

app.use(express.static(path.join(__dirname, 'public')));

// ==================== 本地文件缓存 ====================
const CACHE_DIR = path.join(__dirname, 'data');
const LOF_CACHE_FILE = path.join(CACHE_DIR, 'lof.json');
const QDII_CACHE_FILE = path.join(CACHE_DIR, 'qdii.json');
const YIELD_CACHE_FILE = path.join(CACHE_DIR, 'yield.json');
const ENHANCE_LIST_FILE = path.join(CACHE_DIR, 'enhance.json');

// 确保 data 目录存在
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function readCacheFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (content && content.data && content.fetchDate) return content;
    }
  } catch (err) {
    console.error(`读取缓存文件失败 ${filePath}:`, err.message);
  }
  return null;
}

function writeCacheFile(filePath, data) {
  try {
    const content = {
      fetchDate: new Date().toISOString(),
      fetchDateLocal: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      count: data.length,
      data,
    };
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
    console.log(`[缓存] 已写入 ${path.basename(filePath)}, ${data.length} 条`);
  } catch (err) {
    console.error(`写入缓存文件失败 ${filePath}:`, err.message);
  }
}

// 内存缓存（仅用于加载状态跟踪）
const dataCache = {
  lof: { data: null, time: 0, loading: false },
  qdii: { data: null, time: 0, loading: false },
};

// ==================== 工具函数 ====================
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ==================== 天天基金净值列表接口 ====================
// lx=4 是LOF基金, lx=6 是QDII, 返回净值+申购状态
async function fetchFundNavList(lx, pageSize = 500) {
  const allItems = [];
  let totalPages = 99;
  let showday = [null, null]; // [最新日期, 前日日期]
  
  for (let page = 1; page <= totalPages && page <= 10; page++) {
    const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=${lx}&letter=&gsid=&text=&sort=zdf,desc&page=${page},${pageSize}&dt=${Date.now()}&atfc=&onlySale=0`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': `https://fund.eastmoney.com/`,
        }
      });
      const text = await resp.text();
      
      // 解析 var db = {...}
      const match = text.match(/var db=\{.*?datas:\[(.*?)\],count:\[.*?\],record:"(\d+)",pages:"(\d+)"/s);
      if (!match) break;
      
      // 解析 showday（只在第一页解析）
      if (page === 1) {
        const sdMatch = text.match(/showday:\["([^"]+)","([^"]+)"\]/);
        if (sdMatch) showday = [sdMatch[1], sdMatch[2]];
      }
      
      totalPages = parseInt(match[3]) || 1;
      const datasStr = match[1];
      
      // 解析每条数据 [[...],[...],...]
      // 字段: [0]代码 [1]名称 [2]拼音 [3]最新净值 [4]累计净值 [5]前日净值 [6]前日累计 [7]涨跌额 [8]涨跌幅% [9]申购状态 [10]赎回状态 ...
      const rowRegex = /\["([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)"\]/g;
      
      let m;
      while ((m = rowRegex.exec(datasStr)) !== null) {
        const hasNav = !!m[4];
        const hasPrevNav = !!m[6];
        
        allItems.push({
          code: m[1],
          name: m[2],
          nav: hasNav ? parseFloat(m[4]) : (hasPrevNav ? parseFloat(m[6]) : null),
          navDate: hasNav ? showday[0] : (hasPrevNav ? showday[1] : null),
          navIsLatest: hasNav,  // 标记是否为最新净值
          navAcc: m[5] ? parseFloat(m[5]) : null,
          navPrev: m[6] ? parseFloat(m[6]) : null,
          navChange: m[8] ? m[8] : null,
          navChangeRate: m[9] ? parseFloat(m[9]) : null,
          purchaseStatusText: m[10] || '',
          redeemStatusText: m[11] || '',
        });
      }
      
      if (page < totalPages) await sleep(100);
    } catch (err) {
      console.error(`fetchFundNavList(lx=${lx}, page=${page}) 失败:`, err.message);
      break;
    }
  }
  
  return { items: allItems, showday };
}

// ==================== 解析申购状态 ====================
function parsePurchaseFromText(statusText) {
  if (!statusText) return { purchasable: null, purchaseStatus: '未知', purchaseLimit: null };
  
  if (statusText.includes('暂停')) {
    return { purchasable: false, purchaseStatus: '暂停申购', purchaseLimit: null };
  }
  if (statusText.includes('限大额')) {
    return { purchasable: true, purchaseStatus: '限大额', purchaseLimit: null };
  }
  if (statusText.includes('开放')) {
    return { purchasable: true, purchaseStatus: '开放申购', purchaseLimit: null };
  }
  return { purchasable: null, purchaseStatus: statusText || '未知', purchaseLimit: null };
}

// ==================== 批量获取申购限额（从详情页） ====================
async function fetchPurchaseLimits(codes) {
  const limitMap = {};
  const batchSize = 20;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (code) => {
        try {
          const url = `https://fund.eastmoney.com/${code}.html`;
          const resp = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Referer': 'https://fund.eastmoney.com/',
            },
            timeout: 8000,
          });
          const html = await resp.text();
          return { code, html };
        } catch {
          return { code, html: '' };
        }
      })
    );

    results.forEach(({ code, html }) => {
      if (!html) return;
      
      // 优先匹配最精确的格式：单日累计购买上限XXX元/万元
      const primaryPattern = /单日累计购买上限\s*([\d,.]+)\s*(万元|元)/;
      const pm = html.match(primaryPattern);
      if (pm) {
        let amount = parseFloat(pm[1].replace(/,/g, ''));
        if (pm[2] === '万元') amount *= 10000;
        limitMap[code] = amount;
        return;
      }
      
      // 备用模式（不包含"最高超"等广告文案）
      const fallbackPatterns = [
        /购买上限\s*([\d,.]+)\s*(万元|元)/,
        /日累计申购限额[^<]*?([\d,.]+)\s*(万元|元)/,
        /大额申购[^<]*?限额[^<]*?([\d,.]+)\s*(万元|元)/,
        /申购上限[^<]*?([\d,.]+)\s*(万元|元)/,
      ];
      for (const pat of fallbackPatterns) {
        const m = html.match(pat);
        if (m) {
          let amount = parseFloat(m[1].replace(/,/g, ''));
          if (m[2] === '万元') amount *= 10000;
          limitMap[code] = amount;
          break;
        }
      }
    });

    if (i + batchSize < codes.length) await sleep(200);
  }

  return limitMap;
}

// ==================== 腾讯财经获取场内价格 ====================
async function fetchMarketPrices(codes) {
  const priceMap = {};
  const batchSize = 50;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    // LOF主要在深交所(sz)和上交所(sh)
    const queryStr = batch.map(c => {
      // 1开头是沪市，0/1/5开头复杂，简化处理：用sz+sh双试
      return `sz${c},sh${c}`;
    }).join(',');

    try {
      const url = `https://qt.gtimg.cn/q=${queryStr}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      });
      const buf = await resp.buffer();
      const text = iconv.decode(buf, 'gbk');
      
      // 解析每行 v_szXXXXXX="..."
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/v_[sh|sz]+(\d{6})="([^"]*)"/);
        if (m && m[2]) {
          const fields = m[2].split('~');
          if (fields.length > 5 && fields[3] && parseFloat(fields[3]) > 0) {
            const code = m[1];
            priceMap[code] = {
              price: parseFloat(fields[3]),
              prevClose: parseFloat(fields[4]) || null,
              change: fields[4] ? ((parseFloat(fields[3]) - parseFloat(fields[4])) / parseFloat(fields[4]) * 100) : null,
            };
          }
        }
      }
    } catch (err) {
      console.error(`获取场内价格批次失败:`, err.message);
    }

    if (i + batchSize < codes.length) await sleep(100);
  }

  return priceMap;
}

// ==================== 构建LOF完整数据 ====================
async function buildLofData() {
  console.log('[LOF] 开始获取完整数据...');
  const startTime = Date.now();

  // 1) 从天天基金获取LOF净值列表（含申购状态）
  const { items: navList, showday } = await fetchFundNavList(4); // lx=4 是LOF
  console.log(`[LOF] 天天基金净值列表: ${navList.length} 只, showday: ${showday}`);
  
  if (navList.length === 0) throw new Error('LOF净值数据为空');

  const codes = navList.map(f => f.code);

  // 2) 获取场内价格 + 限额（需要限额的基金）
  const limitedCodes = navList
    .filter(f => f.purchaseStatusText.includes('限大额'))
    .map(f => f.code);

  const [priceMap, limitMap] = await Promise.all([
    fetchMarketPrices(codes),
    fetchPurchaseLimits(limitedCodes),
  ]);

  console.log(`[LOF] 场内价格: ${Object.keys(priceMap).length} 只, 限额: ${Object.keys(limitMap).length} 只`);

  // 3) 合并
  const result = navList.map(f => {
    const mkt = priceMap[f.code] || {};
    const purInfo = parsePurchaseFromText(f.purchaseStatusText);
    const price = mkt.price || null;
    const nav = f.nav;
    const premium = (price && nav && nav > 0) ? ((price - nav) / nav) * 100 : null;

    // 如果是限大额，补充限额金额
    if (purInfo.purchaseStatus === '限大额' && limitMap[f.code]) {
      purInfo.purchaseLimit = limitMap[f.code];
    }

    return {
      code: f.code,
      name: f.name,
      price,
      change: mkt.change ?? f.navChangeRate,
      nav,
      navDate: f.navDate || null,
      navIsLatest: f.navIsLatest,
      premium,
      purchasable: purInfo.purchasable,
      purchaseStatus: purInfo.purchaseStatus,
      purchaseLimit: purInfo.purchaseLimit,
    };
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const latestCount = result.filter(f => f.navIsLatest).length;
  console.log(`[LOF] 完成! ${result.length} 只(最新净值: ${latestCount}), 耗时 ${elapsed}s`);
  return result;
}

// ==================== 构建QDII完整数据 ====================
async function buildQdiiData() {
  console.log('[QDII] 开始获取完整数据...');
  const startTime = Date.now();

  // 直接用 lx=6 获取QDII基金净值列表（天天基金QDII分类）
  const { items: qdiiNavList, showday } = await fetchFundNavList(6);
  console.log(`[QDII] 天天基金QDII净值列表: ${qdiiNavList.length} 只, showday: ${showday}`);

  if (qdiiNavList.length === 0) throw new Error('QDII净值数据为空');

  // 获取限额信息
  const limitedCodes = qdiiNavList
    .filter(f => f.purchaseStatusText.includes('限大额'))
    .map(f => f.code);

  const limitMap = await fetchPurchaseLimits(limitedCodes);
  console.log(`[QDII] 限额: ${Object.keys(limitMap).length} 只`);

  const result = qdiiNavList.map(f => {
    const purInfo = parsePurchaseFromText(f.purchaseStatusText);
    if (purInfo.purchaseStatus === '限大额' && limitMap[f.code]) {
      purInfo.purchaseLimit = limitMap[f.code];
    }

    return {
      code: f.code,
      name: f.name,
      type: 'QDII',
      nav: f.nav,
      navDate: f.navDate || null,
      navIsLatest: f.navIsLatest,
      navEstimated: null,
      dailyChange: f.navIsLatest ? f.navChangeRate : null, // 非最新净值不显示涨跌幅
      purchasable: purInfo.purchasable,
      purchaseStatus: purInfo.purchaseStatus,
      purchaseLimit: purInfo.purchaseLimit,
    };
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const latestCount = result.filter(f => f.navIsLatest).length;
  console.log(`[QDII] 完成! ${result.length} 只(最新净值: ${latestCount}), 耗时 ${elapsed}s`);
  return result;
}

// ==================== API: LOF 完整数据 ====================
app.get('/api/lof/full', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';

  // 非刷新：优先返回本地文件缓存
  if (!forceRefresh) {
    const cached = readCacheFile(LOF_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
      });
    }
  }

  // 正在加载中
  if (dataCache.lof.loading) {
    const cached = readCacheFile(LOF_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
        refreshing: true,
      });
    }
    // 等待加载完成
    const waitStart = Date.now();
    while (dataCache.lof.loading && Date.now() - waitStart < 90000) {
      await sleep(1000);
    }
    const freshCache = readCacheFile(LOF_CACHE_FILE);
    if (freshCache) {
      return res.json({ success: true, data: freshCache.data, cached: false, fetchDate: freshCache.fetchDate, fetchDateLocal: freshCache.fetchDateLocal });
    }
    return res.json({ success: false, error: '数据加载超时' });
  }

  try {
    dataCache.lof.loading = true;
    const data = await buildLofData();
    writeCacheFile(LOF_CACHE_FILE, data);
    dataCache.lof.time = Date.now();
    const cached = readCacheFile(LOF_CACHE_FILE);
    res.json({
      success: true,
      data,
      cached: false,
      fetchDate: cached?.fetchDate || new Date().toISOString(),
      fetchDateLocal: cached?.fetchDateLocal || new Date().toLocaleString('zh-CN'),
    });
  } catch (err) {
    console.error('[LOF] 获取失败:', err.message);
    const cached = readCacheFile(LOF_CACHE_FILE);
    if (cached) {
      return res.json({ success: true, data: cached.data, cached: true, fetchDate: cached.fetchDate, fetchDateLocal: cached.fetchDateLocal, error: err.message });
    }
    res.json({ success: false, error: err.message });
  } finally {
    dataCache.lof.loading = false;
  }
});

// ==================== API: QDII 完整数据 ====================
app.get('/api/qdii/full', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';

  // 非刷新：优先返回本地文件缓存
  if (!forceRefresh) {
    const cached = readCacheFile(QDII_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
      });
    }
  }

  // 正在加载中
  if (dataCache.qdii.loading) {
    const cached = readCacheFile(QDII_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
        refreshing: true,
      });
    }
    const waitStart = Date.now();
    while (dataCache.qdii.loading && Date.now() - waitStart < 180000) {
      await sleep(1000);
    }
    const freshCache = readCacheFile(QDII_CACHE_FILE);
    if (freshCache) {
      return res.json({ success: true, data: freshCache.data, cached: false, fetchDate: freshCache.fetchDate, fetchDateLocal: freshCache.fetchDateLocal });
    }
    return res.json({ success: false, error: '数据加载超时' });
  }

  try {
    dataCache.qdii.loading = true;
    const data = await buildQdiiData();
    writeCacheFile(QDII_CACHE_FILE, data);
    dataCache.qdii.time = Date.now();
    const cached = readCacheFile(QDII_CACHE_FILE);
    res.json({
      success: true,
      data,
      cached: false,
      fetchDate: cached?.fetchDate || new Date().toISOString(),
      fetchDateLocal: cached?.fetchDateLocal || new Date().toLocaleString('zh-CN'),
    });
  } catch (err) {
    console.error('[QDII] 获取失败:', err.message);
    const cached = readCacheFile(QDII_CACHE_FILE);
    if (cached) {
      return res.json({ success: true, data: cached.data, cached: true, fetchDate: cached.fetchDate, fetchDateLocal: cached.fetchDateLocal, error: err.message });
    }
    res.json({ success: false, error: err.message });
  } finally {
    dataCache.qdii.loading = false;
  }
});

// ==================== 基金收益率数据（排行接口） ====================
// 从天天基金排行接口批量获取所有基金的收益率数据
// 字段: [0]代码 [1]名称 [2]拼音 [3]日期 [4]单位净值 [5]累计净值
//        [6]日增长率 [7]近1周 [8]近1月 [9]近3月 [10]近6月 [11]近1年
//        [12]近2年 [13]近3年 [14]今年来 [15]成立来 [16]成立日期 ...
async function fetchAllYieldData() {
  console.log('[收益率] 开始批量获取...');
  const startTime = Date.now();
  const yieldMap = {};
  const pageSize = 20000; // 一次拿完

  const url = `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=rzdf&st=desc&pi=1&pn=${pageSize}&dx=1`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://fund.eastmoney.com/data/fundranking.html',
      },
    });
    const text = await resp.text();

    // 解析 var rankData = {datas:["...", "..."], ...}
    const match = text.match(/datas:\[([\s\S]*?)\],allRecords/);
    if (!match) throw new Error('收益率数据解析失败');

    const rawStr = match[1];
    // 每条记录是一个 "..." 字符串
    const rows = rawStr.match(/"([^"]*)"/g);
    if (!rows) throw new Error('收益率行数据为空');

    for (const row of rows) {
      const fields = row.replace(/^"|"$/g, '').split(',');
      if (fields.length < 16) continue;
      const code = fields[0];
      yieldMap[code] = {
        yieldDate: fields[3] || null,  // 数据日期
        nav: fields[4] ? parseFloat(fields[4]) : null,
        navAcc: fields[5] ? parseFloat(fields[5]) : null,
        dailyChange: fields[6] ? parseFloat(fields[6]) : null,
        week1: fields[7] ? parseFloat(fields[7]) : null,     // 近1周
        month1: fields[8] ? parseFloat(fields[8]) : null,    // 近1月
        month3: fields[9] ? parseFloat(fields[9]) : null,    // 近3月
        month6: fields[10] ? parseFloat(fields[10]) : null,  // 近6月
        year1: fields[11] ? parseFloat(fields[11]) : null,   // 近1年
        year2: fields[12] ? parseFloat(fields[12]) : null,   // 近2年
        year3: fields[13] ? parseFloat(fields[13]) : null,   // 近3年
        ytd: fields[14] ? parseFloat(fields[14]) : null,     // 今年来
        sinceInception: fields[15] ? parseFloat(fields[15]) : null, // 成立来
        inceptionDate: fields[16] || null,
      };
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[收益率] 完成! ${Object.keys(yieldMap).length} 只基金, 耗时 ${elapsed}s`);
  } catch (err) {
    console.error('[收益率] 获取失败:', err.message);
  }

  return yieldMap;
}

// API: 收益率数据
app.get('/api/yield', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';

  // 非刷新：优先返回本地文件缓存
  if (!forceRefresh) {
    const cached = readCacheFile(YIELD_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
      });
    }
  }

  try {
    const yieldMap = await fetchAllYieldData();
    if (Object.keys(yieldMap).length === 0) throw new Error('收益率数据为空');
    writeCacheFile(YIELD_CACHE_FILE, yieldMap);
    const cached = readCacheFile(YIELD_CACHE_FILE);
    res.json({
      success: true,
      data: yieldMap,
      cached: false,
      fetchDate: cached?.fetchDate || new Date().toISOString(),
      fetchDateLocal: cached?.fetchDateLocal || new Date().toLocaleString('zh-CN'),
    });
  } catch (err) {
    console.error('[收益率API] 失败:', err.message);
    const cached = readCacheFile(YIELD_CACHE_FILE);
    if (cached) {
      return res.json({ success: true, data: cached.data, cached: true, fetchDate: cached.fetchDate, fetchDateLocal: cached.fetchDateLocal, error: err.message });
    }
    res.json({ success: false, error: err.message });
  }
});

// ==================== 增强基金监控 ====================
// 从收益率数据中提取指定基金的完整字段
function extractFundYield(yieldMap, code, nameOverride) {
  const yld = yieldMap[code] || {};
  return {
    code,
    name: nameOverride || yld.name || code,
    nav: yld.nav || null,
    navAcc: yld.navAcc || null,
    yieldDate: yld.yieldDate || null,
    dailyChange: yld.dailyChange || null,
    week1: yld.week1 || null,
    month1: yld.month1 || null,
    month3: yld.month3 || null,
    month6: yld.month6 || null,
    year1: yld.year1 || null,
    year2: yld.year2 || null,
    year3: yld.year3 || null,
    ytd: yld.ytd || null,
    sinceInception: yld.sinceInception || null,
    inceptionDate: yld.inceptionDate || null,
  };
}

// 读取增强基金清单 + 收益率数据，返回完整监控信息
app.get('/api/enhance', async (req, res) => {
  try {
    // 1) 读取清单文件
    if (!fs.existsSync(ENHANCE_LIST_FILE)) {
      return res.json({ success: false, error: '增强基金清单文件不存在' });
    }
    const listData = JSON.parse(fs.readFileSync(ENHANCE_LIST_FILE, 'utf-8'));

    // 2) 获取收益率数据（优先缓存）
    let yieldMap = {};
    const yieldCache = readCacheFile(YIELD_CACHE_FILE);
    if (yieldCache && yieldCache.data) {
      yieldMap = yieldCache.data;
    } else {
      yieldMap = await fetchAllYieldData();
      if (Object.keys(yieldMap).length > 0) {
        writeCacheFile(YIELD_CACHE_FILE, yieldMap);
      }
    }

    // 3) 组装返回数据 — 包含跟踪指数基金行
    const groups = listData.groups.map(group => {
      // 跟踪指数基金（被动指数基金，用于对比）
      let trackFundData = null;
      if (group.trackFund && group.trackFund.code) {
        trackFundData = extractFundYield(yieldMap, group.trackFund.code, group.trackFund.name);
      }

      const funds = group.funds.map(fund => {
        const data = extractFundYield(yieldMap, fund.code, fund.name);
        data.note = fund.note || '';
        return data;
      });

      return {
        id: group.id,
        name: group.name,
        trackIndex: group.trackIndex,
        trackFund: trackFundData,
        funds,
      };
    });

    res.json({
      success: true,
      groups,
      yieldDate: yieldCache?.fetchDateLocal || new Date().toLocaleString('zh-CN'),
      cached: !!yieldCache,
    });
  } catch (err) {
    console.error('[增强基金API] 失败:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ==================== 基金历史净值（用于收益率趋势对比） ====================
// 从天天基金获取指定基金的历史净值数据（支持分页，每页最多20条）
async function fetchFundHistory(code, days = 90) {
  try {
    const allItems = [];
    const maxPages = Math.ceil(days / 20) + 1;

    for (let page = 1; page <= maxPages; page++) {
      const url = `https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=${page}&pageSize=20&startDate=&endDate=`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html`,
        },
        timeout: 15000,
      });
      const text = await resp.text();
      const jsonStr = text.replace(/^jQuery\(/, '').replace(/\);?\s*$/, '');
      const json = JSON.parse(jsonStr);

      if (!json.Data || !json.Data.LSJZList || json.Data.LSJZList.length === 0) break;

      const items = json.Data.LSJZList.map(item => ({
        date: item.FSRQ,
        nav: item.DWJZ ? parseFloat(item.DWJZ) : null,
        change: item.JZZZL ? parseFloat(item.JZZZL) : null,
      })).filter(item => item.nav != null);

      allItems.push(...items);

      // 检查是否已经获取足够数据
      if (allItems.length >= days) break;
      if (json.Data.LSJZList.length < 20) break; // 最后一页

      // 避免请求过快
      if (page < maxPages) await sleep(80);
    }

    // 按日期升序（API返回的是降序）
    allItems.reverse();
    return allItems;
  } catch (err) {
    console.error(`[历史净值] ${code} 获取失败:`, err.message);
    return [];
  }
}

// API: 获取多只基金的历史净值，用于收益率趋势对比
app.get('/api/fund/history', async (req, res) => {
  try {
    const codes = (req.query.codes || '').split(',').filter(Boolean);
    const period = req.query.period || 'month3'; // month1, month3, month6, year1, ytd, year3
    if (codes.length === 0 || codes.length > 5) {
      return res.json({ success: false, error: '请提供1-5个基金代码' });
    }

    // 根据 period 计算需要多少个交易日的数据
    const daysMap = {
      month1: 25,
      month3: 70,
      month6: 130,
      year1: 255,
      ytd: 255,
      year3: 760,
    };
    const days = daysMap[period] || 100;

    // 并行获取所有基金的历史净值
    const results = await Promise.all(
      codes.map(async code => {
        const history = await fetchFundHistory(code, days);
        return { code, history };
      })
    );

    // 将净值数据转换为以第一天为基准的累计收益率
    const now = new Date();
    let startDate;
    if (period === 'ytd') {
      startDate = `${now.getFullYear()}-01-01`;
    } else {
      const ms = {
        month1: 31 * 86400000,
        month3: 92 * 86400000,
        month6: 183 * 86400000,
        year1: 366 * 86400000,
        year3: 1096 * 86400000,
      };
      const d = new Date(now.getTime() - (ms[period] || ms.month3));
      startDate = d.toISOString().slice(0, 10);
    }

    const seriesMap = {};
    for (const { code, history } of results) {
      // 过滤到 startDate 之后的数据
      const filtered = history.filter(h => h.date >= startDate);
      if (filtered.length === 0) {
        seriesMap[code] = [];
        continue;
      }
      const baseNav = filtered[0].nav;
      seriesMap[code] = filtered.map(h => ({
        date: h.date,
        returnRate: ((h.nav - baseNav) / baseNav * 100),
      }));
    }

    res.json({
      success: true,
      period,
      startDate,
      series: seriesMap,
    });
  } catch (err) {
    console.error('[历史净值API] 失败:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ==================== 股指期货贴水监控 ====================

// 四大股指期货品种配置
const FUTURES_CONFIG = {
  IC: { name: '中证500股指期货', index: '中证500', indexCode: 'sh000905', multiplier: 200, margin: 0.12 },
  IF: { name: '沪深300股指期货', index: '沪深300', indexCode: 'sh000300', multiplier: 300, margin: 0.12 },
  IH: { name: '上证50股指期货',  index: '上证50',  indexCode: 'sh000016', multiplier: 300, margin: 0.12 },
  IM: { name: '中证1000股指期货', index: '中证1000', indexCode: 'sh000852', multiplier: 200, margin: 0.12 },
};

// 生成当前可能存在的合约月份代码（当月、下月、下两个季月）
function getActiveContractMonths() {
  const now = new Date();
  const y = now.getFullYear() % 100; // 2位年份
  const m = now.getMonth() + 1; // 1-12
  const contracts = [];

  // 当月合约
  contracts.push(`${String(y).padStart(2,'0')}${String(m).padStart(2,'0')}`);
  // 下月合约
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  contracts.push(`${String(ny).padStart(2,'0')}${String(nm).padStart(2,'0')}`);

  // 接下来两个季月（3/6/9/12月）
  const quarterMonths = [3, 6, 9, 12];
  let found = 0;
  let checkM = nm;
  let checkY = ny;
  for (let i = 0; i < 12 && found < 2; i++) {
    checkM++;
    if (checkM > 12) { checkM = 1; checkY++; }
    if (quarterMonths.includes(checkM)) {
      contracts.push(`${String(checkY).padStart(2,'0')}${String(checkM).padStart(2,'0')}`);
      found++;
    }
  }
  return contracts;
}

// 从新浪获取股指期货合约行情（新版接口 nf_ 前缀）
async function fetchFuturesQuotes(variety, months) {
  const results = [];
  const tickers = months.map(m => `nf_${variety}${m}`);
  const url = `https://hq.sinajs.cn/list=${tickers.join(',')}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://finance.sina.com.cn/',
      },
      timeout: 10000,
    });
    const buf = await resp.buffer();
    const text = iconv.decode(buf, 'gbk');

    // 解析每行
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      // var hq_str_nf_IC2604="7880.000,7900.000,...,2026-03-20,15:00:00,...,中证500指数期货2604";
      const m = line.match(/hq_str_nf_([A-Z]+)(\d{4})="([^"]*)"/);
      if (!m || !m[3]) continue;
      const [, v, month, data] = m;
      const fields = data.split(',');
      if (fields.length < 30) continue; // 新版接口字段数较多

      // 新版接口字段映射：
      // [0]开盘  [1]最高  [2]最低  [3]最新价  [4]成交量(手)
      // [5]成交额  [6]持仓量  [7]收盘价  [8]?(0)  [9]涨停价
      // [10]跌停价  [11]?(0)  [12]?(0)  [13]昨收  [14]昨结
      // [15]?  [16]买一价  [17]买一量  ...  [26]卖一价  [27]卖一量
      // ... [35]日期(2026-03-20) [36]时间(15:00:00) ... 
      // 倒数第1个字段: 品种名称

      const latestPrice = parseFloat(fields[3]);
      if (!latestPrice || latestPrice <= 0) continue; // 已退市或无数据

      // 从末尾倒数找日期和品种名（日期格式 YYYY-MM-DD）
      let dateStr = null;
      let contractName = fields[fields.length - 1] || '';
      for (let i = 30; i < fields.length; i++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(fields[i])) { dateStr = fields[i]; break; }
      }

      results.push({
        variety: v,
        contractMonth: month,
        contractCode: `${v}${month}`,
        name: contractName,
        open: parseFloat(fields[0]) || null,
        high: parseFloat(fields[1]) || null,
        low: parseFloat(fields[2]) || null,
        lastPrice: latestPrice,
        prevClose: parseFloat(fields[13]) || null,
        prevSettle: parseFloat(fields[14]) || null,
        bidPrice: parseFloat(fields[16]) || null,
        askPrice: parseFloat(fields[26]) || null,
        bidVol: parseInt(fields[17]) || 0,
        askVol: parseInt(fields[27]) || 0,
        openInterest: parseFloat(fields[6]) ? Math.round(parseFloat(fields[6])) : 0,
        volume: parseInt(fields[4]) || 0,
        settle: parseFloat(fields[7]) || null, // 当日结算价
        date: dateStr,
      });
    }
  } catch (err) {
    console.error(`[期货行情] ${variety} 获取失败:`, err.message);
  }
  return results;
}

// 从腾讯财经获取现货指数点位
async function fetchIndexQuotes(codes) {
  const indexMap = {};
  try {
    const queryStr = codes.join(',');
    const url = `https://qt.gtimg.cn/q=${queryStr}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    });
    const buf = await resp.buffer();
    const text = iconv.decode(buf, 'gbk');

    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/v_(sh\d{6})="([^"]*)"/);
      if (m && m[2]) {
        const fields = m[2].split('~');
        if (fields.length > 5 && fields[3] && parseFloat(fields[3]) > 0) {
          indexMap[m[1]] = {
            name: fields[1],
            price: parseFloat(fields[3]),
            prevClose: parseFloat(fields[4]) || null,
            change: fields[32] ? parseFloat(fields[32]) : null,
            changeRate: fields[32] ? ((parseFloat(fields[3]) - parseFloat(fields[4])) / parseFloat(fields[4]) * 100) : null,
          };
        }
      }
    }
  } catch (err) {
    console.error('[指数行情] 获取失败:', err.message);
  }
  return indexMap;
}

// 计算合约到期日（股指期货到期日为合约月份第三个周五）
function getExpiryDate(contractMonth) {
  const year = 2000 + parseInt(contractMonth.slice(0, 2));
  const month = parseInt(contractMonth.slice(2, 4)) - 1; // 0-based
  const d = new Date(year, month, 1);
  // 找到第三个周五
  let fridayCount = 0;
  while (fridayCount < 3) {
    if (d.getDay() === 5) fridayCount++;
    if (fridayCount < 3) d.setDate(d.getDate() + 1);
  }
  return d;
}

// 计算剩余自然天数
function getDaysToExpiry(contractMonth) {
  const expiry = getExpiryDate(contractMonth);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

// 风险评估
function assessRisk(annualizedReturn, daysToExpiry, discountRate, indexValuationPct) {
  const warnings = [];
  let riskLevel = 'low'; // low | medium | high | extreme

  // 1. 年化收益过高（可能意味着市场恐慌或流动性问题）
  if (Math.abs(annualizedReturn) > 30) {
    warnings.push({ type: 'high_annualized', msg: `年化贴水率 ${annualizedReturn > 0 ? '+' : ''}${annualizedReturn.toFixed(1)}% 异常偏高，市场可能存在极端情绪` });
    riskLevel = 'high';
  } else if (Math.abs(annualizedReturn) > 20) {
    warnings.push({ type: 'elevated_annualized', msg: `年化贴水率偏高（${annualizedReturn.toFixed(1)}%），需注意市场波动风险` });
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  // 2. 合约临近到期（流动性风险）
  if (daysToExpiry <= 3 && daysToExpiry > 0) {
    warnings.push({ type: 'near_expiry', msg: `距交割仅 ${daysToExpiry} 天，需立即换仓或平仓！流动性急剧下降` });
    riskLevel = 'extreme';
  } else if (daysToExpiry <= 7) {
    warnings.push({ type: 'expiry_warning', msg: `距交割 ${daysToExpiry} 天，即将到期，建议关注换仓时机` });
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  // 3. 升水情况（期货价高于现货）
  if (discountRate > 0.5) {
    warnings.push({ type: 'premium', msg: `当前为升水状态（+${discountRate.toFixed(2)}%），滚动持有将产生负收益（基差损耗）` });
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  // 4. 杠杆风险（固定提醒）
  if (riskLevel === 'low' && warnings.length === 0) {
    warnings.push({ type: 'leverage_reminder', msg: '股指期货自带杠杆，请确保账户保证金充足，严格控制仓位' });
  }

  // 5. 贴水收益过低（不值得操作）
  if (Math.abs(annualizedReturn) < 3 && discountRate <= 0) {
    warnings.push({ type: 'low_return', msg: `年化贴水率仅 ${annualizedReturn.toFixed(1)}%，接近无风险利率，操作性价比低` });
  }

  return { riskLevel, warnings };
}

// 缓存
const FUTURES_CACHE_FILE = path.join(CACHE_DIR, 'futures.json');

// API: 股指期货贴水监控
app.get('/api/futures/discount', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';

  // 非刷新时返回缓存
  if (!forceRefresh) {
    const cached = readCacheFile(FUTURES_CACHE_FILE);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        fetchDate: cached.fetchDate,
        fetchDateLocal: cached.fetchDateLocal,
      });
    }
  }

  try {
    console.log('[期货贴水] 开始获取数据...');
    const startTime = Date.now();
    const months = getActiveContractMonths();
    console.log(`[期货贴水] 活跃合约月份: ${months.join(', ')}`);

    // 1) 获取所有品种的合约行情
    const varieties = Object.keys(FUTURES_CONFIG);
    const allQuotes = [];
    for (const v of varieties) {
      const quotes = await fetchFuturesQuotes(v, months);
      allQuotes.push(...quotes);
      if (quotes.length > 0) await sleep(100);
    }
    console.log(`[期货贴水] 获取到 ${allQuotes.length} 个合约行情`);

    // 2) 获取对应现货指数
    const indexCodes = [...new Set(varieties.map(v => FUTURES_CONFIG[v].indexCode))];
    const indexMap = await fetchIndexQuotes(indexCodes);
    console.log(`[期货贴水] 获取到 ${Object.keys(indexMap).length} 个指数行情`);

    // 3) 判断数据是否过期（非当日数据）
    //    交易日: 工作日 9:15~15:00，盘前竞价 9:15 开始
    //    如果当前时间已过 9:15 但数据日期不是今天 → 过期数据
    //    如果当前时间在 0:00~9:15 → 只能拿到昨天收盘数据，标记为过期
    //    周末/节假日 → 只能拿到最近交易日数据，标记为过期
    const nowTime = new Date();
    const todayStr = nowTime.toISOString().slice(0, 10); // YYYY-MM-DD
    const isWeekend = nowTime.getDay() === 0 || nowTime.getDay() === 6;
    const hour = nowTime.getHours();
    const minute = nowTime.getMinutes();
    const isPreMarket = hour < 9 || (hour === 9 && minute < 15); // 09:15 前
    const isPostMarket = hour >= 15 && minute >= 1; // 15:01 后

    // 4) 计算贴水数据
    const result = varieties.map(v => {
      const config = FUTURES_CONFIG[v];
      const indexData = indexMap[config.indexCode] || {};
      const indexPrice = indexData.price || null;

      const contracts = allQuotes
        .filter(q => q.variety === v)
        .sort((a, b) => a.contractMonth.localeCompare(b.contractMonth))
        .map(q => {
          const daysToExpiry = getDaysToExpiry(q.contractMonth);
          const tradingDaysToExpiry = Math.round(daysToExpiry * 5 / 7); // 粗略交易日
          const expiryDate = getExpiryDate(q.contractMonth);

          // 贴水点数 = 期货价 - 现货指数点位（负值为贴水）
          const discountPoints = indexPrice ? (q.lastPrice - indexPrice) : null;
          // 贴水率 = (期货价 - 现货) / 现货 * 100
          const discountRate = indexPrice ? ((q.lastPrice - indexPrice) / indexPrice * 100) : null;
          // 年化贴水率 = 贴水率 / 剩余天数 * 365
          const annualizedReturn = (discountRate !== null && daysToExpiry > 0)
            ? (discountRate / daysToExpiry * 365 * -1)  // 取反：贴水为负，但对做多者来说是正收益
            : null;

          // 1手所需保证金
          const marginPerLot = q.lastPrice * config.multiplier * config.margin;
          // 1手到期贴水收益（如果基差完全收敛）
          const profitPerLot = discountPoints !== null ? (discountPoints * -1 * config.multiplier) : null;

          // 风险评估
          const risk = (annualizedReturn !== null)
            ? assessRisk(annualizedReturn, daysToExpiry, discountRate, null)
            : { riskLevel: 'unknown', warnings: [] };

          const expired = daysToExpiry <= 0;

          // 判断升水/贴水/平水状态
          let discountStatus = 'flat'; // flat | discount | premium
          if (discountRate !== null) {
            if (discountRate < -0.01) discountStatus = 'discount';     // 贴水（期货<现货）
            else if (discountRate > 0.01) discountStatus = 'premium';  // 升水（期货>现货）
          }

          // 判断数据是否过期: 行情日期不等于今天 → stale
          const quoteDate = q.date || null;
          let isStale = false;
          if (quoteDate && quoteDate !== todayStr) {
            isStale = true; // 数据不是今天的
          } else if (!quoteDate) {
            isStale = true; // 无日期信息，保守标记
          }
          // 如果是周末或盘前，stale 属于预期行为，但仍需标识
          const staleReason = isStale
            ? (isWeekend ? '非交易日' : isPreMarket ? '盘前' : isPostMarket ? '盘后' : '数据延迟')
            : null;

          return {
            ...q,
            expiryDate: expiryDate.toISOString().slice(0, 10),
            daysToExpiry,
            tradingDaysToExpiry,
            expired,
            discountPoints: discountPoints !== null ? Math.round(discountPoints * 100) / 100 : null,
            discountRate: discountRate !== null ? Math.round(discountRate * 10000) / 10000 : null,
            annualizedReturn: annualizedReturn !== null ? Math.round(annualizedReturn * 100) / 100 : null,
            marginPerLot: Math.round(marginPerLot),
            profitPerLot: profitPerLot !== null ? Math.round(profitPerLot) : null,
            risk,
            discountStatus,
            isStale,
            staleReason,
            quoteDate,
          };
        });

      return {
        variety: v,
        name: config.name,
        indexName: config.index,
        indexCode: config.indexCode,
        multiplier: config.multiplier,
        marginRatio: config.margin,
        indexPrice: indexPrice,
        indexChange: indexData.changeRate || null,
        contracts,
      };
    });

    // 写缓存
    writeCacheFile(FUTURES_CACHE_FILE, result);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[期货贴水] 完成! ${allQuotes.length} 个合约, 耗时 ${elapsed}s`);

    const cached = readCacheFile(FUTURES_CACHE_FILE);
    res.json({
      success: true,
      data: result,
      cached: false,
      fetchDate: cached?.fetchDate || new Date().toISOString(),
      fetchDateLocal: cached?.fetchDateLocal || new Date().toLocaleString('zh-CN'),
    });
  } catch (err) {
    console.error('[期货贴水] 失败:', err.message);
    const cached = readCacheFile(FUTURES_CACHE_FILE);
    if (cached) {
      return res.json({ success: true, data: cached.data, cached: true, fetchDate: cached.fetchDate, fetchDateLocal: cached.fetchDateLocal, error: err.message });
    }
    res.json({ success: false, error: err.message });
  }
});

// ==================== 通用代理 ====================
app.get('/api/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: 'URL required' });
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://fund.eastmoney.com/',
      }
    });
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('json')) {
      res.json(await response.json());
    } else {
      const buf = await response.buffer();
      const text = (ct.includes('gbk') || ct.includes('gb2312'))
        ? iconv.decode(buf, 'gbk') : buf.toString('utf-8');
      res.set('Content-Type', 'text/plain; charset=utf-8').send(text);
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 启动
app.listen(PORT, () => {
  console.log(`\n  LOF基金溢价率监控系统已启动`);
  console.log(`  访问地址: http://localhost:${PORT}\n`);
});

# FundScope PRO

LOF 溢价监控 · QDII 额度追踪 · 增强基金监控 · 期货贴水监控

## 快速启动

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

浏览器打开 [http://localhost:3456](http://localhost:3456)

## 功能概览

| 页面 | 说明 |
|------|------|
| LOF 溢价监控 | 实时溢价率、申购状态、净值/市价对比 |
| QDII 额度追踪 | 限额/暂停申购标识、纳斯达克/标普筛选 |
| 增强基金监控 | 分组/平铺视图、跟踪指数对比、趋势图 |
| 期货贴水监控 | 年化贴水率、5维风险评估、合约到期提醒 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: Vanilla HTML / CSS / JS（无框架）
- **图表**: Chart.js
- **数据源**: 天天基金、腾讯财经、新浪财经

## 项目结构

```
├── server.js          # Express 后端，7 个 API 路由
├── public/
│   ├── index.html     # 四页面 SPA
│   ├── app.js         # 前端逻辑
│   └── style.css      # 双主题样式系统
├── data/
│   └── enhance.json   # 增强基金分组配置（手动维护）
└── package.json
```

> `data/` 下其余 JSON 文件为运行时缓存，首次启动后自动生成，已在 `.gitignore` 中排除。

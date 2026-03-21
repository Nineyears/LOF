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

## 服务器部署

使用 PM2 进行进程管理。

| 配置 | 值 |
|------|------|
| 项目路径 | `/root/data/LOF` |
| 进程名 | `fundscope-pro` |
| 端口 | 3456 |

### PM2 服务管理

```bash
# 查看服务状态
pm2 list

# 启动服务
pm2 start server.js --name fundscope-pro

# 重启服务
pm2 restart fundscope-pro

# 停止服务
pm2 stop fundscope-pro

# 查看实时日志
pm2 logs fundscope-pro

# 查看最近 N 行日志
pm2 logs fundscope-pro --lines 50

# CPU/内存实时监控
pm2 monit
```

- **崩溃自动重启**: PM2 默认开启，进程异常退出后自动拉起
- **开机自启**: 已通过 `pm2 save` + `pm2 startup` 配置，服务器重启后服务自动恢复

### 代码更新流程

```bash
# 本地提交推送
git add -A && git commit -m "feat: ..." && git push

# SSH 到服务器拉取并重启
cd /root/data/LOF
git pull origin main
pm2 restart fundscope-pro
```

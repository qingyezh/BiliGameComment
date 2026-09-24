# 2026-09-22 跨游戏方案 3 + 全图导出 执行计划

## 目标
1. P0 确认后端语法/导入
2. 前端完整接入 `/api/cross/dist`（方向 / 源档 / 日月 / 三曲线 / 图例）
3. 所有图表 CSV + PNG，按钮统一卡片右下
4. 跨游戏删除「每人一行」明细表（方案 A），主图为方案 3 占比曲线
5. `npm run build` + 重启 8788
6. 更新 version.md / README / AGENTS

## P0 核查
- [x] `node --check lib/analyze.js` 通过
- [x] `node --check analyze-server.js` 通过
- [x] `buildCrossDist` 已 import，`/api/cross/dist` 路由存在

## 待办
- [x] App.vue：声明 `crossDistChart`，`runAll` 调用 `loadCrossDist`
- [x] App.vue：方向 A↔B、源档差/中/好 UI + 重载（watch）
- [x] App.vue：方案 3 图表卡片 + CSV/PNG
- [x] App.vue：移除每人一行明细表
- [x] App.vue：全图导出按钮移至卡片右下，补齐缺失 CSV
- [x] build + 冒烟（107800 vs 108434，overlap=15882，periods=57）
- [x] 文档
- [x] 评分轨迹页：周期评价数量图（局部 + 累计，v0.1.1.0）
- [x] 评价数量图双轴（局部左 / 累计右，v0.1.2.0）
- [x] 关键词：未命中→全部、相关度左下角（v0.1.2.0）

## 口径
- 分档：0–4 差 / 6 中 / 8–10 好（`bucketGrade`）
- 人群：共同 uid；源档筛选后看目标三档占比
- 图例点击显隐：`js/charts.js` 已支持

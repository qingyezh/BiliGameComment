# 采集台体验与增量统计计划

## 已完成
1. **已存数据列表** 只显示数字 gameId，过滤 `_cache` / `_done` / `_failed` / `_queue`
2. **去掉评论浏览** UI 与 `loadComments` 轮询
3. **app.js 语法修复**（boot 作用域），8787 API 恢复

## 会话增量均分（下一步）
- 口径：仅统计**本次启动后**入库的数据
- 算法：`n += k; sum += Σgrade`，`avg = sum / n`（禁止全量重算）
- 落点：
  - `lib/store.js` 增加 `session-stats.json`（n, sum, startAt）
  - `ingest-daemon` 入库时累加并写 timeline 采样
  - `/api/stats` 的均分读 session avg
  - `/api/timeline` 只返回 `startAt` 之后的采样
- 均分变化图：只画本次启动后的采样点

## 验收
- 列表无临时目录
- 无评论浏览区块
- 重启前后均分重置；爬取中新评论只做加和

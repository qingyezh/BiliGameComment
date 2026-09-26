# 2026-09-25 采集台开始/停止按钮状态

## 现象

点「开始采集」后「停止」一直禁用点不了，「开始」却还能再点并重复发令。

## 根因

1. **`/api/crawl/status` 未带 `gameId`**，服务端回落 `defaultGameId=103496`。
   实际在爬 107800 时，状态一直是 103496 的 `stopped` → `running=false` → 停止键禁用。
2. **`tick`/`refreshStatus` 在表单获焦点时整段跳过**，按钮状态长期不刷新。
3. **`startCrawl` 无乐观锁定**，可连续点击写入多个 `jobId` 的 `_cmd.json`（日志里多次「开始」）。
4. 服务端 `running` 启发式未校验 `cmd.gameId` 是否当前游戏。

## 修复

| 位置 | 改动 |
| ---- | ---- |
| `src/web/app.js` | `refreshStatus` 带上 `gameId()`；`tick` 不再因表单焦点跳过状态 |
| | `setRunningUI`：开始/停止互斥；start/stop 请求中 `crawlBusy` 防重入 + 乐观锁键 |
| | `applyStatus` 补空节点防护（防 DOM 未挂时抛错） |
| `src/server.js` | `running`：runtime `running`，或 `cmd.action=start` 且 `cmd.gameId` 匹配且 runtime 非终态 |

## 验证

- `node --check` app.js / server.js 通过
- `/api/crawl/status?gameId=107800` 返回正确 gameId
- 刷新页面后：点开始 → 开始禁用、停止可点；点停止 → 恢复可开始

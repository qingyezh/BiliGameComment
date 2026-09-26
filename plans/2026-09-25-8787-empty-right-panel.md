# 2026-09-25 采集台右侧空白 / 预览无响应

## 现象

`http://127.0.0.1:8787/` API 角标「已连接」，但右侧整块空白；点「预览」无反应。

## 根因

1. **`src/web/index.html` 缺失整个右栏 `.main`**（进度环、数据概况、趋势、日志）。
   `app.js` 里的 `#statusDot` `#gradeChart` `#log` 等 20 个节点不存在。
2. **`bindEvents()` 只定义、从未调用**，`#btnPreview` 等按钮根本没有 `onclick`。
   `bindEvents` 里还有 `$("#btnClearLog")`，节点缺失时会直接抛错。

## 修复

| 位置 | 改动 |
| ---- | ---- |
| `src/web/index.html` | 按 `style.css` / `app.js` 补全 `.main` 右栏（进度环+指标、星级分布、均分趋势、日志） |
| `src/web/app.js` | `boot()` 先 `bindEvents()`；绑定改为存在才挂；`logLine` 空节点直接返回 |

## 验证

- `node scripts/check-dom-ids.mjs`：missing (none)
- 页面已含 `statusDot` / `gradeChart` / `log` / `btnPreview`
- `/api/game/preview?gameId=103496` → 200

# B站游戏评论采集控制台

全量采集 [biligame](https://www.biligame.com/detail/?id=103496) 游戏主评论（不含楼中楼），Web 控制启停、进度、统计与导出。

## 快速开始

```powershell
node server.js
```

浏览器打开 <http://127.0.0.1:8787> 。控制台页面每 **0.5s** 自动刷新状态与统计。

采集模式：

| 模式 | 行为 |
|------|------|
| 全量续爬 | 从 `state/full.cursor.json` 断点继续 |
| 全量重来 | 忽略游标，从第 1 页扫（仍按 comment_no 去重） |
| 增量更新 | 从第 1 页收新评论；最近 50 条 ≥45 条已入库则自动停 |

限速：**≥800ms + 0–400ms 随机抖动**。同一时刻只跑一个游戏。断点按游戏存放在 `data/<gameId>/state/`。

1. 填入 **Game ID**（原神 `103496`），点「预览」核对游戏。
2. 粘贴浏览器 Cookie（至少含 `SESSDATA`、`buvid3`），点「保存到本地」。
3. 可先勾选「试跑页数」验证，再跑全量。
4. 点「开始全量采集」；随时可「停止」。断点续爬默认开启。

### 随爬随存 / 更新

- 每页新评论立刻追加进 `comments.jsonl` 并 fsync，每页写 `meta.json` 断点；进程崩溃最多丢当前页。
- **增量更新**：取消「断点续爬」后从第 1 页重扫，按 `comment_no` 去重只追加新评论；默认开启「大量重复自动停」（最近 50 条 ≥45 条已在库则停），避免空扫历史页。
- 库中已有 `comment_no` 不会重复写入。

## 数据落盘

| 文件 | 说明 |
|------|------|
| `data/<gameId>/comments.jsonl` | 每行一条主评论（无楼中楼；含 crawled_at / source_page） |
| `data/<gameId>/game.json` | 游戏信息、总评分快照 |
| `data/<gameId>/state/full.cursor.json` | 全量续爬断点 |
| `data/<gameId>/state/update.cursor.json` | 增量更新断点 |
| `data/<gameId>/state/grade-timeline.jsonl` | 每 10s 均分采样（用于趋势图） |
| `data/<gameId>/jobs/*.json` | 任务历史 |
| `data/<gameId>/comments.csv` | 导出 CSV |
| `logs/crawl-YYYY-MM-DD.log` | 运行日志（另有 .jsonl） |

## 评论字段

`game_base_id, comment_no, uid, user_name, user_level, user_official_verify_*, grade, publish_time, content, device_type, up_count, down_count, reply_count, report_status, evaluate_status, mark_hot_list, hot_recall, play_duration, play_duration_text`

## 接口说明（逆向）

- 列表：`GET https://line3-h5-pc-api.biligame.com/game/comment/page`
- 参数：`game_base_id, rank_type, page_num, page_size(≤20), mark_hot_filter_list, hit_mark_hot_exp, sdk_type=11` + 签名
- 签名：`ts, request_id(32), appkey=h9Ejat5tFh81cq8V, sign=md5(qs+salt)`
- 汇总：`/game/comment/summary`；详情：`/game/detail/gameinfo`、`/game/detail/comment/gameinfo`

## 分析端

```powershell
npm run analyze   # 分析服务 8788（只读 data/）
npm run build     # Vite 构建 → dist/
npm run dev       # 开发服 5173，代理 /api → 8788
```

浏览器打开 <http://127.0.0.1:8788>（或经构建后的 `dist/analyze.html`）。

| Tab | 内容 |
|-----|------|
| 评分轨迹 | 周期局部/累计均分、评价数量（局部左轴/累计右轴）、KPI、星级分布；CSV + PNG |
| 因子交叉 | 游玩时长（0/1-30/31-365/366+）/等级/字数/终端（安卓/苹果/PC/其他）× 周期均分，图例升序；CSV + PNG |
| 关键词趋势 | 命中/全部/Δ、命中率；左下角相关度（10−√ΣΔ²）；序列 CSV + PNG |
| 跨游戏对比 | 共同 uid 均分曲线；**方案3** 源档→目标三档占比（方向 A↔B、源档差/中/好、日/月）；CSV + PNG |

导出按钮统一在卡片**右下角**。跨游戏不展示「每人一行」明细表，主图为方案3占比曲线。

`GET /api/cross/dist`：`gameId`、`gameId2`、`sourceGame`、`targetGame`、`sourceBucket`（neg/mid/pos）、`grain`（month/day）→ `periods[]` 每期 `n` 与 `neg`/`mid`/`pos` 占比。

## 注意

- 请文明采集：默认间隔 350ms/页，失败会退避重试；连续 8 次失败自动停。
- Cookie 保存在本机 `config.local.json`，请勿提交到公开仓库。
- 仅供个人学习与分析，请遵守 B 站服务条款与当地法规。

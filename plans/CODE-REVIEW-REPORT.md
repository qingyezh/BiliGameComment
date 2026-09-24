# 代码审查报告（逻辑问题专项）

**项目：** B 站游戏中心主评论采集 + 分析  
**范围：** `src/` 全量（daemon / server / lib / web / ui / analyze-rs）、`scripts/*.ps1`、`vite.config.js`、`package.json`  
**方式：** 只读静态审查，对照项目语义（mapGrade、跨游戏方案 3、因子分档、词频、缓存、限速、断点）  
**日期：** 2026-09-24

---

## 结论摘要

本次审查在**分析口径一致性**和**构建/路径装配**上发现多处会直接改变统计结果或导致「改了代码但页面不变」的逻辑问题。最严重的是：① Vite 产物目录与分析服务静态目录不一致，`npm run build` 后服务的仍是旧 UI；② 跨游戏「方案 3」（0–4 差 / 6 中 / 8–10 好，固定源档 + 目标三档占比）在前后端均未实现，当前是二分四格 pp/pn/np/nn；③ 游玩时长分档存在 JS / Rust / FACTOR_ORDER 三套互斥口径；④ 采集台均分把 0 分剔除，与「0 计入均分」及分析端/Rust 相反。建议优先修 P0 四条，再统一 mapGrade / 分档 / 关键词 / cum_avg 的 JS–Rust 对照，最后补齐 daemon 断点与缓存边界。

---

## P0（结果错误或交付物不可用）

### P0-1 Vite `outDir` 与 analyze-server 静态根不一致，构建产物不在服务目录

- **文件:行号**
  - `vite.config.js:12`（`outDir: "../app/dist"`）
  - `src/analyze-server.js:28`（`ROOT = .../app`）
  - `src/analyze-server.js:430-434`（服务 `ROOT/dist/...`）
  - `src/lib/paths.js:6-11`（`APP_ROOT = <project>/app`，`DIST_DIR = APP_ROOT/dist`）
- **现象**  
  以项目根执行 `vite build` 时，`outDir` 相对 **vite root（=项目根）** 解析为**项目外** `preoject/app/dist`。分析服只读 **项目内** `B站游戏评论/app/dist`。实测两处 dist 并存：
  - `B站游戏评论/app/dist`：`analyze.html` + `assets/analyze-BHcUgdin.*`（2026-09-23，旧）
  - `preoject/app/dist`：`src/web/analyze.html` + `assets/analyze-B1xNQrCa.*`（2026-09-24，新构建）
- **为什么是逻辑问题**  
  「前端重构后 build → 刷新页面」的闭环断裂：源码改了、build 成功，8788 仍吐旧 bundle；且两处 HTML 入口路径形态不同（`dist/analyze.html` vs `dist/src/web/analyze.html`），serveStatic 的双候选恰好掩盖了错误。
- **建议改法**  
  统一为项目内 `APP_ROOT/dist`：`vite.config.js` 改为 `outDir: "app/dist"`（或 `path.resolve(__dirname, "app/dist")`），并 `emptyOutDir: true`。构建后删掉项目外 `preoject/app/dist`，避免误用。`paths.js` / `rust-analyze.js` / `analyze-server.js` 的 `app` 根保持不变。

### P0-2 跨游戏「方案 3」未实现：无差/中/好三档、无固定源档、无目标三档占比曲线

- **文件:行号**
  - 产品口径：`AGENTS.md` §四（分档 0–4 差 / 6 中 / 8–10 好；源档可选；目标三档占比）
  - `src/lib/cross-dist.js:24-44,55-89`（仅 `pos = avg>=8` 二分，四格 pp/pn/np/nn）
  - `src/tools/analyze-rs/src/main.rs:402-510`（同上，`src_pos` 仅 `avg>=8`）
  - `src/analyze-server.js:349-374`（`/api/cross/dist` 只回四格，**无 `sourceBucket`**）
  - `src/ui/App.vue:65-72,128-162`（图例写死「好→好/好→差/差→好/差→差」四条，中评被并入「差」）
- **现象**  
  UI 文案自承：`源好评均分≥8 / 源差评<8 · 目标好=8–10 差=0–6`。`grade=6`（中评）与 `0–4` 同属 th=0；源侧也无「打到差/中/好档」筛选，只有「源游戏均分是否 ≥8」。
- **为什么是逻辑问题**  
  与已确认的产品方案直接冲突：三条「目标游戏差/中/好占比（每期约 100%）」无法从当前 API 还原；固定源档（差/中/好）无法切换；中评被系统性并入差评，目标「差」占比被高估。
- **建议改法**  
  1. 分档函数统一为三档：`neg: mapGrade∈{0,2,4}`，`mid: {6}`，`pos: {8,10}`（或 0–4 / 6 / 8–10）。  
  2. 源侧按「该 uid 在源游戏落到所选源档」过滤（建议：该 uid 源游戏主档 = 众数档或均分所在档，需在文档写死一种）。  
  3. 目标侧每期输出 `neg_ratio + mid_ratio + pos_ratio`（分母 = 共同 uid 且目标评论落在当期）。  
  4. API 增加 `sourceBucket=neg|mid|pos`；前端三条曲线 + 源档选择；四格/卡方可保留为附加视图。  
  5. JS（`buildCrossDist`）与 Rust 同步改，避免又出现双口径。

### P0-3 游玩时长分档三套口径互斥（JS / Rust / FACTOR_ORDER）

- **文件:行号**
  - `src/lib/analyze.js:67-73` `playBucket` → `"0" | "1-30" | "31-365" | "366+"`
  - `src/lib/analyze.js:226-227` `FACTOR_ORDER.play_duration` → `"0","1-30","31-90","91-180","181-365","365+"`
  - `src/tools/analyze-rs/src/main.rs:157-171,199` `play_bucket` → 与 FACTOR_ORDER **一致**
  - `src/lib/store.js:304-338` 采集台又是 `"0","1-7","8-30","31-90","91-365","366+"`
  - `src/analyze-server.js:233` `factor=play_duration` **只走 Rust**
- **现象**  
  - 生产路径（Rust）与 `FACTOR_ORDER` 对齐，前端图例正确。  
  - 一旦走 JS `buildFactors`（或单测/回退），`playBucket` 产出 `"31-365"`、`"366+"`，**不在** `FACTOR_ORDER` 中，被 `orderBuckets` 丢进字典序 `rest`；且 `"365+"` vs `"366+"` 边界也不一致（`pd==366` 在 JS 为 `366+`，在 Rust 为 `365+`——名称不同、区间还差 365 边界解释）。  
  - 采集台 `computeStatsStream` 第三套分桶，与分析页对不上。
- **为什么是逻辑问题**  
  同一 `play_duration` 在不同入口得到不同桶集合与桶边界，交叉表/图例/CSV 无法对齐，属口径错误而非展示差异。
- **建议改法**  
  以 `FACTOR_ORDER.play_duration` 为唯一真源：改 JS `playBucket` 与 Rust 完全一致（建议 `≤0 / 1–30 / 31–90 / 91–180 / 181–365 / >365`）；采集台统计桶若需保留可另名 `byPlayBucketDisplay` 并标注「与分析页分档不同」，或直接复用同一函数。

### P0-4 采集台均分剔除 0 分，与「0 计入均分」及分析端相反

- **文件:行号**
  - 规范：`src/lib/analyze.js:6`（「0/2/4/6/8/10，**0 计入均分**」）
  - `src/lib/analyze.js:122-133`（`accAdd` 把 `gm=0` 计入 `sum`/`n`）✓
  - `src/tools/analyze-rs/src/main.rs:88-90`（`a.sum += gm` 含 0）✓
  - `src/lib/store.js:310-315,350`（`if (g > 0) { sumGrade += g; gradeN++; }` → **0 不进均分**）✗
  - `src/lib/crawler.js:113-115,100`（session 均分 `sumGrade += g` 含 0）✓
- **现象**  
  采集台 `/api/stats` 全量 `avgGrade` 与分析台 `avg` / 采样曲线 / 跨游戏均分系统性偏高（分母丢掉全部 0 分评论）。
- **为什么是逻辑问题**  
  同一语料两套均分定义；且 `gradeDist` 仍统计 0，用户可用分布反推均分不一致。
- **建议改法**  
  `store.js` 改为 `sumGrade += g; gradeN++` 无条件累加（与 `analyze.js` / Rust / `crawler.#accAdd` 对齐）。若产品要「有效分均分」，应另字段 `avgGradeNonZero` 并在 UI 标明。

---

## P1（逻辑错误 / 口径不一致，特定路径必现）

### P1-1 `mapGrade` 的 1–5 星分支是死代码；奇数分与 1–5 星语义纠缠

- **文件:行号：** `src/lib/analyze.js:7-18`
- **现象**  
  `g <= 10` 先截获一切 1–10（含 1–5），执行 `Math.round(g/2)*2`；其后 `if (g <= 5) return Math.round(g)*2` **永不执行**。  
  若原始数据真是 1–5 星：`5 → 6`（3 星）而不是 `10`（5 星），星级全盘错位。
- **为什么是逻辑问题**  
  注释声称「兼容 1–5 星」，实现不兼容；若未来混入 5 星制评论会静默出错误均分。
- **建议改法**  
  明确唯一输入制：若数据恒为 0/2/4/6/8/10/奇数十分制，删除 1–5 分支并改注释；若需兼容 5 星，必须由外部信号（字段/游戏元数据）分支，不能靠数值大小猜（5 与 5 星无法区分）。

### P1-2 JS `mapGrade` 与 Rust `map_grade` 对非整数不一致

- **文件:行号：** `src/lib/analyze.js:12-13` vs `src/tools/analyze-rs/src/main.rs:7-21`
- **现象**  
  | raw | JS | Rust |
  |---|---|---|
  | 2.5 | 2（`round(1.25)*2`） | 4（`g<=4`） |
  | 1.5 | 2 | 2 |
  | 4.5 | 4 | 6 |
  整数 1–10 两者一致。
- **为什么是逻辑问题**  
  双后端并存（series 无 keyword 走 Rust，有 keyword 走 JS），一旦出现小数 grade 会得到不同均分。
- **建议改法**  
  抽成同一张阈值表或同一公式；Rust 的阶梯（≤2→2, ≤4→4, …）对整数与 JS 等价，建议 JS 也改成阶梯以消灭 `Math.round` 差异。

### P1-3 词频：Rust 路径忽略 `from`/`to`，缓存 key 却包含时间维

- **文件:行号**
  - `src/analyze-server.js:173-194`（key 含 `grain|from|to`，调用 `rustWordFreq(file, { source, limit })`）
  - `src/lib/rust-analyze.js:30-32`（CLI 无 from/to）
  - `src/tools/analyze-rs/src/main.rs:322-358`（全文件扫描）
  - JS 旧实现 `src/lib/wordfreq.js:50-61` **有**时间过滤（且写死 month）
- **现象**  
  UI 选了时间范围，词云/词频仍是全量语料；改 from/to 会换 cache key 却得到「全量」结果的不同缓存副本。
- **建议改法**  
  Rust `wordfreq` 增加 from/to + grain（与 series 相同 `period_key`/`in_range`）；或前端去掉时间选择并在文案写「全量」。

### P1-4 词频 JS 与 Rust 非同口径（停用词/长度/2-gram/大小写）

- **文件:行号：** `src/lib/wordfreq.js:3-8,13-20,31-46` vs `main.rs:237-264,266-320`
- **现象**
  1. JS `bump` 用 `w.length < 2`（UTF-16），Rust 用 `chars().count() < 2`（字符）—— BMP 外字符不一致。  
  2. JS 停用词表含 `"什么"` 等且有重复项；Rust 表略少（如无第二次 `"什么"`，无 `"怎么"` 的重复位置差异）——大体接近但不逐项相同。  
  3. JS ASCII token 上限 `{1,20}`（总长 2–21）；Rust 无长度上限。  
  4. JS 数字 run `[0-9]{2,6}` 才丢弃；Rust 任意纯数字 run 丢弃。  
  5. JS 无 `prune` 与 Rust 全量 HashMap 在超大语料上 Top-K 边界词可能不同（JS 剪枝近似）。
- **为什么是逻辑问题**  
  `/api/wordfreq` 实际只走 Rust，但 `wordfreq.js` / worker 仍在树内；若回退或对拍会出现词表漂移。
- **建议改法**  
  以 Rust 为真源，重写 JS 对齐或删除 JS 实现；停用词抽成共享 JSON。

### P1-5 关键词命中：Rust `contains` ≠ JS `findHits`（大小写、重叠、长度过滤）

- **文件:行号**
  - JS：`src/lib/analyze.js:326-355`（小写、别名长到短、区间去重、`length>=2`）
  - Rust：`main.rs:537`（`aliases.iter().any(|a| text.contains(a.as_str()))`，大小写敏感、无去重、无长度过滤）
  - 调用：`src/analyze-server.js:265-288`（只传 `only[0]` 的 aliases）
- **现象**  
  - 拉丁别名（如 `genshin`）：JS 命中 `Genshin`，Rust 不命中。  
  - 「尘白禁区」vs「尘白」：JS 只计一次长词；Rust 只要求任一 alias 出现即 hit（命中率按「是否命中」计，二者对 hit/miss 划分在多别名时可能一致，但与 JS `hit_n` 在「重复区间」场景仍可能不同——若 alias 集合含子串且只关心 boolean，则多数情况 hit 一致；**对 `hit_words` 列表与命中片段不一致**）。  
  - Rust 不做 `w.length>=2` 过滤，1 字别名会误命中。
- **为什么是逻辑问题**  
  `/api/keywords/series` 走 Rust，`/api/keywords/hits` 走 JS `findHits`——**同一关键词的命中集合在曲线与样本列表之间可以不一致**。
- **建议改法**  
  `hits` 与 `series` 共用同一匹配函数；Rust 复刻 `findHits`（或 keyword 命中一律走 JS）；aliases 传入前统一 lower，匹配前 content lower。

### P1-6 `cum_avg` 语义：JS 含 from 之前，Rust 只含时间范围内

- **文件:行号**
  - JS：`src/lib/analyze.js:178-187`（对**全部** period 累计后再按 from/to 截断展示）
  - Rust：`main.rs:120-138`（`in_range` 先过滤再累计）+ `src/lib/series-fast.js:8-14`
- **现象**  
  同一查询「from=2024-06」：无 keyword（Rust）的 `cum_avg` 是 2024-06 起累计；有 keyword（JS）的 `cum_avg` 是语料起点起累计。前端把「累计均分」当同一指标展示（`App.vue:222-223`）。
- **建议改法**  
  定义写进文档并统一：推荐「查询窗口内累计」（Rust 现状）；JS 改为先 filter 再累计。`series-fast.js` 注释「与 JS buildSeries 的 rows 字段对齐」目前**不成立**。

### P1-7 Rust 轻量 JSON 子串解析：转义引号 / 字段名碰撞会解析错

- **文件:行号：** `main.rs:23-55`（`find_key` / `parse_str_field` / `parse_f64_after`）
- **现象**  
  - `parse_str_field` 遇到 `\"` 会在转义引号处截断 content/user_name。  
  - `find_key` 取**第一次** `"grade":` / `"uid":` / `"content":`；若 content 或 user_name 文本里出现字面 `"grade":`，会读错字段。  
  - `\uXXXX` 不解码。
- **为什么是逻辑问题**  
  大文件场景用子串解析可以接受，但当前实现无逃逸处理，导致词频/关键词/均分在含引号的评论上与 JS（`JSON.parse`）不一致，且**无告警**。
- **建议改法**  
  最小修复：字符串扫描时处理 `\\` 逃逸；字段查找限制在行首固定键序，或改用 `serde_json`（工程已有 Cargo 依赖痕迹）。至少对 `content`/`user_name` 走完整 JSON 解析。

### P1-8 crawl-daemon：参数指纹不一致时静默改 incremental（Crawler 类则抛错）

- **文件:行号**
  - `src/crawl-daemon.js:100-113`（`full_resume` + 指纹不匹配 → 走 `else` → **incremental**）
  - `src/lib/crawler.js:170-173`（指纹不匹配 → **throw**）
- **现象**  
  用户改 pageSize/rankType 后点「全量续爬」，daemon 不会续全量，而是当增量从第 1 页扫，全量游标不被推进/不被纠正。
- **建议改法**  
  daemon 与 Crawler 同逻辑：指纹不一致应拒绝启动或强制 `full_restart` 并在 runtime 标明原因。

### P1-9 `/api/stats` 的「采集中不扫全库」依赖未启动的进程内 `Crawler`

- **文件:行号**
  - `src/server.js:331-344`（`crawler.status().running`）
  - `src/server.js:202-223`（`/api/crawl/start` **只写** `_cmd.json`，不 `crawler.start`）
  - 实际采集在 `crawl-daemon.js` + `ingest-daemon.js`
- **现象**  
  daemon 跑批时 `crawler.status()` 恒为 `{running:false}`，`/api/stats` 永远走全量 `computeStatsStream`；`sessionStats()` 死代码。注释「B：采集进行中不扫全库」未生效。
- **建议改法**  
  running 状态改读 `runtime.crawl.json` / `_cmd.json`（与 `/api/crawl/status` 一致）；或删掉进程内 Crawler 以免双栈。

### P1-10 Rust 缺失时核心 API 无 JS 回退（series / play_duration 因子 / wordfreq / crossdist）

- **文件:行号：** `src/analyze-server.js:184,207-208,233-234,277,359`
- **现象**  
  `rustAvailable()` 只在 `series-fast` 打进 `profile.backend`，调用链仍 `spawnSync` 失败即 500。`buildSeries`/`buildFactors`/`buildWordFreq`/`buildCrossDist` 已有 JS 版但默认不走。
- **建议改法**  
  `rustAvailable()===false` 或 spawn 失败时降级 JS，并在 `profile.backend` 标明，避免整页分析不可用。

### P1-11 `config.local.json` 路径分裂

- **文件:行号：** `src/server.js:22,24-34`（读写 `ROOT/config.local.json` = `app/config.local.json`）  
  实际存在：项目根 `B站游戏评论/config.local.json`；`app/config.local.json` 不存在（审查时）。
- **现象**  
  根目录已有 Cookie 配置不会被加载；保存会写到 `app/config.local.json`，形成双文件。
- **建议改法**  
  统一读 `PROJECT_ROOT/config.local.json`（或 `paths.js` 导出 CONFIG_PATH），并迁移旧文件。

### P1-12 双采集实现限速/风控策略不一致

- **文件:行号**
  - daemon：`src/crawl-daemon.js:18-41,221-236`（600ms+0–200ms；5%×2、1%×3；连续 3 次 -412 停并 `process.exit`）
  - 进程内 Crawler：`src/lib/crawler.js:24-34,374-384`（≥800ms+0–400ms；**无** 5%/1% 加倍；**无** -412 特判；连续 8 次任意错误才停）
  - 入参下限：`server.js:211` `Math.max(600,…)` vs `server.js:37,150` 配置 `Math.max(800,…)` vs `index.html:80` `min=600`
- **为什么是逻辑问题**  
  任务书点名的限速语义只在 daemon 完整；Crawler 路径若被再次启用会以更激进间隔请求且 -412 不停。
- **建议改法**  
  删除 Crawler 路径或把 `nextInterval`/`isBanErr`/`BAN_LIMIT` 抽到公共模块两边共用；统一 delay 下限。

### P1-13 跨游戏 uid 空值/类型：`cross-dist` 与 `buildCrossGame` 不一致

- **文件:行号**
  - `src/lib/analyze.js:446-447`（`uid == null || uid === ""` 跳过；key=`String(c.uid)`）
  - `src/lib/cross-dist.js:58-59,76`（仅 `id == null` 跳过，key 用原始 `c.uid`，lookup 不 `String`）
  - Rust：`main.rs:409-414,443-448`（数字 uid `to_string()`）
- **现象**  
  空字符串 uid 会进入 cross-dist 源表；JS 内 number/string 混用时 Map 可能分裂为两个用户。Rust 统一字符串，与 JS cross-dist 不必同分母。
- **建议改法**  
  一律 `uid = String(c.uid)`，空串/`"0"`/null 均跳过；三端同一 `uidKey()`。

### P1-14 `/api/keywords/series` 只处理 `name[0]`

- **文件:行号：** `src/analyze-server.js:267-283`（`only[0]`）vs `buildKeywords`（支持多 name，现被绕过）
- **现象**  
  API 形状像支持多选（`getAll("name")`），实际静默丢弃其余。前端目前单选，但接口语义错误。
- **建议改法**  
  要么只收一个 `name` 参数，要么循环 Rust/走 JS `buildKeywords`。

### P1-15 四格占比 `toFixed(4)` 后 pp+pn+np+nn 不必为 1

- **文件:行号：** `cross-dist.js:100-108`、`main.rs:481-485`
- **现象**  
  独立四舍五入，三期各 1/3 时每条 0.3333，加总 0.9996；或 1.0001。
- **建议改法**  
  导出原始计数 + 未舍入占比；展示层再舍入；或最大余数法保证和为 1。卡方请用**原始计数**（当前已是，保持）。

### P1-16 断点续爬：`seen.ids` 写了不用；seen 仅从 jsonl 重建

- **文件:行号：** `store.js:184-209`、`crawler.js:500`、`ingest-daemon.js:57`
- **现象**  
  `loadSeenIds` 永远扫 `comments.jsonl`；`readSeenIdsFile` 无调用方。jsonl 尾部半行被 `JSON.parse` 失败跳过 → 对应 comment_no **丢失**，续爬可能重复入库。ingest 对无 `comment_no` 的条目不去重（`ingest-daemon.js:118-123`）。
- **建议改法**  
  启动优先读 `seen.ids` 并与 jsonl 并集；无 `comment_no` 用 content+uid+time 哈希去重或拒绝入库。

---

## P2（边界 / 可维护性 / 次要逻辑）

| ID | 位置 | 现象 | 建议 |
|---|---|---|---|
| P2-1 | `cache.js:50-54,105` | `memDelByGame` / 缓存失效用 `key.includes(gid)`，gameId `12` 会误删 `123` 的缓存 | key 结构化 `\|` 分段精确匹配 |
| P2-2 | `analyze-server.js:71-73` | worker 路径 `ROOT/lib/wordfreq-worker.js`（= `app/lib/...`）不存在；真身在 `src/lib/`；且 `runWordFreqWorker` 无调用方 | 删死代码或改 `src/lib` |
| P2-3 | `src/web/app.js:104-106` | `applyStatus` 在输入框为空且无焦点时仍回填 `#gameId`（与「完全不写表单」有差距） | 删除回填或仅首次 |
| P2-4 | `App.vue:329-338` | `kwCorr = (10-RMSE)/10` 不是相关系数，UI 写「相关」易误读 | 改名「稳定性」或改 Pearson |
| P2-5 | `store.js:304-338` | 采集台 play 分桶第三套 | 见 P0-3 |
| P2-6 | `main.rs:499` | `direction` 写死 `"A→B"`，JS 为 `${gameA}→${gameB}` | Rust 传入真实 id |
| P2-7 | `package.json` | 无 `npm run start`；AGENTS 写的 `start/analyze/build/dev` 与实际 `web/ingest/crawl/analyze/build/dev` 不符 | 同步文档/脚本 |
| P2-8 | `scripts/status.ps1:4` | 写 8787「usually off」，但 `start-services.ps1` 默认会起 `server.js` | 统一注释 |
| P2-9 | `queue.js:72-80` | `failJob` 直接进 `_failed` 无重试；瞬时磁盘错误丢页 | 至少 N 次重试或人工重放命令 |
| P2-10 | `cross-dist.js` 整文件 | JS `buildCrossDist` 已被 Rust 取代但仍被 import，易改错文件 | 删除或标明 deprecated |
| P2-11 | `analyze.js:33` | `normRange` 月→日 `to+"-31"` 对 2 月是字面 `02-31`（字符串比较可用，但导出/解析会炸） | 用当月最后一天 |
| P2-12 | `charts.js` 均值 | 对 `null` 过滤后求均，稀疏序列 μ 与「全期均」可能不同 | 图例标明「可见点均值」 |
| P2-13 | `api.js:55-57` | `-400/-1203` 空分支注释与行为不符 | 删除或真正短路 |
| P2-14 | `sign.js:11` | `RND[Math.floor(Math.random()*(RND.length-1))]` **永远取不到末字符** `Z` | 改 `RND.length` |
| P2-15 | `store.js:291` | `gradeDist` 用 raw `grade` 长度 11，与 mapGrade 后 0/2/4/6/8/10 不是同一分布 | 导出时注明 raw |
| P2-16 | `analyze-server.js:395-396` | `/api/samples` 用 `slice(0,7)` 比 from/to，未用 `periodKey`/`normRange`（当前 UI 是月选择器，暂安全） | 复用 normRange |
| P2-17 | `crawl-daemon.js:198-204` | 背压循环里缩进错乱的嵌套 `if (!active)`，逻辑虽可用但易在后续改坏 | 理顺控制流 |
| P2-18 | 时区 | `periodKey` 靠字符串切片，不解析 Date；若 publish_time 格式变体会 silent skip | 校验格式并计数 skipped |

---

## 一致性对照表（JS / Rust / 前端）

| 口径项 | JS（`lib/analyze.js` 等） | Rust（`analyze-rs`） | 前端（`ui/App.vue` 等） | 一致？ |
|---|---|---|---|---|
| **mapGrade 整数** | `round(g/2)*2`，0/非法→0，0 计入均分 | 阶梯 ≤2→2…else 10，0 计入均分 | 展示 `avg` / `grade_mapped` | 整数一致；**非整数不一致**；采集台 store 均分 **不计 0** |
| **mapGrade 1–5 星** | 死分支，实际 5→6 | 同左（5→6） | 无 | 与注释不符（P1-1） |
| **star1–5** | `gm/2` clamp | `(gm/2).round()` clamp | 列 ★5…★1 | 一致 |
| **play 分档** | `0,1-30,31-365,366+` | `0,1-30,31-90,91-180,181-365,365+` | `FACTOR_ORDER` = Rust | **JS ≠ Rust**（P0-3） |
| **user_level** | clamp 0–6 | （factors 仅 play） | 选项 0–6 | JS 自洽 |
| **content_len** | ≤20 / 21-80 / 81-200 / 201+ | — | 同左 | 一致 |
| **device_type** | 安卓/苹果/PC/其他 | — | DEVICE_ORDER | 仅 JS |
| **avg 含 0？** | 是 | 是 | 「含 0」文案 | store **否**（P0-4） |
| **cum_avg** | 含 from 前 | 仅窗口内 | 当同一指标 | **否**（P1-6） |
| **2×2 卡方** | `n(ad-bc)²/(r1 r2 c1 c2)`，p=`erfc(√(χ²/2))`，φ=`(ad-bc)/√den` | 同公式 | 展示 chi2/phi/related | 公式一致；**业务分档与方案 3 不符**（P0-2） |
| **方向 A→B** | `gameA→gameB` 字符串 | 写死 `A→B` | 用 source/target 自拼文案 | 数据方向对，标签弱 |
| **四格和=1** | 四舍五入后可 ≠1 | 同 | 按 pct 显示 | 近似（P1-15） |
| **uid 判定** | cross: `String`+滤空；dist: 原始+滤 null | 字符串化，滤解析失败 | — | **否**（P1-13） |
| **词频停用/2-gram** | 见 P1-4 | 见 P1-4 | 词云 Top150 | 近似但不保证 |
| **词频时间滤** | JS 有（写死 month） | **无** | 传 from/to | **否**（P1-3） |
| **关键词命中** | findHits 长词优先 | contains | series=Rust / hits=JS | **否**（P1-5） |
| **缓存 force** | `refresh=1` → force | — | `__mimo_refresh`→refresh=1；采集台 `force=1` | 参数名两套，各自闭合 |
| **限速 -412** | Crawler 无 | — | — | daemon 有（P1-12） |

---

## 未完成 / 风险清单

1. **方案 3 跨游戏（差/中/好 + 源档 + 三曲线）**——需求在 AGENTS 标为「已完成」，实现仍是四格二分（**状态应改回未完成**）。  
2. **增量/会话统计**：daemon 模式下 `/api/stats` 轻量会话统计未接通（P1-9）；ingest `sessionNew` 为跨游戏全局计数。  
3. **JS/Rust 对拍测试缺失**：mapGrade、playBucket、wordfreq、keywords、crossdist、chi2 均无金样本。  
4. **Rust JSON 解析**在真实评论（引号/emoji/转义）上的偏差未量化。  
5. **`buildCrossDist` JS 死代码**与 Rust 双实现，后续必漂。  
6. **无 comment_no 去重**与 **seen.ids 未使用** 使断点正确性依赖 jsonl 行完整性。  
7. **文档**：AGENTS「npm run start」与 package.json 不符；采集页参数栏「完全不写回」与 `app.js:104` 残留回填不完全一致。  
8. **sign.js random32 少一个字符集尾字符**（P2-14），签名仍可用，但熵与官方不完全同构。  
9. **双 dist 目录**若不清理，后续 build 仍可能误导排查。

---

## 建议修复顺序

1. **P0-1 路径**：改 `vite.config.js` `outDir` → `app/dist`，清理项目外 dist，确认 8788 服务的是新 bundle。  
2. **P0-4 + P1-1 + P1-2 均分/mapGrade**：统一「0 计入均分」与 mapGrade 单实现（可迁到共享表，Rust 复刻）。  
3. **P0-3 分档**：以 `FACTOR_ORDER.play_duration` 为真源，改 JS `playBucket` 与采集台桶；加金样本。  
4. **P0-2 方案 3**：三档 + sourceBucket + 目标三占比；API/UI/Rust/JS 一次改齐（避免再双口径）。  
5. **P1-3/P1-4/P1-5 词频与关键词**：时间过滤进 Rust；命中算法三端同一；hits/series 同源。  
6. **P1-6 cum_avg**：统一为窗口内累计。  
7. **P1-7 Rust 解析**：转义处理或 serde。  
8. **P1-8/P1-9/P1-12 采集栈**：daemon 指纹策略、stats 状态源、限速模块共用；评估删除进程内 Crawler。  
9. **P1-10 回退** + **P1-11 config 路径** + **P1-13/14/15/16** 边界。  
10. **P2** 随批清理（尤其 `sign.js` random、缓存 key、文档）。

---

## 附：审查覆盖文件

`src/crawl-daemon.js`, `src/ingest-daemon.js`, `src/server.js`, `src/analyze-server.js`,  
`src/lib/{analyze,api,cache,crawler,cross-dist,logger,paths,queue,rust-analyze,series-fast,sign,store,wordfreq,wordfreq-worker}.js`, `src/lib/keywords.json`,  
`src/web/{app,charts,wordcloud,index.html}`（及对照 `analyze*.js` 死/旧前端）,  
`src/ui/{App.vue,ChartBox.vue,api.js,main.js}`,  
`src/tools/analyze-rs/src/main.rs`,  
`scripts/{start-analyze,start-crawl,start-services,stop-services,status}.ps1`,  
`vite.config.js`, `package.json`。

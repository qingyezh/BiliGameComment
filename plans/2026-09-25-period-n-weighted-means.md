# 2026-09-25 周期数据量加权平均

## 问题

因子交叉 / 关键词趋势 / 跨游戏对比（含评价迁移四格）图上的「均值」μ 原先按**周期均分的简单平均**计算，未按各期样本量加权；稀疏期与高产期权重相同。另外 `charts.js` 的 `weightedMean` 先 `filter` 掉 null 再传 weights，下标错位，因子分档空桶时权重也会算错。

## 口径

| 指标 | 权重 |
| ---- | ---- |
| 因子各档均分 μ | 该档当期 `n` |
| 关键词 命中均分 μ | 当期 `hit_n` |
| 关键词 全部均分 / Δ / 命中率 μ | 当期 `n` |
| 关键词相关度 | n 加权 RMS：`(10 − √(Σ n·Δ² / Σ n)) / 10` |
| 跨游戏两游戏均分 μ | 当期共同 uid 评论数 `n` |
| 四格占比 pp/pn/np/nn μ | 当期 `n`（与总览口径一致） |
| 评分轨迹 局部/累计均分 μ | 当期 `n` |

全量 overview（因子总表、关键词 overview、四格总览）继续用 **样本级 sum/n**，不是周期均分再平均。

## 改动

1. **`src/web/charts.js`**：`weightedMean` 保持 values/weights 同下标；调用改为 `seriesMean(s)`，不再先 filter。
2. **`src/ui/App.vue`**：
   - 因子 / 关键词 / 跨游戏均分 / 四格占比 / 评分轨迹序列补 `weights`。
   - 关键词相关度改为 n 加权 RMS。
   - 因子「周期均分明细」`n` 列回填周期总 n。
3. **`src/lib/analyze.js`**：`buildFactors` 序列带 `n`；`buildKeywords` 输出样本级加权 `overview`。
4. **`src/tools/analyze-rs`**：
   - `cmd_factors` 序列行增加周期总 `n`。
   - `cmd_keywords` 增加样本级加权 `overview`（n / hit_n / miss_n / avg / hit_avg / miss_avg / hit_rate / delta_hit）。
   - `cargo build --release` 后覆盖 `app/bin/analyze_rs.exe`。
5. **`src/analyze-server.js`**：rust 因子序列透传 `n`。

## 验证

- [x] `cargo build --release` 通过，产物已替换 `app/bin/analyze_rs.exe`
- [x] `analyze_rs factors`：`series[*].n` 存在
- [x] `analyze_rs keywords`：`overview` 为样本加权（非周期均分简单平均）
- [x] `analyze_rs crossdist`：overview 仍为格计数汇总
- [x] `npm run build` 通过

## 补充（同日）：Δ 命中−全部 均值口径

图上 Δ 的 μ 原先对「各期 (hit−all)」再按 n 加权，与「命中 μ − 全部 μ」不一致
（例：命中 4.38 / 全部 5.27 时期望 Δ μ=−0.89，却显示 −0.12）。

- **μ(Δ) = 全量命中μ − 全量全部μ**（`charts.js` 支持 `series.meanOverride`）
- 后端 `delta_hit` 统一为 **命中均分 − 全部均分**（原先误为命中−未命中）
- 周期点值仍为当期 `hit_avg - avg`

## 明确不做

- 评价者数量图（eval counts）μ 仍为各期人数的简单平均（本身就是计数序列，不按 n 再加权）。
- 旧版 `src/web/analyze.js` 表格 meanRow（非当前 Vue 入口）未改。

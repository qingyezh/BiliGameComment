# 2026-09-22 因子交叉：分档调整 / 终端合并 / 图例升序

## 需求

1. 游玩时长重分档：`0 / 1-30 / 31-365 / 366+`（30 归 1-30，365 归 31-365）
2. 「终端品牌」改名「终端」，合并为 `安卓 / 苹果 / PC / 其他`
3. 因子交叉四个因子的图例/总表按从小到大排序（原 `localeCompare` 字典序导致乱序）

## 改动

| 文件 | 内容 |
|------|------|
| `lib/analyze.js` | `playBucket` 四档；`deviceBucket` 出口归并四类；`DEVICE_ORDER` 更新；新增 `FACTOR_ORDER` + `orderBuckets`，`buildFactors` 废除字典序 |
| `src/analyze/App.vue` | 下拉标签 `终端品牌` → `终端` |
| `README.md` | 因子交叉说明同步 |
| `version.md` | v0.1.3.0 |

## 不改

- `lib/store.js` 采集端 KPI 分档（经确认保持原样）
- 旧原生前端 `js/analyze.js` / `js/analyze-vue.js`（入口已走 Vue3）

## 图例顺序（四因子）

- 游玩时长：`0 → 1-30 → 31-365 → 366+`
- 用户等级：`0 → 1 → 2 → 3 → 4 → 5 → 6`
- 评论长度：`≤20 → 21-80 → 81-200 → 201+`
- 终端：`安卓 → 苹果 → PC → 其他`

## 验证

- `node --check lib/analyze.js`
- `npm run build`
- 重启 8788 后冒烟 `/api/factors` × 4 factor，核对 `buckets` 顺序

import { rustSeriesRows, rustAvailable } from "./rust-analyze.js";
import { commentsPath } from "./cache.js";

/** 与 JS buildSeries 的 rows 字段对齐 */
export function accRowsToSeries(rows) {
  let cumSum = 0;
  let cumN = 0;
  let prevAvg = null;
  return rows.map((r) => {
    const avg = r.n ? +(r.sum / r.n).toFixed(4) : null;
    const zero_ratio = r.n ? +(r.zero / r.n).toFixed(4) : null;
    cumSum += r.sum;
    cumN += r.n;
    const cum_avg = cumN ? +(cumSum / cumN).toFixed(4) : null;
    const delta_avg = prevAvg != null && avg != null ? +(avg - prevAvg).toFixed(4) : null;
    if (avg != null) prevAvg = avg;
    return {
      n: r.n,
      avg,
      zero_ratio,
      star1: r.stars[0],
      star2: r.stars[1],
      star3: r.stars[2],
      star4: r.stars[3],
      star5: r.stars[4],
      period: r.period,
      delta_avg,
      cum_avg,
    };
  });
}

/** 埋点：返回 { grain, rows, periods, profile } */
export function fastSeries(root, gameId, { grain = "month", from, to } = {}) {
  const file = commentsPath(root, gameId);
  const t0 = Date.now();
  const raw = rustSeriesRows(file, {
    grain,
    from: from || "",
    to: to || "",
  });
  const t1 = Date.now();
  const rows = accRowsToSeries(raw);
  const profile = {
    backend: rustAvailable() ? "rust" : "rust-missing",
    scanMs: t1 - t0,
    mapMs: Date.now() - t1,
    rows: rows.length,
  };
  return { grain, rows, periods: rows, profile };
}

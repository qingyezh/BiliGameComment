import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/** 0/2/4/6/8/10，0 计入均分；兼容奇数分与 1–5 星 */
export function mapGrade(raw) {
  const g = Number(raw);
  if (!Number.isFinite(g) || g <= 0) return 0;
  if (g <= 10) {
    // 10/8/6/4/2 向偶数取整；1→2,3→4,5→6,7→8,9→10 也可按 2*round(g/2)
    const snapped = Math.round(g / 2) * 2;
    return Math.min(10, Math.max(0, snapped));
  }
  // 若是 1–5 星
  if (g <= 5) return Math.min(10, Math.max(0, Math.round(g) * 2));
  return 10;
}

export function periodKey(publishTime, grain) {
  if (!publishTime) return null;
  const s = String(publishTime);
  if (grain === "day") return s.slice(0, 10);
  return s.slice(0, 7); // month
}

/** from/to 可能是 YYYY-MM（input[type=month]），日粒度需归一到可比较边界 */
export function normRange(grain, from, to) {
  let f = from;
  let t = to;
  if (grain === "day") {
    if (f && f.length === 7) f = f + "-01";
    if (t && t.length === 7) t = t + "-31";
  }
  return { from: f, to: t };
}

export function inRange(pk, from, to) {
  if (!pk) return false;
  if (from && pk < from) return false;
  if (to && pk > to) return false;
  return true;
}

export async function* readComments(gameId, root) {
  const p = path.join(root, "data", String(gameId), "comments.jsonl");
  if (!fs.existsSync(p)) return;
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      yield JSON.parse(t);
    } catch {
      /* skip */
    }
  }
}

export function contentLen(c) {
  return (c.content || "").length;
}

export function playBucket(days) {
  const pd = Number(days) || 0;
  if (pd <= 0) return "0";
  if (pd <= 30) return "1-30";
  if (pd <= 365) return "31-365";
  return "366+";
}

export function lenBucket(n) {
  if (n <= 20) return "≤20";
  if (n <= 80) return "21-80";
  if (n <= 200) return "81-200";
  return "201+";
}

/** 终端归并：安卓 / 苹果 / PC / 其他 */
export function deviceBucket(d) {
  const s = String(d || "").trim();
  if (!s || s === "(empty)" || s === "-") return "其他";
  const l = s.toLowerCase();

  // PC
  if (/windows|win32|win64|wow64|macintosh|mac_powerpc|ppc|cros|x11|linux|pc/i.test(s)) {
    if (!/android|harmony|iphone|ipad/.test(l)) return "PC";
  }
  // 苹果
  if (/iphone|ipad|ipod|ios|mac os x|macintosh/.test(l)) return "苹果";

  // 以下均归安卓（小米/红米、vivo/OPPO/荣耀/华为、其他安卓特征）
  if (/xiaomi|redmi|\bmi\s|mi\d|poco|blackshark|黑鲨|miui/.test(l)) return "安卓";
  if (/^(2[0-9]{3}[a-z0-9]+|m2[0-9a-z]+)/i.test(s) && !/^sm-/i.test(s)) return "安卓";
  if (/vivo|iqoo/.test(l) || /^v\d{3,4}[a-z]?$/i.test(s)) return "安卓";
  if (/oppo|realme|oneplus|一加|cph\d/i.test(l)) return "安卓";
  if (/^(pem[ms]|peg[ms]|pgm|pgt|pju|pjj|phj|php|pft|pdhm|pdem|ptp|pkg|pggm|per[ms]|pad[m]?00)/i.test(s)) return "安卓";
  if (/honor|荣耀/.test(l)) return "安卓";
  if (/^(bkk|bkl|yal|nth|rea|ali-|fne|koa|lge-|mxw|hry|yok|cma|vny|lya|cor|tfy|elz)/i.test(s)) return "安卓";
  if (/huawei|华为|harmony|kirin/.test(l)) return "安卓";
  if (/^(hma|jad|jsn|ana|els|noh|lio|oce|bal|dco|vog|mar|lya|tah|jny|cnd|mla|evr|lya|vce|jsn)/i.test(s)) return "安卓";
  if (/-(al|an|tl|tn|t|l)\d{2}$/i.test(s)) return "安卓";
  if (/android|harmonyos|samsung|sm-[a-z]/i.test(s) || /pixel|meizu|letv|lenovo|zte|hisense|coolpad/.test(l)) return "安卓";

  return "其他";
}

export const DEVICE_ORDER = ["安卓", "苹果", "PC", "其他"];

function accCreate() {
  return {
    n: 0,
    sum: 0,
    zero: 0,
    stars: [0, 0, 0, 0, 0], // 1–5 星
  };
}

function accAdd(a, gradeMapped) {
  a.n++;
  a.sum += gradeMapped;
  if (gradeMapped === 0) a.zero++;
  const star = gradeMapped === 0 ? null : Math.min(5, Math.max(1, gradeMapped / 2));
  if (star != null) a.stars[star - 1]++;
}

function accOut(a) {
  return {
    n: a.n,
    avg: a.n ? +(a.sum / a.n).toFixed(4) : null,
    zero_ratio: a.n ? +(a.zero / a.n).toFixed(4) : null,
    star1: a.stars[0],
    star2: a.stars[1],
    star3: a.stars[2],
    star4: a.stars[3],
    star5: a.stars[4],
  };
}

/**
 * 周期局部序列（不含累计均分作为主指标；cum_avg 仅附加）
 */
export async function buildSeries(gameId, root, { grain = "month", from, to, keyword = null } = {}) {
  ({ from, to } = normRange(grain, from, to));
  const periods = new Map();
  let cumSum = 0;
  let cumN = 0;

  for await (const c of readComments(gameId, root)) {
    const pk = periodKey(c.publish_time, grain);
    if (!pk) continue;
    const gm = mapGrade(c.grade);
    const hit = keyword ? hitKeyword(c.content, keyword) : null;

    if (!periods.has(pk)) {
      periods.set(pk, {
        period: pk,
        all: accCreate(),
        hit: accCreate(),
        miss: accCreate(),
      });
    }
    const row = periods.get(pk);
    accAdd(row.all, gm);
    if (hit) accAdd(row.hit, gm);
    else if (keyword) accAdd(row.miss, gm);

    cumSum += gm;
    cumN++;
  }

  let list = [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
  list = list.filter((x) => inRange(x.period, from, to));

  // 周期局部 + 辅助 cum_avg（从语料起点累计到该期末，含 from 之前）
  // 重新扫一遍算 cum 会贵；用按序累加：先全量 period 累计再截断展示
  let runSum = 0;
  let runN = 0;
  const cumByPeriod = new Map();
  for (const row of [...periods.values()].sort((a, b) => a.period.localeCompare(b.period))) {
    runSum += row.all.sum;
    runN += row.all.n;
    cumByPeriod.set(row.period, runN ? +(runSum / runN).toFixed(4) : null);
  }

  const prevAvg = new Map();
  let last = null;
  for (const row of list) {
    const o = accOut(row.all);
    o.period = row.period;
    o.delta_avg = last != null && o.avg != null ? +(o.avg - last).toFixed(4) : null;
    if (o.avg != null) last = o.avg;
    o.cum_avg = cumByPeriod.get(row.period) ?? null;
    if (keyword) {
      const h = accOut(row.hit);
      const m = accOut(row.miss);
      o.hit_n = h.n;
      o.hit_avg = h.avg;
      o.miss_n = m.n;
      o.miss_avg = m.avg;
      o.hit_rate = o.n ? +(h.n / o.n).toFixed(4) : null;
      o.delta_hit = h.avg != null && m.avg != null ? +(h.avg - m.avg).toFixed(4) : null;
    }
    prevAvg.set(row.period, o);
  }

  return {
    grain,
    keyword,
    rows: [...prevAvg.values()],
  };
}

function hitKeyword(content, keyword) {
  let list = [];
  if (Array.isArray(keyword)) list = keyword;
  else if (keyword && (keyword.words || keyword.词)) list = keyword.words || keyword.词;
  else if (keyword) list = [keyword];
  return findHits(content, list).length > 0;
}

/** 四因子固定升序（图例/总表顺序，勿用 localeCompare 字典序） */
export const FACTOR_ORDER = {
  play_duration: ["0", "1-30", "31-365", "366+"],
  user_level: ["0", "1", "2", "3", "4", "5", "6"],
  content_len: ["≤20", "21-80", "81-200", "201+"],
  device_type: DEVICE_ORDER,
};

function orderBuckets(factor, present) {
  const order = FACTOR_ORDER[factor] || [];
  const known = order.filter((b) => present.includes(b));
  const rest = present.filter((b) => !order.includes(b)).sort((a, b) => String(a).localeCompare(String(b)));
  return [...known, ...rest];
}

export async function buildFactors(gameId, root, { grain = "month", factor = "play_duration", from, to } = {}) {
  // factor: play_duration | user_level | content_len | device_type
  const byPeriodFactor = new Map();

  for await (const c of readComments(gameId, root)) {
    const pk = periodKey(c.publish_time, grain);
    if (!pk) continue;
    const rgF = normRange(grain, from, to);
    if (!inRange(pk, rgF.from, rgF.to)) continue;
    const gm = mapGrade(c.grade);
    let bucket;
    if (factor === "play_duration") bucket = playBucket(c.play_duration);
    else if (factor === "user_level") bucket = String(Math.min(6, Math.max(0, Number(c.user_level) || 0)));
    else if (factor === "content_len") bucket = lenBucket(contentLen(c));
    else bucket = deviceBucket(c.device_type);

    if (!byPeriodFactor.has(pk)) byPeriodFactor.set(pk, new Map());
    const m = byPeriodFactor.get(pk);
    if (!m.has(bucket)) m.set(bucket, accCreate());
    accAdd(m.get(bucket), gm);
  }

  // 同时给全量（所选时间范围内）总表
  const overall = new Map();
  for (const m of byPeriodFactor.values()) {
    for (const [b, a] of m) {
      if (!overall.has(b)) overall.set(b, accCreate());
      const o = overall.get(b);
      o.n += a.n;
      o.sum += a.sum;
      o.zero += a.zero;
      for (let i = 0; i < 5; i++) o.stars[i] += a.stars[i];
    }
  }

  const periods = [...byPeriodFactor.keys()].sort();
  const buckets = orderBuckets(factor, [...new Set(overall.keys())]);

  return {
    factor,
    grain,
    buckets,
    overall: buckets.map((b) => ({ bucket: b, ...accOut(overall.get(b)) })),
    series: periods.map((p) => ({
      period: p,
      buckets: buckets.map((b) => {
        const a = byPeriodFactor.get(p).get(b);
        return { bucket: b, ...(a ? accOut(a) : { n: 0, avg: null, zero_ratio: null }) };
      }),
    })),
  };
}

export function loadKeywords(root) {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "keywords.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** 展开词条：支持 词[] 与 include[引用其它词条]，汇总成扁平词表（已小写） */
export function expandEntry(dict, name) {
  const item = dict[name];
  if (!item) return [];
  const direct = Array.isArray(item) ? item : item.词 || item.words || [];
  const inc = (!Array.isArray(item) && item.include) || [];
  const words = new Set();
  for (const w of direct) if (w) words.add(String(w).toLowerCase());
  for (const ref of inc) {
    for (const w of expandEntry(dict, ref)) words.add(w);
  }
  return [...words];
}

export function listKeywordNames(dict) {
  return Object.keys(dict);
}

/**
 * 命中规则（偏准）：
 * 1) 忽略空/长度<2 的碎片
 * 2) 别名从长到短；已匹配区间跳过（「尘白禁区」不再重复记「尘白」）
 * 3) 纯 includes（中文无词边界）；精度靠词表只留专名，不靠切词
 */
export function findHits(text, words) {
  const src = String(text || "");
  const lower = src.toLowerCase();
  const list = [...new Set((words || []).map((w) => String(w).trim().toLowerCase()).filter((w) => w.length >= 2))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );
  const used = new Uint8Array(lower.length);
  const hits = [];
  for (const w of list) {
    let from = 0;
    for (;;) {
      const start = lower.indexOf(w, from);
      if (start < 0) break;
      const end = start + w.length;
      from = start + w.length;
      let overlap = false;
      for (let i = start; i < end; i++) {
        if (used[i]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      for (let i = start; i < end; i++) used[i] = 1;
      hits.push({ word: src.slice(start, end), start, end, alias: w });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

export function hitContext(text, hits, radius = 18) {
  const src = String(text || "");
  if (!hits.length) return src.slice(0, 80);
  const h = hits[0];
  const s = Math.max(0, h.start - radius);
  const e = Math.min(src.length, h.end + radius);
  return (s > 0 ? "…" : "") + src.slice(s, e) + (e < src.length ? "…" : "");
}

export function matchEntry(content, wordList) {
  return findHits(content, wordList);
}

export async function buildKeywords(gameId, root, { grain = "month", from, to, dict, names: only } = {}) {
  const words = dict || loadKeywords(root);
  const names = (only && only.length ? only : Object.keys(words)).filter((n) => words[n]);
  const map = new Map();
  for (const name of names) {
    map.set(name, expandEntry(words, name));
  }

  const byPeriod = new Map();
  for await (const c of readComments(gameId, root)) {
    const pk = periodKey(c.publish_time, grain);
    if (!pk) continue;
    const rgF = normRange(grain, from, to);
    if (!inRange(pk, rgF.from, rgF.to)) continue;
    const gm = mapGrade(c.grade);
    const text = c.content || "";
    if (!byPeriod.has(pk)) {
      byPeriod.set(pk, {
        period: pk,
        all: accCreate(),
        entries: Object.fromEntries(names.map((n) => [n, { hit: accCreate(), miss: accCreate() }])),
      });
    }
    const row = byPeriod.get(pk);
    accAdd(row.all, gm);
    for (const n of names) {
      const wordsN = map.get(n);
      const isHit = findHits(text, wordsN).length > 0;
      if (isHit) accAdd(row.entries[n].hit, gm);
      else accAdd(row.entries[n].miss, gm);
    }
  }

  const periods = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  return {
    grain,
    names,
    periods: periods.map((p) => {
      const o = accOut(p.all);
      o.period = p.period;
      o.keywords = {};
      for (const n of names) {
        const h = accOut(p.entries[n].hit);
        const m = accOut(p.entries[n].miss);
        o.keywords[n] = {
          hit_n: h.n,
          hit_avg: h.avg,
          miss_n: m.n,
          miss_avg: m.avg,
          hit_rate: o.n ? +(h.n / o.n).toFixed(4) : null,
          delta_hit: h.avg != null && m.avg != null ? +(h.avg - m.avg).toFixed(4) : null,
        };
      }
      return o;
    }),
  };
}

export async function buildCrossGame(rootsGames, root, { grain = "month", from, to } = {}) {
  const games = rootsGames.map(String);
  if (games.length < 2) {
    const series = {};
    for (const g of games) series[g] = [];
    return { games, grain, overlapUsers: 0, pairSample: [], pairTotal: 0, corr: null, series, mode: "common" };
  }
  const rg = normRange(grain, from, to);

  // Pass1: 收集各游戏 uid 与用户级汇总
  const uidSets = games.map(() => new Set());
  const perUser = new Map();
  const evalByGame = games.map(() => new Map());
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    for await (const c of readComments(g, root)) {
      const pk = periodKey(c.publish_time, grain);
      if (!pk || !inRange(pk, rg.from, rg.to)) continue;
      if (c.uid == null || c.uid === "") continue;
      const uidKey = String(c.uid);
      uidSets[i].add(uidKey);
      if (!evalByGame[i].has(pk)) evalByGame[i].set(pk, new Set());
      evalByGame[i].get(pk).add(uidKey);
      const gm = mapGrade(c.grade);
      if (!perUser.has(uidKey)) perUser.set(uidKey, {});
      const u = perUser.get(uidKey);
      if (!u[g]) u[g] = { sum: 0, n: 0 };
      u[g].sum += gm;
      u[g].n++;
    }
  }

  // 仅保留同时评价了两个游戏的用户（以 id 筛选）
  let common = new Set(uidSets[0]);
  for (let i = 1; i < uidSets.length; i++) {
    common = new Set([...common].filter((id) => uidSets[i].has(id)));
  }

  // Pass2: 只对共同评价者累计周期序列
  const perGame = games.map(() => new Map());
  const periodCommon = new Map();
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const s = perGame[i];
    for await (const c of readComments(g, root)) {
      if (c.uid == null || !common.has(String(c.uid))) continue;
      const pk = periodKey(c.publish_time, grain);
      if (!pk || !inRange(pk, rg.from, rg.to)) continue;
      const uidKey = String(c.uid);
      if (!periodCommon.has(pk)) periodCommon.set(pk, new Set());
      periodCommon.get(pk).add(uidKey);
      const gm = mapGrade(c.grade);
      if (!s.has(pk)) s.set(pk, accCreate());
      accAdd(s.get(pk), gm);
    }
  }

  const pairs = [];
  for (const uid of common) {
    const u = perUser.get(uid);
    if (!u) continue;
    const a = u[games[0]];
    const b = u[games[1]];
    if (!a || !b || !a.n || !b.n) continue;
    const avgA = a.sum / a.n;
    const avgB = b.sum / b.n;
    pairs.push({
      uid,
      avgA: +avgA.toFixed(2),
      avgB: +avgB.toFixed(2),
      nA: a.n,
      nB: b.n,
      delta: +(avgA - avgB).toFixed(2),
    });
  }
  pairs.sort((x, y) => y.avgA - x.avgA);

  const series = {};
  for (let i = 0; i < games.length; i++) {
    series[games[i]] = [...perGame[i].entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, acc]) => ({ period, ...accOut(acc) }));
  }
  const commonByPeriod = [...periodCommon.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, set]) => ({ period, n: set.size }));
  const evalSeries = {};
  for (let i = 0; i < games.length; i++) {
    evalSeries[games[i]] = [...evalByGame[i].entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, set]) => ({ period, n: set.size }));
  }

  let corr = null;
  if (pairs.length >= 3) {
    corr = pearson(pairs.map((p) => p.avgA), pairs.map((p) => p.avgB));
  }

  return {
    games,
    grain,
    overlapUsers: pairs.length,
    pairSample: pairs.slice(0, 500),
    pairTotal: pairs.length,
    corr,
    series,
    commonByPeriod,
    evalSeries,
    mode: "common",
    commonUidCount: common.size,
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den ? +(num / den).toFixed(4) : null;
}


